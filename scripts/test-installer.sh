#!/bin/sh
# Hermetic installer tests with tiny fixtures: canonical bundle layout, offline install with no
# network, POSIX upgrade rollback, and the online download flow through a stubbed curl
# (checksum layers, no-fallback failures, pre-0.1.6 legacy archives from pinned versions).
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
ARTIFACT_DIR="$WORK_DIR/artifacts"
PAYLOAD_DIR="$WORK_DIR/payloads"
STUB_BIN="$WORK_DIR/bin"
TEST_HOME="$WORK_DIR/home"
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

fail_test() {
  echo "test failure: $1" >&2
  exit 1
}

# --- The launchers the release packages ship verbatim (scripts/launchers/). They are the only
#     spelling of the payload layout, so moving where web/ or node/ sits fails here rather than
#     shipping a package whose `wafh` cannot find its own web assets. ---
LAUNCHER_SH="$ROOT_DIR/scripts/launchers/wafh"
LAUNCHER_CMD="$ROOT_DIR/scripts/launchers/wafh.cmd"
[ -x "$LAUNCHER_SH" ] || fail_test "scripts/launchers/wafh is missing or not executable"
for marker in 'WAFH_WEB_DIST:-$DIR/web' '$DIR/node/bin/node' '$DIR/lib/dist/wafh.js' \
  'WAFH_BUNDLED_BROWSERS:-$DIR/browsers'; do
  grep -qF "$marker" "$LAUNCHER_SH" || fail_test "the POSIX launcher does not carry $marker"
done
sh -n "$LAUNCHER_SH" || fail_test "the POSIX launcher is not valid sh"
for marker in '%DIR%\web' '%DIR%\node\node.exe' '%DIR%\lib\dist\wafh.js' \
  'WAFH_BUNDLED_BROWSERS=%DIR%\browsers'; do
  grep -qF "$marker" "$LAUNCHER_CMD" || fail_test "the Windows launcher does not carry $marker"
done
# .gitattributes keeps this one CRLF, the only form cmd.exe is fully reliable with.
grep -q "$(printf '\r')" "$LAUNCHER_CMD" || fail_test "the Windows launcher is not CRLF"
# No wafh.ps1: PowerShell would prefer it on PATH, and Restricted policy would then break
# the plain `wafh` command.
[ ! -e "$ROOT_DIR/scripts/launchers/wafh.ps1" ] \
  || fail_test "a wafh.ps1 launcher must not be shipped"

write_sha256() {
  file="$1"
  (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
}

make_posix_payload() {
  target="$1"
  output="$2"
  behavior="${3:-success}"
  payload="$WORK_DIR/payload-src"
  rm -rf "$payload"
  mkdir -p "$payload/wafh/bin" "$payload/wafh/lib" "$payload/wafh/web"
  if [ "$behavior" = "final-failure" ]; then
    {
      printf '%s\n' '#!/bin/sh'
      printf '%s\n' 'case "$0" in'
      printf '%s\n' '  */.staging.*/bin/wafh) echo fixture-new; exit 0 ;;'
      printf '%s\n' '  *) echo "fixture final-path failure" >&2; exit 42 ;;'
      printf '%s\n' 'esac'
    } > "$payload/wafh/bin/wafh"
  else
    {
      printf '%s\n' '#!/bin/sh'
      printf 'echo %s\n' "${4:-fixture-old}"
    } > "$payload/wafh/bin/wafh"
  fi
  chmod +x "$payload/wafh/bin/wafh"
  printf '%s\n' fixture > "$payload/wafh/lib/fixture.txt"
  mkdir -p "$payload/wafh/lib/vendor"
  printf '%s\n' vendored > "$payload/wafh/lib/vendor/data.txt"
  printf '%s\n' fixture > "$payload/wafh/web/index.html"
  printf '{"schemaVersion":1,"target":"%s"}\n' "$target" > "$payload/wafh/package-manifest.json"
  tar -czf "$output" -C "$payload" wafh
}

command -v sha256sum >/dev/null 2>&1 || fail_test "sha256sum is required"
command -v unzip >/dev/null 2>&1 || fail_test "unzip is required"
mkdir -p "$ARTIFACT_DIR" "$PAYLOAD_DIR" "$STUB_BIN" "$TEST_HOME"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) HOST_TARGET="linux-x64" ;;
  Linux:aarch64) HOST_TARGET="linux-arm64" ;;
  Darwin:x86_64) HOST_TARGET="darwin-x64" ;;
  Darwin:arm64) HOST_TARGET="darwin-arm64" ;;
  *) fail_test "unsupported fixture platform" ;;
