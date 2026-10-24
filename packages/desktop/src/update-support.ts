/**
 * Whether this running form can update itself (pure; no Electron import, so it unit-tests
 * directly).
 *
 * A build whose repository publishes no releases (core's RELEASE_IDENTITY) has nothing to
 * update to, whatever its form: every feed electron-updater could reach belongs to another
 * repository, whose build would replace this install in place. That outranks the rest.
 *
 * electron-updater can only replace the forms it installed: the NSIS installer on
 * Windows, the app bundle on macOS, and an AppImage on Linux. A `.deb` belongs to the
 * system package manager — silently "updating" around dpkg would leave the two disagreeing
 * about what is installed — and a dev run has no installed artifact at all. A packaged
 * build on the dev profile (`--dev`) does have one, but it is the release instance's
 * installation, possibly running beside it; replacing it from here would pull the files
 * out from under that instance, so the dev profile stands down too.
 */
import type { Profile } from "./app-identity.js";

export type UpdateSupport =
  { supported: true } | { supported: false; reason: "fork" | "dev" | "linux-not-appimage" };

export function updateSupport(opts: {
  isPackaged: boolean;
  profile: Profile;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** RELEASE_IDENTITY.publishesReleases. */
  publishesReleases: boolean;
}): UpdateSupport {
  if (!opts.publishesReleases) return { supported: false, reason: "fork" };
  if (!opts.isPackaged || opts.profile !== "release") return { supported: false, reason: "dev" };
  // The AppImage runtime exports APPIMAGE with the path of the running image; a deb
  // install (or an extracted tree) has no such variable, and that is exactly the
  // distinction electron-updater's Linux path depends on.
  if (opts.platform === "linux" && !opts.env.APPIMAGE) {
    return { supported: false, reason: "linux-not-appimage" };
  }
  return { supported: true };
}

/**
 * Optional feed override (`WAFH_UPDATE_FEED_URL`), what makes an end-to-end update
 * test possible against a local server. Returns null when unset or unparseable — an
 * unusable override must not silently redirect updates, so the caller keeps the default
 * GitHub feed.
 */
export function feedUrlOverride(env: NodeJS.ProcessEnv): string | null {
  const raw = env.WAFH_UPDATE_FEED_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
