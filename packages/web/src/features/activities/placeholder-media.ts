/**
 * Placeholder media: the blank video or animation the server binds an asset to until a real
 * file replaces it, so the player has something to load. The server names those paths for
 * each ref (`media-placeholders`); a binding is a placeholder when it is one of them, never
 * because of what its file is called. A placeholder is bound but it is not finished media,
 * so it is said apart from a real file wherever bindings are counted or marked.
 */
export type PlaceholderPaths = ReadonlySet<string>;

/** Before the server has answered, nothing is a placeholder and marks say bound or not. */
export const NO_PLACEHOLDERS: PlaceholderPaths = new Set();

/** Where an asset stands: a real file, the placeholder, or nothing bound. */
export type Binding = "file" | "placeholder" | "none";

export function bindingOf(
  placeholders: PlaceholderPaths,
  path: string | null | undefined,
): Binding {
  if (!path) return "none";
  return placeholders.has(path) ? "placeholder" : "file";
}
