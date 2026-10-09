/**
 * The editor state of a module document, kept apart from the view so it can be tested
 * without a DOM: how a document is shown as text, whether the text differs from it, and
 * what the text parses to before it is sent.
 */
import type { ModuleDocument, ModuleDocuments } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

export type ModuleDocumentKind = "configuration" | "assessment" | "definition";

/** A document as the editor shows it. */
export function documentText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Whether the text says something other than the document, ignoring layout. */
export function documentChanged(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) !== JSON.stringify(value);
  } catch {
    return true;
  }
}

/** What the text parses to, or why it cannot be saved. */
export function parseDocument(
  text: string,
): { value: Record<string, unknown> } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { error: S.activities.moduleDocuments.notJson((cause as Error).message) };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { error: S.activities.moduleDocuments.notObject };
  return { value: value as Record<string, unknown> };
}

/** The line that says where a document came from. */
export function documentOrigin(
  source: ModuleDocuments["source"],
  document: ModuleDocument,
): string {
  const words = S.activities.moduleDocuments;
  if (source === "draft") return words.fromDraft;
  return source === "run" ? words.fromRun(document.file) : words.fromCheckout(document.file);
}

/** How many items an assessment has, or null when it is not one. */
export function assessmentItemCount(value: unknown): number | null {
  return value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items.length
    : null;
}

/** One file a definition's `require` names. */
export interface DefinitionFile {
  /** The `require` key: entry, layout, style, or whatever else the module names. */
  role: string;
  /** The URL as written, or null when the entry names none. */
  url: string | null;
  type: string | null;
  /**
   * The file's path inside the module, for a URL relative to it; null for an absolute URL or
   * none, which nothing here can open or look for.
   */
  path: string | null;
}

export interface DefinitionTheme {
  name: string;
  properties: { key: string; value: string }[];
}

/** What a definition says at a glance; every field tolerates the definition leaving it out. */
export interface DefinitionSummary {
  engine: string | null;
  schemaVersion: string | null;
  specificationVersion: string | null;
  themes: DefinitionTheme[];
  /** The module-wide `assets` and `properties`, as counts of their keys. */
  assets: number;
  properties: number;
  files: DefinitionFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

/**
 * The file a module-relative URL names, decoded once as the module route decodes it, without
 * `./`, a query or a fragment; null for a URL that names no module file.
 */
export function modulePath(url: string): string | null {
  const bare = url
    .trim()
    .split(/[?#]/, 1)[0]!
    .replace(/^(\.\/)+/, "");
  // A scheme, a protocol-relative or root-relative URL names no module file.
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // The module route refuses a malformed escape too.
    return null;
  }
  // The browser drops a `.` segment before it requests the file, so it names the same file;
  // a step out, or an empty segment the module route refuses, names none.
  const parts = decoded.split("/").filter((part) => part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part === "")) return null;
  return parts.join("/");
}

/** Where the preview serves a module file, each segment encoded once. */
export function moduleFileUrl(endpoint: string, path: string): string {
  return `${endpoint}/sandbox/module/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function definitionFile(role: string, entry: unknown): DefinitionFile {
  const url = typeof entry === "string" ? entry : isRecord(entry) ? scalar(entry.url) : null;
  const type = isRecord(entry) ? scalar(entry.type) : null;
  return { role, url, type, path: url ? modulePath(url) : null };
}

/** A property's value as one line of text: strings as written, anything else as JSON. */
function propertyText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

/** The summary of a parsed definition. */
export function definitionSummary(value: Record<string, unknown>): DefinitionSummary {
  const themes = isRecord(value.themes) ? value.themes : {};
  return {
    engine: scalar(value.engine),
    schemaVersion: scalar(value.schemaVersion),
    specificationVersion: scalar(value.specificationVersion),
    themes: Object.entries(themes).map(([name, theme]) => ({
      name,
      properties:
        isRecord(theme) && isRecord(theme.properties)
          ? Object.entries(theme.properties).map(([key, item]) => ({
              key,
              value: propertyText(item),
            }))
          : [],
    })),
    assets: isRecord(value.assets) ? Object.keys(value.assets).length : 0,
    properties: isRecord(value.properties) ? Object.keys(value.properties).length : 0,
    files: isRecord(value.require)
      ? Object.entries(value.require).map(([role, entry]) => definitionFile(role, entry))
      : [],
  };
}

/** The summary of a definition's text, or why the text is not one. */
export function readDefinition(text: string): { summary: DefinitionSummary } | { error: string } {
  const parsed = parseDocument(text);
  return "error" in parsed ? parsed : { summary: definitionSummary(parsed.value) };
}

/** Whether a module file a definition names is there, from the status the preview served. */
export type FilePresence = "found" | "missing" | "unknown";

export function filePresence(status: number): FilePresence {
  if (status >= 200 && status < 300) return "found";
  return status === 404 ? "missing" : "unknown";
}