esac
HOST_ASSET="wafh-$HOST_TARGET.tar.gz"

# --- Build fixture payloads and package them exactly like the release workflow. ---
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64 universal; do
  make_posix_payload "$target" "$PAYLOAD_DIR/$target.tar.gz"
done
windows_payload="$WORK_DIR/windows/wafh"
mkdir -p "$windows_payload/bin"
printf '%s\r\n' '@echo off' 'echo fixture-old' > "$windows_payload/bin/wafh.cmd"
printf '%s\n' '{"schemaVersion":1,"target":"win32-x64"}' > "$windows_payload/package-manifest.json"
(cd "$WORK_DIR/windows" && zip -qr "$PAYLOAD_DIR/win32-x64.zip" wafh)

# The test browser each platform payload gains, from a stub installer: no download. It records
# the Playwright platform it was asked for, so a payload carrying another target's browser fails.
FAKE_BROWSER_INSTALLER="$STUB_BIN/fake-test-browser-installer"
{
  printf '%s\n' '#!/bin/sh'
  printf '%s\n' 'mkdir -p "$1/chromium-0000"'
  printf '%s\n' 'printf "%s\n" "$2" > "$1/chromium-0000/platform"'
} > "$FAKE_BROWSER_INSTALLER"
chmod +x "$FAKE_BROWSER_INSTALLER"

WAFH_TEST_BROWSER_INSTALLER="$FAKE_BROWSER_INSTALLER" \
  sh "$ROOT_DIR/scripts/package-release-bundles.sh" "$PAYLOAD_DIR" "$ARTIFACT_DIR"

# --- The test browser: every platform payload carries one for its own platform at
#     wafh/browsers/, the directory the launchers name; the universal payload has none. ---
for target_platform in linux-x64:ubuntu22.04-x64 linux-arm64:ubuntu22.04-arm64 \
  darwin-x64:mac14 darwin-arm64:mac14-arm64; do
  target="${target_platform%%:*}"
  platform="${target_platform#*:}"
  browser_dir="$WORK_DIR/browser-check-$target"
  mkdir -p "$browser_dir"
  tar -xzf "$PAYLOAD_DIR/$target.tar.gz" -C "$browser_dir"
  [ -f "$browser_dir/wafh/browsers/chromium-0000/platform" ] \
    || fail_test "$target payload has no test browser at wafh/browsers"
  [ "$(cat "$browser_dir/wafh/browsers/chromium-0000/platform")" = "$platform" ] \
    || fail_test "$target payload carries a test browser for another platform"
done
if tar -tzf "$PAYLOAD_DIR/universal.tar.gz" | grep -q '^wafh/browsers/'; then
  fail_test "the universal payload must not carry a platform's test browser"
fi
browser_dir="$WORK_DIR/browser-check-win32-x64"
mkdir -p "$browser_dir"
unzip -q "$PAYLOAD_DIR/win32-x64.zip" -d "$browser_dir"
[ "$(cat "$browser_dir/wafh/browsers/chromium-0000/platform" 2>/dev/null)" = win64 ] \
  || fail_test "win32-x64 payload has no Windows test browser at wafh/browsers"

# Model a release's installer stamping without changing the source installer.
STAMPED_INSTALLER="$WORK_DIR/install-v0.0.0-test.sh"
grep -q 'EMBEDDED_RELEASE_VERSION="__WAFH_RELEASE_VERSION__"' "$ROOT_DIR/install.sh" \
  || fail_test "POSIX installer release-version token is missing"
