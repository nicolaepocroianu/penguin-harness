# The upstream PenguinHarness infrastructure is removed

- **Date:** 2026-10-24
- **Type:** chore
- **Scope:** `ci`, `landing`, `server`, `web`, `cli`, `core`, `desktop`, `docs`, `scripts`
- **Breaking:** yes — the Penguin Go provider group, the platform-auth API and the OSS download options are gone

WAF Harness stopped taking upstream changes on 2026-10-23, but it still carried the services only `Prism-Shadow/penguin-harness` runs: its release and publishing workflows, the penguin.ooo site, the Penguin Go model relay, and the penguin.ooo / Alibaba Cloud OSS / Docker Hub download hosts. They are removed, and nothing in the code downloads from or links to penguin.ooo any more, apart from the ModelScope authorization bridge below.

## Workflows

- `release.yml`, `docker.yml`, `oss-staging.yml` and `pages.yml` are deleted. Every one of them published to upstream's npm scope, Docker Hub repository, OSS bucket or Pages site and was skipped on this fork.
- `desktop-build.yml` runs on manual dispatch only and builds unsigned installers. The signing inputs, the `apple-signing` / `desktop-build` environments, notarization and the `release/**` push trigger are gone.
- `ci.yml` lost its `workflow_call` entry (only `release.yml` called it). The three-platform test matrix is unchanged.
- `scripts/test-installer.sh` no longer extracts the stamping block from `release.yml`.

## Landing site

- `packages/landing` (the penguin.ooo landing page and blog) and `scripts/build-site.mjs` are deleted, along with `pnpm dev:landing` and `pnpm build:site`.
- The docs build standalone (`BASE_PATH` defaults to `/`). The docs and component gallery navigation no longer link to a parent site.
- The README logo is `packages/web/public/wafh-logo.svg`.

## Penguin Go

- The `penguin-go` provider group, its rows and its balance reader are gone from the model catalog. The Penguin Go key authorization routes (`/api/projects/:p/platform-auth/*`) and their "Sync models" menu row are gone too. So are `PENGUIN_GO_ORIGIN` and the fixed-protocol (MMSP-only) rule that applied only to that group.
- The server's one-time migration of Penguin Go routes stored before the MMSP switch (the subject of the unreleased backward-compatibility entry of 2026-10-15) is removed with the group.
- A Project file that still holds a `[providers.penguin-go]` table loads as a user-defined group, with its stored values kept as written.
- The ModelScope key authorization still uses the bridge at `go.penguin.ooo/modelscope` by default (`MODELSCOPE_BRIDGE_URL`).

## Download hosts

- `install.sh` and `install.ps1` download from the GitHub Releases of `nicolaepocroianu/waf-harness` (the stamped tag, else the latest Release). The OSS metadata, the speed probe and `WAFH_DOWNLOAD_SOURCE`, `WAFH_DOWNLOAD_SPEED_PROBE` and `WAFH_DOWNLOAD_FALLBACK_BASE_URL` are gone. `WAFH_DOWNLOAD_BASE_URL` still points an install at a self-hosted copy of a Release.
- `wafh update` discovers and downloads only through GitHub Releases. The desktop updater uses this repository's GitHub feed (or `WAFH_UPDATE_FEED_URL`). `WAFH_UPDATE_SOURCE` and `WAFH_UPDATE_SPEED_PROBE` are gone. Updates still stand down while the fork publishes no releases.
- The Machines page checks and fetches a release from GitHub only, and the `download` check no longer reports an `oss` field.
- No Docker image is published. `docker/compose.yaml` builds `waf-harness:local` from the Dockerfile, and the Docker quickstart says how.
- App attribution headers (OpenRouter, TokenDance) carry `https://github.com/nicolaepocroianu/waf-harness`, and in-app documentation links open `packages/docs/content/` on GitHub.
- The OSS publishing scripts and the release download manifest generator are removed.

## Repository docs

- `CONTRIBUTING`, `SECURITY`, the issue forms, the PR template and the code of conduct link to `nicolaepocroianu/waf-harness` instead of upstream. They also drop upstream's Discord and WeChat channels and the release, Docker Hub and signing instructions.
