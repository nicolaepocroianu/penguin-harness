/**
 * What a built module declares about itself.
 *
 * A module ships a `definition.json` describing the engine it needs, the files it requires
 * and the assets each theme provides. The runtime is handed that, not the file: a theme is
 * chosen, and every relative URL in it is rewritten to a route the preview actually serves.
 *
 * The rewriting is the part that matters. A module's definition names its files relative to
 * itself, because in a deployment it sits at its own root. In a preview it sits behind a
 * per-activity route, so a URL left alone resolves against the harness and fetches nothing.
 */

/** Absolute or already-routed URLs, which the preview must not touch. */
const ROUTED_PREFIXES = ["http://", "https://", "/media", "/layouts"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every relative asset URL pointed at a route.
 *
 * Only `{ url }` entries are rewritten, and only when the URL is relative — a media URL,
 * a shared framework layout and an external address are already reachable, and prefixing
 * them would break all three. An entry already under the route prefix is left alone so
 * rewriting twice is harmless.
 */
export function rewriteRelativeUrls(value: unknown, routePrefix: string): unknown {
  if (Array.isArray(value)) return value.map((child) => rewriteRelativeUrls(child, routePrefix));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (isRecord(child) && typeof child.url === "string") {
        const url = child.url;
        const routed =
          ROUTED_PREFIXES.some((prefix) => url.startsWith(prefix)) || url.startsWith(routePrefix);
        return [key, routed ? child : { ...child, url: `${routePrefix}${url}` }];
      }
      return [key, rewriteRelativeUrls(child, routePrefix)];
    }),
  );
}

export interface ModuleDefinition {
  id?: unknown;
  specificationVersion?: unknown;
  schemaVersion?: unknown;
  engine?: unknown;
  engineVersion?: unknown;
  type?: unknown;
  require?: unknown;
  themes?: unknown;
  [key: string]: unknown;
}

export interface ModuleDeclaration {
  id: string;
  version: unknown;
  specificationVersion?: unknown;
  schemaVersion?: unknown;
  engine?: unknown;
  engineVersion?: unknown;
  type?: unknown;
  require: Record<string, unknown>;
  assets: Record<string, unknown>;
  properties: Record<string, unknown>;
}

/** Everything a module could not declare, in an author's words. */
export class ModuleDeclarationError extends Error {}

/**
 * The declaration for one theme of one module.
 *
 * A theme the definition does not have is refused rather than defaulted: the themes differ
 * in the assets they provide, so quietly picking another one produces an activity that
 * plays with the wrong pictures and reports nothing.
 */
export function moduleDeclaration(input: {
  definition: ModuleDefinition;
  packageVersion?: unknown;
  theme: string;
  /** Where this module's own files are served from, ending in a slash. */
  routePrefix: string;
}): ModuleDeclaration {
  const id = typeof input.definition.id === "string" ? input.definition.id.trim() : "";
  if (!id) throw new ModuleDeclarationError("The module definition has no id.");
  const themes = isRecord(input.definition.themes) ? input.definition.themes : {};
  const theme = themes[input.theme];
  if (!isRecord(theme))
    throw new ModuleDeclarationError(
      `The module ${id} has no theme "${input.theme}". It has: ${Object.keys(themes).join(", ") || "none"}.`,
    );

  return {
    id,
    version: input.packageVersion ?? 1,
    specificationVersion: input.definition.specificationVersion,
    schemaVersion: input.definition.schemaVersion,
    engine: input.definition.engine,
    engineVersion: input.definition.engineVersion,
    type: input.definition.type,
    require: rewriteRelativeUrls(
      isRecord(input.definition.require) ? input.definition.require : {},
      input.routePrefix,
    ) as Record<string, unknown>,
    assets: rewriteRelativeUrls(
      isRecord(theme.assets) ? theme.assets : {},
      input.routePrefix,
    ) as Record<string, unknown>,
    properties: isRecord(theme.properties) ? theme.properties : {},
  };
}