sed 's/__WAFH_RELEASE_VERSION__/v0.0.0-test/' "$ROOT_DIR/install.sh" > "$STAMPED_INSTALLER"
chmod +x "$STAMPED_INSTALLER"

# --- Canonical layout: flat bundles, exact member set, byte-identical installers, both
#     checksum layers valid. ---
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64 universal; do
  bundle="$ARTIFACT_DIR/wafh-$target.tar.gz"
  [ -f "$bundle" ] || fail_test "missing $(basename "$bundle")"
  (cd "$ARTIFACT_DIR" && sha256sum -c "$(basename "$bundle").sha256" >/dev/null) \
    || fail_test "outer checksum failed for $(basename "$bundle")"
  members="$(tar -tzf "$bundle" | sed 's#^\./##' | sed '/^$/d' | LC_ALL=C sort)"
  expected="$(printf '%s\n' install.sh payload.tar.gz payload.tar.gz.sha256 | LC_ALL=C sort)"
  [ "$members" = "$expected" ] || fail_test "$(basename "$bundle") has an unexpected layout"
  extracted="$WORK_DIR/layout-$target"
  mkdir -p "$extracted"
  tar -xzf "$bundle" -C "$extracted"
  [ -x "$extracted/install.sh" ] || fail_test "$(basename "$bundle") installer is not executable"
  cmp -s "$ROOT_DIR/install.sh" "$extracted/install.sh" \
    || fail_test "$(basename "$bundle") installer differs from the repository installer"
  (cd "$extracted" && sha256sum -c payload.tar.gz.sha256 >/dev/null) \
    || fail_test "$(basename "$bundle") payload checksum failed"
  cmp -s "$PAYLOAD_DIR/$target.tar.gz" "$extracted/payload.tar.gz" \
    || fail_test "$(basename "$bundle") payload differs from its input"
done

windows_bundle="$ARTIFACT_DIR/wafh-win32-x64.zip"
[ -f "$windows_bundle" ] || fail_test "missing wafh-win32-x64.zip"
(cd "$ARTIFACT_DIR" && sha256sum -c wafh-win32-x64.zip.sha256 >/dev/null) \
  || fail_test "outer checksum failed for wafh-win32-x64.zip"
members="$(unzip -Z1 "$windows_bundle" | LC_ALL=C sort)"
expected="$(printf '%s\n' install.cmd install.ps1 payload.zip payload.zip.sha256 | LC_ALL=C sort)"
[ "$members" = "$expected" ] || fail_test "wafh-win32-x64.zip has an unexpected layout"
extracted="$WORK_DIR/layout-win32-x64"
mkdir -p "$extracted"
(cd "$extracted" && unzip -q "$windows_bundle")
cmp -s "$ROOT_DIR/install.ps1" "$extracted/install.ps1" \
  || fail_test "Windows bundle installer differs from the repository installer"
cmp -s "$ROOT_DIR/install.cmd" "$extracted/install.cmd" \
  || fail_test "Windows bundle install.cmd differs from the repository entry point"
(cd "$extracted" && sha256sum -c payload.zip.sha256 >/dev/null) \
  || fail_test "Windows bundle payload checksum failed"
cmp -s "$PAYLOAD_DIR/win32-x64.zip" "$extracted/payload.zip" \
  || fail_test "Windows bundle payload differs from its input"

# --- Offline install: extract the bundle once and run its installer, with a curl that always
#     fails first on PATH — the offline path must never touch the network. ---
cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/sh
echo "unexpected network access: curl $*" >&2
exit 7
EOF
chmod +x "$STUB_BIN/curl"

OFFLINE_DIR="$WORK_DIR/offline"
OFFLINE_INSTALL="$WORK_DIR/offline-install"
mkdir -p "$OFFLINE_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$OFFLINE_DIR"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$OFFLINE_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$OFFLINE_DIR/install.sh" >/dev/null \
  || fail_test "offline install from the extracted bundle failed"
[ "$("$OFFLINE_INSTALL/bin/wafh" --version)" = "fixture-old" ] \
  || fail_test "offline install did not produce a working command"
