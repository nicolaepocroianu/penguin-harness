/**
 * A played activity's query, read the way Loom's dev-sandbox reads `player.html`'s
 * (waf-loom `dev-sandbox/src/player.js`): `module`, `ref`, `languageCode`, `startSceneId`,
 * `resolution` and `source`, with Loom's own parsing for each. Penguin's older `language`
 * and `scene` stay accepted, so links made before keep working.
 *
 * Pure, so the routes that read a play query (the authenticated entries and the signed page)
 * read it alike.
 */
import { ACTIVITY_LANGUAGES, DEFAULT_LANGUAGE_CODE } from "./languages.js";

/** The module roots a Loom link names the product's owner by. */
export type PlaySource = "monorepo" | "legacy";

export interface PlayQuery {
  /** The product code; null when the link names none. */
  module: string | null;
  /** The ref number; null when the link names none. */
  ref: number | null;
  /** Why `ref` was refused, as Loom words it; null when it was fine or absent. */
  refError: string | null;
  /** Always one of the activity languages: an unknown or missing code is the default. */
  languageCode: string;
  /** Whether the link named a language at all; one that did not is carried on without one. */
  languageAsked: boolean;
  startSceneId: string | null;
  /** `<width>x<height>`; null when absent or not one. */
  resolution: string | null;
  source: PlaySource | null;
  /** Why `source` was refused; null when it was fine or absent. */
  sourceError: string | null;
  /**
   * `parent`: the App origin that opened the page, the only one it reports its state to and
   * takes requests from (see the player's inspector bridge). Not Loom's; null when absent or
   * not a bare http(s) origin.
   */
  parentOrigin: string | null;
}

/** Reads one parameter, by Loom's name first and then any alias. */
type Read = (name: string) => string | null | undefined;

function optional(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

/** The first of these parameters with a value: an empty one counts as absent. */
function first(read: Read, ...names: string[]): string | null {
  for (const name of names) {
    const value = optional(read(name));
    if (value !== null) return value;
  }
  return null;
}

/** Loom's `normalizeLanguageCode`: a listed code is kept, anything else is the default. */
export function normalizePlayLanguage(value: string | null | undefined): string {
  const code = String(value ?? "").trim();
  return ACTIVITY_LANGUAGES.some((language) => language.code === code)
    ? code
    : DEFAULT_LANGUAGE_CODE;
}

/** Loom's `parseResolution`: `^\d{2,5}x\d{2,5}$` with both sides at most 10000, else null. */
export function parsePlayResolution(value: string | null | undefined): string | null {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const width = Number.parseInt(match[1]!, 10);
  const height = Number.parseInt(match[2]!, 10);
  if (width < 1 || width > 10000 || height < 1 || height > 10000) return null;
  return `${width}x${height}`;
}

/** Loom's `parseRefNum`: a non-negative whole number, or the error Loom shows. */
export function parsePlayRef(
  value: string | null | undefined,
): { ref: number } | { error: string } {
  const text = String(value ?? "").trim();
  if (!text) return { error: "Ref is required. Use a non-negative whole number." };
  const parsed = /^\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    return { error: `Invalid ref "${text}". Use a non-negative whole number.` };
  return { ref: parsed };
}

/** A bare `http(s)://host[:port]` origin, as `URL.origin` writes it, or null. */
export function parsePlayParent(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === text
      ? text
      : null;
  } catch {
    return null;
  }
}

export function readPlayQuery(read: Read): PlayQuery {
  const refText = optional(read("ref"));
  const language = first(read, "languageCode", "language");
  const ref = refText === null ? null : parsePlayRef(refText);
  const sourceText = optional(read("source"));
  const source = sourceText === "monorepo" || sourceText === "legacy" ? sourceText : null;
  return {
    module: optional(read("module")),
    ref: ref && "ref" in ref ? ref.ref : null,
    refError: ref && "error" in ref ? ref.error : null,
    languageCode: normalizePlayLanguage(language),
    languageAsked: language !== null,
    startSceneId: first(read, "startSceneId", "scene"),
    resolution: parsePlayResolution(read("resolution")),
    source,
    sourceError:
      sourceText !== null && source === null
        ? `Invalid source "${sourceText}". Use monorepo or legacy.`
        : null,
    parentOrigin: parsePlayParent(read("parent")),
  };
}

/** The query a play link carries on, in Loom's names; only what was asked for. */
export function playQueryString(query: PlayQuery): string {
  const params = new URLSearchParams();
  if (query.module) params.set("module", query.module);
  if (query.ref !== null) params.set("ref", String(query.ref));
  if (query.languageAsked) params.set("languageCode", query.languageCode);
  if (query.startSceneId) params.set("startSceneId", query.startSceneId);
  if (query.resolution) params.set("resolution", query.resolution);
  if (query.source) params.set("source", query.source);
  if (query.parentOrigin) params.set("parent", query.parentOrigin);
  return params.toString();
}
