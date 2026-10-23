/** Pure helpers behind the sandbox panel. */

/** What the server reports about a preview, as far as the panel cares. */
export interface SandboxStatusLike {
  state: "pending_spec" | "pending_scaffold" | "missing_shared_module" | "stale" | "ready";
  playable: boolean;
  buildable: boolean;
}

/**
 * Whether there is a module to show at all, whoever built it: WAF Harness's assembly, or Loom,
 * whose modules the sandbox finds in the WAF checkout.
 */
export function sandboxHasModule(status: SandboxStatusLike | null): boolean {
  return (
    status !== null &&
    (status.state === "ready" ||
      status.state === "stale" ||
      status.state === "missing_shared_module")
  );
}

/**
 * The link that plays an activity. The server answers it with a redirect to the activity's
 * fixed link on the preview origin, where the module's code runs away from the App.
 * The query uses Loom's player.html names, so a link reads the same in both.
 */
export function playUrl(
  projectId: string,
  activityId: string,
  options: { scene?: string; language?: string } = {},
): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/sandbox/play`;
  const params = new URLSearchParams();
  if (options.language) params.set("languageCode", options.language);
  if (options.scene) params.set("startSceneId", options.scene);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
