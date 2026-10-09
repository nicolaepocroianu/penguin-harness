# Third-party notices

PenguinHarness itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)). Some **distributed
release artifacts** additionally bundle third-party programs and files, which keep their own
licenses. This file records those, and how to obtain their source.

Nothing listed here is source code of this repository. The programs below are downloaded by the
release workflow (`.github/workflows/release.yml`) and placed alongside the application inside the
release archives; the fonts are copied out of an npm dependency into the built web assets.
Installing from npm (`@prismshadow/penguin-cli`) bundles none of them; the one it fetches, FFmpeg,
is downloaded on the installing machine by an install script (see below).

What earns an entry is a third-party work redistributed **as its own file**. An npm package whose
JavaScript is compiled and minified into the application bundle (React, Shiki, xterm.js, KaTeX's own
code, ...) is not listed: its license travels with it in `node_modules` and in the lockfile, and
repeating every one of them here would be a second, staler copy of `pnpm-lock.yaml`.

## Node.js runtime — `node/`

Present in every archive except `penguin-universal.tar.gz`. Downloaded unmodified from the
official distribution at <https://nodejs.org/dist/>. Node.js is MIT-licensed with additional
notices for its dependencies; the full text ships inside the bundle
(`node/LICENSE`, and on Windows `node/LICENSE`).

Source: <https://github.com/nodejs/node> — the tag matching the bundled version, which is pinned
as `NODE_RUNTIME_VERSION` in the release workflow.

## MinGit (Git for Windows) — `git/`

Present in `penguin-win32-x64.zip` only.

The Windows package bundles **MinGit**, the minimal redistributable build of Git for Windows,
unmodified, as published by the Git for Windows project. It supplies the POSIX shell that the
agent's `exec_command` runs (`git/usr/bin/sh.exe`, which is GNU bash), roughly sixty core
utilities, and `git.exe`. It is used only when the machine has no Git for Windows installation of
its own; a user-installed one always takes precedence.

**License: GNU General Public License version 2** (with the additional per-component licenses
that Git for Windows ships). The complete license texts are included inside the bundle at
`git/LICENSE.txt` and `git/mingw64/share/licenses/`.

Version bundled: the release attached to the Git for Windows tag pinned as `MINGIT_TAG` in the
release workflow.

**Written offer / source availability.** The complete corresponding source code for the bundled
MinGit is published by the Git for Windows project at:

- <https://github.com/git-for-windows/git> — repository, tagged per release
- <https://github.com/git-for-windows/git/releases> — release assets, including the source
  archives for each tag

The bundled binaries are byte-identical to the `MinGit-<version>-64-bit.zip` asset of that tag;
no patches are applied. If you need the corresponding source and cannot obtain it from the URLs
above, open an issue on this repository and we will provide it.

## FFmpeg — `node_modules/ffmpeg-static/`

Present in the desktop application (staged by `packages/desktop/scripts/build-assets.mjs`). An npm
install of the server gets the same binary through its optional `ffmpeg-static` dependency, whose
install script downloads it on the installing machine. FFmpeg encodes activity scene videos and
converts generated speech to MP3. It is a separate program the server starts; it is not linked into
PenguinHarness.

**License: GNU General Public License version 3** (the build enables GPL components such as x264).
The license text ships beside the binary as `ffmpeg.LICENSE` (`ffmpeg.exe.LICENSE` on Windows), and
the build's own notes, naming its exact version, configuration and libraries, as `ffmpeg.README`
(`ffmpeg.exe.README`).

Version bundled: the binary that `ffmpeg-static` at the version pinned in
`packages/server/package.json` downloads, unmodified, from the builds it names: gyan.dev
(Windows), John Van Sickle's static builds (Linux) and the macOS static builds listed in
<https://github.com/eugeneware/ffmpeg-static>.

**Written offer / source availability.** The complete corresponding source code for FFmpeg is
published by the FFmpeg project at <https://ffmpeg.org/download.html> and
<https://git.ffmpeg.org/ffmpeg.git>, tagged per release; each build's README names the sources of
the libraries it includes. If you need the corresponding source for the bundled binary and cannot
obtain it from these, open an issue on this repository and we will provide it.

## KaTeX fonts — `KaTeX_*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, and the assets
the server serves.

Math rendering uses [KaTeX](https://katex.org), whose typefaces are separate font files rather than
code. The web build copies them unmodified out of the `katex` npm package into the application's
asset directory, where the browser fetches them by URL; bundling them locally is what lets the
desktop application render formulas with no network. Only the woff2 format is copied — the woff and
truetype fallbacks KaTeX also ships are dropped at build time (`dropNonWoff2FontSources` in
`packages/web/vite.config.ts`).

**License: MIT**, the same license as the rest of KaTeX. The full text ships inside the package, at
`node_modules/katex/LICENSE`.

Source: <https://github.com/KaTeX/KaTeX> — the tag matching the `katex` version resolved in
`pnpm-lock.yaml`. The font sources and the script that builds them live in that repository.
