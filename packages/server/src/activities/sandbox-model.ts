/**
 * The dev sandbox's decisions, as pure functions.
 *
 * Loom's sandbox is a separate Express server on its own port, reverse-proxied by the
 * backend. Penguin's is Hono routes inside the server it already runs, spawning the
 * module's own webpack build as a managed child — no second HTTP server, no proxy layer,
 * and the auth, session and preview-token machinery already in place stays in place.
 *
 * What lives here is everything that can be decided without a socket or a child process:
 * whether a built module is still current, what state a preview is in and why it is not
 * ready, and how a byte range on a media request resolves. Those are the parts most likely
 * to be wrong in ways a running server hides.
 */

/** Where a preview is, in Loom's own vocabulary, so the two stay comparable. */
export type PreviewState =
  /** No saved specification, so there are no scenes to play. */
  | "pending_spec"
  /** A specification, but no module tree to serve. */
  | "pending_scaffold"
  /** The module belongs to another ref of this product; that ref has to build it. */
  | "missing_shared_module"
  /** Built, and the build is older than the sources. */
  | "stale"
  | "ready";

export interface PreviewInputs {
  hasSpec: boolean;
  hasModule: boolean;
  /** Whether this activity's ref owns the module its product shares. */
  canonicalRef: boolean;
  /** When the module was last built, in epoch milliseconds; null when never. */
  builtAtMs: number | null;
  /** Modification times of the files the build reads. */
  sourceMtimesMs: readonly number[];
}

/**
 * Whether a build is older than anything it was built from.
 *
 * Compared with `>=` rather than `>`: a source written in the same millisecond as the
 * build finished is a source the build may not have seen, and rebuilding a current module
 * costs a moment while serving a stale one costs an author's trust in the preview.
 */
export function moduleStale(builtAtMs: number | null, sourceMtimesMs: readonly number[]): boolean {
  if (builtAtMs === null) return true;
  return sourceMtimesMs.some((mtime) => mtime >= builtAtMs);
}

/** What the preview can do right now, and why not when it cannot. */
export function previewState(inputs: PreviewInputs): PreviewState {
  if (!inputs.hasSpec) return "pending_spec";
  // Checked before the scaffold: a non-canonical ref has no business building, so telling
  // it the scaffold is missing would send an author to a button that must refuse them.
  if (!inputs.canonicalRef) return "missing_shared_module";
  if (!inputs.hasModule) return "pending_scaffold";
  if (moduleStale(inputs.builtAtMs, inputs.sourceMtimesMs)) return "stale";
  return "ready";
}

/** Whether this state can serve an activity at all, stale or not. */
export function previewPlayable(state: PreviewState): boolean {
  return state === "ready" || state === "stale";
}

/** Whether a request in this state should trigger a build before being served. */
export function previewNeedsBuild(state: PreviewState): boolean {
  return state === "stale" || state === "pending_scaffold";
}

export interface ByteRange {
  start: number;
  end: number;
  /** Bytes this range covers, for `Content-Length`. */
  length: number;
}

/**
 * A single byte range from a `Range` header, for `<video>` seeking.
 *
 * Returns null when there is no usable range and the whole file should be sent, and
 * `"unsatisfiable"` when the client asked for something outside the file — which is a 416,
 * not a silent full-file response, because a player that gets 200 to a range request it
 * cannot use will seek forever.
 *
 * Only `bytes` and only one range: a multipart range response is a different content type
 * and no WAF media player asks for one.
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (size <= 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-500` is the LAST 500 bytes, not the first.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0) return "unsatisfiable";
    if (start >= size) return "unsatisfiable";
    // An open-ended range runs to the end of the file, and an end past it is clamped
    // rather than refused -- a player asking for more than exists still wants what exists.
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
    if (!Number.isSafeInteger(end) || end < start) return "unsatisfiable";
  }
  return { start, end, length: end - start + 1 };
}

/**
 * Whether an `If-Range` validator still matches, deciding between a partial response and
 * a full one.
 *
 * A mismatch means the file changed since the client last saw it, and continuing to serve
 * ranges from a different file is how a video ends up playing two halves of two takes.
 */
export function ifRangeMatches(ifRange: string | null | undefined, etag: string): boolean {
  if (!ifRange) return true;
  return ifRange.trim() === etag;
}

/**
 * The media path a preview request is asking for, or null when it is not one this origin
 * may serve.
 *
 * The same containment discipline as everywhere else in this port: a path that climbs out
 * of the media root is refused rather than normalised into something plausible.
 */
export function previewMediaPath(raw: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed escape is not a path; it is a client bug or a probe.
      return null;
    }
  })();
  if (decoded === null || !decoded) return null;
  if (decoded.includes("\0")) return null;
  const parts = decoded.split(/[\\/]+/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  // Windows refuses these too, and letting one through would mean an error from the
  // filesystem rather than a clear refusal here.
  if (parts.some((part) => /[:*?"<>|]/.test(part) || /[. ]$/.test(part))) return null;
  return parts.join("/");
}