# The payload's test browser lands beside the program, where the launcher names it.
[ -f "$OFFLINE_INSTALL/browsers/chromium-0000/platform" ] \
  || fail_test "offline install did not carry the payload's test browser into the install"

# A second installation beside the first leaves `wafh` with the first: with
# --no-modify-path the ~/.local/bin symlink is not repointed.
SECOND_INSTALL="$WORK_DIR/offline-second-install"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$SECOND_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$OFFLINE_DIR/install.sh" --no-modify-path >/dev/null \
  || fail_test "second install with --no-modify-path failed"
[ "$("$SECOND_INSTALL/bin/wafh" --version)" = "fixture-old" ] \
  || fail_test "second install did not produce a working command"
[ "$(readlink "$TEST_HOME/.local/bin/wafh")" = "$OFFLINE_INSTALL/bin/wafh" ] \
  || fail_test "--no-modify-path repointed the wafh symlink at the second installation"
# The same flag arrives through `sh -s --`, which is how a machine install passes it.
THIRD_INSTALL="$WORK_DIR/offline-third-install"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$THIRD_INSTALL" WAFH_ARCHIVE="$ARTIFACT_DIR/$HOST_ASSET" \
  PATH="$STUB_BIN:$PATH" sh -s -- --no-modify-path < "$OFFLINE_DIR/install.sh" >/dev/null \
  || fail_test "install over stdin with --no-modify-path failed"
[ "$(readlink "$TEST_HOME/.local/bin/wafh")" = "$OFFLINE_INSTALL/bin/wafh" ] \
  || fail_test "--no-modify-path over stdin repointed the wafh symlink"

# The stamped installer inside a released bundle must still prefer its sibling payload and
# never resolve metadata or download an online asset.
STAMPED_OFFLINE_DIR="$WORK_DIR/offline-stamped"
STAMPED_OFFLINE_INSTALL="$WORK_DIR/offline-stamped-install"
mkdir -p "$STAMPED_OFFLINE_DIR"
cp "$STAMPED_INSTALLER" "$STAMPED_OFFLINE_DIR/install.sh"
cp "$OFFLINE_DIR/payload.tar.gz" "$OFFLINE_DIR/payload.tar.gz.sha256" "$STAMPED_OFFLINE_DIR/"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$STAMPED_OFFLINE_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$STAMPED_OFFLINE_DIR/install.sh" >/dev/null \
  || fail_test "stamped offline installer unexpectedly touched the network"

# A corrupted extracted payload must be rejected by the sealed checksum.
CORRUPT_DIR="$WORK_DIR/offline-corrupt"
mkdir -p "$CORRUPT_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$CORRUPT_DIR"
printf 'corruption' >> "$CORRUPT_DIR/payload.tar.gz"
set +e
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$WORK_DIR/offline-corrupt-install" PATH="$STUB_BIN:$PATH" \
  sh "$CORRUPT_DIR/install.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail_test "corrupted offline payload was not rejected"

# --- Local archives: the canonical bundle and a bare payload both install; a failing upgrade
#     rolls back to the previous installation. ---
LOCAL_INSTALL="$TEST_HOME/.waf-harness"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$ARTIFACT_DIR/$HOST_ASSET" >/dev/null \
  || fail_test "--archive with the canonical bundle failed"

payload_archive="$WORK_DIR/payload.tar.gz"
cp "$PAYLOAD_DIR/$HOST_TARGET.tar.gz" "$payload_archive"
write_sha256 "$payload_archive"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$payload_archive" >/dev/null \
  || fail_test "--archive with a bare payload failed"

failure_archive="$WORK_DIR/final-failure.tar.gz"
make_posix_payload "$HOST_TARGET" "$failure_archive" final-failure
write_sha256 "$failure_archive"
set +e
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$failure_archive" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail_test "failing POSIX upgrade unexpectedly succeeded"
[ "$("$LOCAL_INSTALL/bin/wafh" --version)" = "fixture-old" ] \
  || fail_test "previous POSIX installation was not restored"
[ -f "$LOCAL_INSTALL/browsers/chromium-0000/platform" ] \
  || fail_test "rollback did not restore the previous test browser"

