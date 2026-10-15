/**
 * Which repository this build is made from, and whether that repository publishes the
 * releases this build updates to. Every updater reads it — the desktop shell's, the server's
 * update reminder and self-update, `penguin update` — and so does the Web App for its release
 * links.
 *
 * A repository that publishes no releases says so here, and each updater then stands down
 * before any lookup: an install must never be offered, or replaced by, a build from another
 * repository. Its own entry point so the Web App can bundle it without the rest of the SDK.
 *
 * Turning `publishesReleases` on takes more than this constant: the desktop updater's GitHub
 * feed and download roots, the CLI's OSS mirror and electron-builder's `publish` block each
 * name their release channel separately.
 */
export interface ReleaseIdentity {
  /** The GitHub repository (`owner/name`) this build is made from. */
  readonly repository: string;
  /** Whether `repository` publishes releases this build updates to. */
  readonly publishesReleases: boolean;
}

export const RELEASE_IDENTITY: ReleaseIdentity = {
  repository: "nicolaepocroianu/penguin-harness",
  publishesReleases: false,
};
