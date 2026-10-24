---
title: Docker
description: Build the WAF Harness image from the repository, and run it with one container and one volume serving the full Web App on port 7364.
---

The image runs the same server that `wafh server` starts, with the Web App inside it. No image is published: you build it once from the repository's Dockerfile. One container and one volume are the whole deployment, which makes Docker the shortest route onto a machine that is not your laptop.

## Before you begin

- Docker on the machine that will run WAF Harness. The examples below cover both Docker Compose and `docker run`.
- A checkout of the repository, to build the image from: `git clone https://github.com/nicolaepocroianu/waf-harness && cd waf-harness`.
- An API key for one model provider.

## Start the container

Both examples run from the root of the checkout and build the image from its `Dockerfile`; the first build takes a few minutes. Use either tab.

```yaml tab="compose.yaml"
# docker/compose.yaml in the repository
services:
  wafh:
    build:
      context: ..
      dockerfile: Dockerfile
    image: waf-harness:local
    restart: unless-stopped
    ports:
      - "127.0.0.1:7364:7364"
    volumes:
      - wafh-data:/data
    stop_grace_period: 30s

volumes:
  wafh-data:
```

```bash tab="docker run"
docker build -t waf-harness:local .
docker volume create wafh-data
docker run -d --name wafh \
  -p 127.0.0.1:7364:7364 \
  -v wafh-data:/data \
  --restart unless-stopped \
  waf-harness:local
```

With Compose, start it with `docker compose -f docker/compose.yaml up -d --build`. Either way, the Web App is then at `http://localhost:7364` on the machine running Docker.

### Reach it from another machine

Both examples publish the port on the loopback interface of the machine running Docker, so a fresh deployment is not reachable from anywhere else. To use it from another machine, forward the port over ssh: `ssh -L 7364:127.0.0.1:7364 <host>`.