# --- Pinned-directory upgrade: emulate a filesystem that refuses to rename in-use directories
#     (overlayfs reports EBUSY when `wafh update` replaces the very lib/ its own process runs
#     from). mv/rmdir stubs refuse directory renames that touch the installed lib, forcing
#     relocate_dir through its per-entry and copy fallbacks and the husk-reuse path. ---
PINNED_LIB="$LOCAL_INSTALL/lib"
export PINNED_LIB
cat > "$STUB_BIN/mv" <<'EOF'
#!/bin/sh
if [ -d "$1" ]; then
  case "$1" in
    "$PINNED_LIB" | "$PINNED_LIB"/*)
      echo "mv: cannot move '$1': Device or resource busy" >&2
      exit 1
      ;;
  esac
fi
exec /bin/mv "$@"
EOF
cat > "$STUB_BIN/rmdir" <<'EOF'
#!/bin/sh
case "$1" in
  "$PINNED_LIB")
    echo "rmdir: failed to remove '$1': Device or resource busy" >&2
    exit 1
    ;;
esac
exec /bin/rmdir "$@"
EOF
chmod +x "$STUB_BIN/mv" "$STUB_BIN/rmdir"

pinned_archive="$WORK_DIR/pinned-upgrade.tar.gz"
make_posix_payload "$HOST_TARGET" "$pinned_archive" success fixture-upgraded
write_sha256 "$pinned_archive"
HOME="$TEST_HOME" WAFH_INSTALL_DIR="$LOCAL_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$ROOT_DIR/install.sh" --archive "$pinned_archive" >/dev/null \
  || fail_test "upgrade with a pinned lib directory failed"
rm -f "$STUB_BIN/mv" "$STUB_BIN/rmdir"
[ "$("$LOCAL_INSTALL/bin/wafh" --version)" = "fixture-upgraded" ] \
  || fail_test "pinned-lib upgrade did not install the new version"
[ -f "$LOCAL_INSTALL/lib/vendor/data.txt" ] \
  || fail_test "pinned-lib upgrade lost the copied lib subdirectory"
# A package without a test browser (the universal one, or this fixture) leaves none behind:
# a browser from the previous package would not match the new program's Playwright.
[ ! -e "$LOCAL_INSTALL/browsers" ] \
  || fail_test "an upgrade to a package without a test browser kept the previous one"
[ -z "$(ls -A "$LOCAL_INSTALL" | grep -E '^\.(old|staging)\.' || :)" ] \
  || fail_test "pinned-lib upgrade left staging or backup directories behind"

# --- Online flow through a stubbed curl. The canonical bundle is served for current releases;
#     MODE=legacy serves a pre-0.1.6 program archive, which must still install from a pinned
#     version. Checksum failures and download failures must fail without any fallback. ---
LEGACY_ARCHIVE="$WORK_DIR/legacy.tar.gz"
make_posix_payload "$HOST_TARGET" "$LEGACY_ARCHIVE"
write_sha256 "$LEGACY_ARCHIVE"

BAD_DIR="$WORK_DIR/bad-bundle"
mkdir -p "$BAD_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$BAD_DIR"
printf '%064d  payload.tar.gz\n' 0 > "$BAD_DIR/payload.tar.gz.sha256"
BAD_BUNDLE="$WORK_DIR/bad-bundle.tar.gz"
tar -czf "$BAD_BUNDLE" -C "$BAD_DIR" .
write_sha256 "$BAD_BUNDLE"

REPO_URL="https://github.com/nicolaepocroianu/waf-harness"
SELF_HOSTED_BASE="https://downloads.example.test/wafh/v0.0.0-test"

cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/sh
set -eu
output=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -H | --header | --connect-timeout | --max-time | --speed-limit | --speed-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> "$REQUEST_LOG"
base="${url##*/}"
case "$MODE:$base" in
  404:wafh-*) exit 22 ;;
  network:wafh-*) exit 7 ;;
  outer-sha-mismatch:wafh-*.sha256) printf '%064d  %s\n' 0 "${base%.sha256}" > "$output" ;;
  outer-sha-mismatch:wafh-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  inner-sha-mismatch:wafh-*.sha256) cp "$BAD_BUNDLE.sha256" "$output" ;;
  inner-sha-mismatch:wafh-*) cp "$BAD_BUNDLE" "$output" ;;
  legacy:wafh-*.sha256) cp "$LEGACY_ARCHIVE.sha256" "$output" ;;
  legacy:wafh-*) cp "$LEGACY_ARCHIVE" "$output" ;;
  canonical:wafh-*.sha256) cp "$ARTIFACT_DIR/$base" "$output" ;;
  canonical:wafh-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  *) echo "unexpected fixture request: $url" >&2; exit 2 ;;
