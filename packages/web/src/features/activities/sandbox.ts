/** Pure helpers behind the sandbox panel. */
import type { Tone } from "../../lib/tone";

/** What the server reports about a preview, as far as the panel cares. */
export interface SandboxStatusLike {
  state: "pending_spec" | "pending_scaffold" | "missing_shared_module" | "stale" | "ready";
  playable: boolean;
  buildable: boolean;
}

/**
 * The tone for a preview state.
 *
 * `missing_shared_module` is muted rather than a warning: it is not a fault, it is this ref
 * not owning the module, and nothing an author does here changes it. `stale` is attention
 * because something *will* happen when they press Play. Nothing here is colour-only — the
 * status line always carries the sentence too.
 */
export function sandboxTone(status: SandboxStatusLike): Tone {
  switch (status.state) {
    case "ready":
      return "success";
    case "stale":
      return "attention";
    case "missing_shared_module":
      return "muted";
    default:
      return "muted";
  }
}

/**
 * Whether the Build button does anything useful right now.
 *
 * Offered whenever the module could be built, and also when it is already current — a
 * rebuild is what an author asks for when they do not trust the last one.
 */
export function canBuild(status: SandboxStatusLike): boolean {
  return status.state !== "pending_spec" && status.state !== "missing_shared_module";
}

/**
 * Whether there is a module to show at all, whoever built it: Penguin's assembly, or Loom,
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
 * The link that plays an activity. The server answers it with a redirect to a signed,
 * short-lived link on the preview origin, where the module's code runs away from the App.
 */
export function playUrl(
  projectId: string,
  activityId: string,
  options: { scene?: string; language?: string } = {},
): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/sandbox/play`;
  const params = new URLSearchParams();
  if (options.language) params.set("language", options.language);
  if (options.scene) params.set("scene", options.scene);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