Exposing it to a network is a deliberate step. Publish the port on all interfaces instead: `-p 7364:7364` or `-p 0.0.0.0:7364:7364` with `docker run`, or `"7364:7364"` in compose. Preferably put it behind a reverse proxy that terminates TLS; see [Run behind a reverse proxy](#run-behind-a-reverse-proxy).

Inside its own network namespace, the container always listens on `0.0.0.0`, which is what makes a published port work at all. The address in `-p` sets the host's side.

## Sign in for the first time

A fresh data root has no password. Until one is set, the server prints a sign-in link in a framed notice every time it starts. Read it from the container's log:

```bash
docker compose -f docker/compose.yaml logs wafh        # or: docker logs wafh
```

The notice looks like this:

```
+----------------------------------------------------------------------------------------------+
|   This server has no admin password yet. Open this link to claim it:                         |
|                                                                                              |
|     http://localhost:7364/api/auth/claim?token=GSiEDYM8MbsrqtMj7ofq7klUyXcfQNwt3oUriUHiBI8   |
|                                                                                              |
|   The link lasts 30 days or until a password is set; restarting prints a fresh one.          |
+----------------------------------------------------------------------------------------------+
```

The `localhost` in that URL is the server's view of itself. With the loopback publish above it is also yours, so open the link as it is on the machine running Docker. If you published the container to a network, replace `localhost` with the host you reach it on. Either way, keep the whole `?token=...`.

The link signs you in as `admin`, and you set a password. A new link is minted on every start, so a restart invalidates the one you have and prints a fresh one.

### Set the password in advance

If reading a link from a log does not suit your setup, pin the password instead. Do this before the first start:

```yaml
environment:
  WAFH_SEED_ADMIN_PASSWORD: "choose-something-long"
```

The server then creates the built-in `admin` with that password (at least 8 characters) and prints no notice. The variable applies only while no user exists, which means the first boot of an empty data root. Adding it to a data root that has already been claimed changes nothing, and neither does changing it later.

## Configure a model

WAF Harness ships with no model credentials. Add a model on the **Models** page of the Web App, or with the CLI inside the container:

```bash
docker compose -f docker/compose.yaml exec -u wafh wafh \
  wafh config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

Keep `-u wafh` in the command. `docker exec` runs as root by default, so files it writes into `/data` would belong to root, while the server runs as uid 1000.

See [Models & Providers](/models) for the built-in groups.

## Run your first Task

In the Web App's sidebar, click **New chat**, then send a first message, such as "Create hello.txt containing Hello, WAF Harness". The agent's commands run inside the container; [What the agent can reach](#what-the-agent-can-reach) explains how to give it a directory from the host. [Conversations](/chat) covers the chat page in full.

## Choose an image tag

You name the image yourself when you build it; the examples on this page use `waf-harness:local`. It is built for the platform of the machine that runs `docker build`. To pin a version, check out that release's tag (`git checkout vX.Y.Z`) before building, and tag the image with it (`docker build -t waf-harness:X.Y.Z .`).

## What is in the image

| Item | Details |
| --- | --- |
| Base | Ubuntu 24.04 with the official Node.js runtime, at the version the release tarballs bundle |
| Command | `wafh server`, on `0.0.0.0:7364` |
| Data root | `/data`, declared as a volume. It holds model configuration, Sessions, Traces and the SQLite database |
| Process user | `wafh`, uid/gid 1000. The entrypoint starts as root only to take ownership of the data root, then drops to that user |
| Healthcheck | `GET /api/install` every 30s |
| Tools | `git`, `curl` and the standard Ubuntu userland, for the commands an agent runs |

### What the agent can reach

Everything the agent's `exec_command` runs happens inside this container, on its filesystem and its network. That is the isolation boundary, and also the limit: an agent can reach whatever the container can reach, and nothing else.

To give the agent a Workspace, mount a directory, for example `-v /srv/project:/srv/project`. The mount must be writable by uid 1000.

### Add tools to the image

The image carries no compiler and no language runtime besides Node. `apt-get install` inside the container works for a one-off, but the package is gone after the next rebuild. For anything you depend on, build a derived image:

```dockerfile
FROM waf-harness:local
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
USER wafh
```

The runtime image deliberately has no C/C++ toolchain: the toolchain lives in a build stage that is thrown away.

## Environment variables

These are the variables a container deployment touches. The full list is in the [Configuration Reference](/configuration).

| Variable | In this image |
| --- | --- |
| `WAFH_HOME` | `/data`. Change it only if you also move the volume |
| `HOST` | `0.0.0.0`, inside the container's own network namespace. `-p` decides the host side, and the examples keep it on loopback |
| `PORT` | `7364`. Changing it moves the healthcheck with it |
| `WAFH_SEED_ADMIN_PASSWORD` | Pins the initial admin password, on the first boot only. See [Set the password in advance](#set-the-password-in-advance) |
| `WAFH_TRUST_PROXY` | Set to `1` behind a reverse proxy that terminates TLS, so session cookies are marked `Secure` |
| `WAFH_PREVIEW_ORIGIN` | A second hostname routed to the same container, for Workspace HTML previews |
| `WAFH_UPDATE_CHECK` | `off` turns off the automatic release check. Model requests, remote-control connections, key authorization and the proxy test still go out |

### Run behind a reverse proxy

Publish the container on loopback, terminate TLS in front of it, and set `WAFH_TRUST_PROXY=1`. The proxy must set or strip `x-forwarded-proto` itself. That header comes from the caller, which is exactly why the server ignores it until you tell it otherwise. If you leave `WAFH_TRUST_PROXY` unset on an HTTPS deployment, session cookies are issued without the `Secure` flag.

### Serve Workspace previews

Previews of the HTML a Task produces are served from a separate origin when there is one. On a non-loopback bind there is no loopback counterpart to derive, so previews fall back to a same-origin sandbox, where cookies, `localStorage` and third-party embeds do not work. To get the isolated previews back, point `WAFH_PREVIEW_ORIGIN` at a second hostname routed to the same container. It must differ by hostname, not just by port.

## Upgrade the container

Update the checkout, rebuild the image and recreate the container. The data root is on the volume and carries over:

```bash
git pull && docker compose -f docker/compose.yaml up -d --build
```

> [!WARNING]
> Do not update from inside the container. The About dialog's **Software Update** section reports that this install cannot update itself, and anything `wafh update` installs there is lost when the container is recreated.

Stopping is graceful. On `SIGTERM` the server interrupts running Tasks, waits for them to wrap up, then closes the database. An idle server stops in well under a second, and a busy one can take several seconds, which is why the compose example raises Docker's 10-second grace period.

## Reset a forgotten admin password

Stop the server first, because a data root only ever has one writer. Then reset the password and start the server again:

```bash
docker compose -f docker/compose.yaml stop wafh
docker compose -f docker/compose.yaml run --rm wafh wafh server reset-admin-password
docker compose -f docker/compose.yaml start wafh
```

The reset needs no other authorization: the data root is the authorization, and anyone who can run this command already has the database. The `admin` account returns to the unclaimed state and its login sessions are revoked. Sign in again with the first-login link from the log, as in [Sign in for the first time](#sign-in-for-the-first-time).

## Next steps

- [Web App](/web-app): use WAF Harness from the browser.
- [Update WAF Harness](/updates): check your version and upgrade.
- [Security Model](/security): who can do what, and on the strength of which proof.
- [Configuration Reference](/configuration): every environment variable and config field.
