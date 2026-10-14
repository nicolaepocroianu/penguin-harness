# Publishing workflows run in the upstream repository only

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `ci`

A push to `main` on the `nicolaepocroianu/penguin-harness` fork failed the `Docker` workflow at the Docker Hub login, because the fork has none of the secrets that publish to `hiyouga/penguinharness`. Every publishing or secret-dependent step now carries the guard `github.repository == 'Prism-Shadow/penguin-harness'`, the one the site deploy in `pages.yml` already used. A fork still builds and validates; it publishes nothing and looks for no credentials.

## Details

- `docker.yml`: the Docker Hub login is skipped and the build's `push` is forced off outside upstream, so the multi-platform build still runs. The PR-time `smoke` job is unchanged.
- `release.yml`: the `Publish GitHub Release` step, and the `mirror-oss`, `publish-npm` and `docker` jobs, run in upstream only. The `check-release`, `desktop` and `release` build steps run everywhere.
- `desktop-build.yml`: macOS and Windows signing is required only in upstream, whether the caller is `release.yml`, a dispatch or a push to a `release/**` branch. A fork builds unsigned installers instead of failing on the missing signing secrets.
- `oss-staging.yml`: the manual OIDC staging check is skipped outside upstream.
- The header comments of the four workflows say where each one publishes. `ci.yml` and `pages.yml` are unchanged.
