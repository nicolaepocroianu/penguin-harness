/**
 * Serving a built module's own files to a running preview.
 *
 * The payload points a module's `require` entries at a per-activity route, so something has
 * to answer it. These are the module's code, styles and layout — small text files read once
 * at load, not the media stream that `media-origin` handles.
 *
 * The rule that matters is which files may be served at all. A build workspace holds the
 * module's sources, its `node_modules`, its build log and whatever else the assembly agent
 * wrote. A preview needs the built output and the files the definition names; handing out
 * the rest turns a preview route into a way to read a workspace.
 */
import { previewMediaPath } from "./sandbox-model.js";

/** What a preview may fetch from a build workspace. */
const SERVABLE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".json",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Directories inside a build workspace a preview never reaches into. */
const CLOSED_DIRS = new Set(["node_modules", ".git", ".typescript-build"]);

function extension(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  const slash = Math.max(pathname.lastIndexOf("/"), pathname.lastIndexOf("\\"));
  return dot > slash ? pathname.slice(dot).toLowerCase() : "";
}

/**
 * The module file this request is asking for, or null when it is not one to serve.
 *
 * Three refusals, and each has a reason. A path that climbs out is refused by shape, as
 * everywhere else in this port. A dependency or version-control directory is closed
 * because a preview has no business reading either. And an extension nobody serves is
 * refused rather than sent as bytes: a build workspace holds `.log`, `.ts` and `.env`
 * files, and none of them belong in a browser.
 */
export function moduleFilePath(raw: string): string | null {
  const relative = previewMediaPath(raw);
  if (!relative) return null;
  if (relative.split("/").some((part) => CLOSED_DIRS.has(part))) return null;
  if (!SERVABLE_EXTENSIONS.has(extension(relative))) return null;
  return relative;
}

/**
 * The content type for a module file.
 *
 * Only ever called for a path `moduleFilePath` accepted, so every extension is known; the
 * fallback exists so a future addition to one list without the other is inert rather than
 * a crash.
 */
export function moduleContentType(pathname: string): string {
  return CONTENT_TYPES[extension(pathname)] ?? "application/octet-stream";
}

/**
 * Headers for a served module file.
 *
 * Never cached. A preview's whole purpose is to show the build that exists right now, and
 * a module file at a stable URL with a cache header is how an author ends up looking at
 * yesterday's code and not knowing it. Media is versioned instead, because it is large and
 * its URL carries the draft revision.
 */
export function moduleFileHeaders(relative: string): Record<string, string> {
  return {
    "content-type": moduleContentType(relative),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}