esac
EOF
chmod +x "$STUB_BIN/curl"
export ARTIFACT_DIR BAD_BUNDLE LEGACY_ARCHIVE ROOT_DIR HOST_ASSET

run_online_case() {
  name="$1"
  mode="$2"
  version="$3"
  expected="$4"
  expected_requests="$5"
  download_base_url="${6:-}"
  installer_path="${7:-$ROOT_DIR/install.sh}"
  CASE_LOG="$WORK_DIR/$name.log"
  CASE_OUTPUT="$WORK_DIR/$name.output"
  CASE_INSTALL="$WORK_DIR/$name-install"
  : > "$CASE_LOG"
  set +e
  REQUEST_LOG="$CASE_LOG" MODE="$mode" PATH="$STUB_BIN:$PATH" \
    HOME="$WORK_DIR/$name-home" WAFH_INSTALL_DIR="$CASE_INSTALL" \
    WAFH_VERSION="$version" WAFH_DOWNLOAD_BASE_URL="$download_base_url" \
    sh "$installer_path" >"$CASE_OUTPUT" 2>&1
  status=$?
  set -e
  if [ "$expected" = "success" ]; then
    [ "$status" -eq 0 ] || fail_test "$name unexpectedly failed"
  else
    [ "$status" -ne 0 ] || fail_test "$name unexpectedly succeeded"
  fi
  [ "$(wc -l < "$CASE_LOG" | tr -d ' ')" -eq "$expected_requests" ] \
    || fail_test "$name made an unexpected number of requests"
}

# An unstamped source copy downloads from the latest GitHub Release of this repository.
run_online_case canonical canonical "" success 2
[ "$("$WORK_DIR/canonical-install/bin/wafh" --version)" = "fixture-old" ] \
  || fail_test "canonical online install did not produce a working command"
[ "$(sed -n '1p' "$WORK_DIR/canonical.log")" = "$REPO_URL/releases/latest/download/$HOST_ASSET" ] \
  || fail_test "unstamped installer did not download the latest GitHub Release"

# A stamped Release installer downloads its own immutable tag.
run_online_case stamped canonical "" success 2 "" "$STAMPED_INSTALLER"
[ "$(sed -n '1p' "$WORK_DIR/stamped.log")" = "$REPO_URL/releases/download/v0.0.0-test/$HOST_ASSET" ] \
  || fail_test "stamped installer did not select its own immutable GitHub release"

# An explicit https base wins over the GitHub Release; a non-https one is refused up front.
run_online_case download-base-override canonical "" success 2 "$SELF_HOSTED_BASE"
[ "$(sed -n '1p' "$WORK_DIR/download-base-override.log")" = "$SELF_HOSTED_BASE/$HOST_ASSET" ] \
  || fail_test "download base override was not used"
run_online_case download-base-insecure canonical "" failure 0 "http://downloads.example.test/wafh"

run_online_case outer-mismatch outer-sha-mismatch "" failure 2
run_online_case inner-mismatch inner-sha-mismatch "" failure 2
run_online_case latest-404 404 "" failure 1
run_online_case pinned-network network v0.1.4 failure 1
run_online_case pinned-legacy legacy v0.1.4 success 2
grep -q "/releases/download/v0.1.4/$HOST_ASSET\$" "$WORK_DIR/pinned-legacy.log" \
  || fail_test "pinned legacy did not download the pinned GitHub asset"

echo "Installer bundle, offline, rollback and online tests passed."
