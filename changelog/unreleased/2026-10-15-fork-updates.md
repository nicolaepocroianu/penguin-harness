# Updaters stand down on a build whose repository publishes no releases

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `core`, `desktop`, `server`, `cli`, `web`

The desktop updater, the server's update reminder and self-update, and `penguin update` all followed the releases of `Prism-Shadow/penguin-harness`, so a Waterford install would have been offered, and could have installed, upstream's next release. Core gained a committed `RELEASE_IDENTITY` constant naming the repository a build is made from and whether that repository publishes releases. On this fork it names `nicolaepocroianu/penguin-harness`, which publishes none, and every updater now stands down before any network call.

## Details

- `@prismshadow/penguin-core` exported `RELEASE_IDENTITY` and its `ReleaseIdentity` type from the main entry and from a new `@prismshadow/penguin-core/release-identity` subpath, which the Web App bundles.
- Desktop: `updateSupport` returned `unsupported` with the new reason `fork` before looking at the install form, so `initUpdater` set no feed and scheduled no check. The "Check for Updates…" menu item was disabled on such a build, and its dialog named the repository.
- Server: `UpdateCheckService` read the release identity instead of its own repository slug, and answered `disabled` for a repository that publishes no releases (the path `PENGUIN_UPDATE_CHECK=off` takes), forced checks included. The self-update job ended at once as `unsupported` with the new reason `fork` and spawned nothing. Its output classifier also treated the CLI's new refusal as `unsupported`.
- CLI: `REPO_SLUG` read the release identity. `penguin update`, `--check` and `--release` included, printed that the build's repository publishes no releases and stopped before any release lookup.
- Web App: the update modal said "This build comes from nicolaepocroianu/penguin-harness, which publishes no releases, so it does not update itself" in place of any Releases link, for the server's `disabled` answer and the shell's `fork` reason alike. The release-notes and Releases links read the release identity.
- `DesktopUpdateStatus.reason` and `UpdateRunResponse.reason` gained the value `fork`.
