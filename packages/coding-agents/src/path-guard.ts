/**
 * Which protected folder, if any, a permission ask would touch. An external agent writes
 * files itself, so Penguin cannot refuse a write the way its own file tools do; what it
 * does see is each permission ask, with the paths the agent reports in `locations` and
 * whatever its raw input names. That makes this a check on asks, not a confinement: an
 * agent that edits without asking, or names a path only inside a shell command, is not
 * caught here.
 */
import path from "node:path";

export interface GuardedToolCall {
  locations?: { path: string }[] | null;
  rawInput?: unknown;
}

/** Keys whose string values name files or folders in the raw inputs agents send. */
const PATH_KEY =
  /(^|_|[a-z])(path|paths|file|files|filepath|filename|dir|directory|cwd|target|destination|source)$/i;

/** The first path the call names inside one of `roots`, resolved; null when it names none. */
export function protectedPathIn(
  call: GuardedToolCall,
  roots: string[],
  workspaceDir: string,
): string | null {
  if (roots.length === 0) return null;
  const candidates = [
    ...(call.locations ?? []).map((location) => location.path),
    ...pathsIn(call.rawInput, false),
  ];
  for (const candidate of candidates) {
    const absolute = path.resolve(workspaceDir, candidate);
    if (roots.some((root) => isInside(root, absolute))) return absolute;
  }
  return null;
}

function pathsIn(value: unknown, underPathKey: boolean): string[] {
  if (typeof value === "string") return underPathKey && value !== "" ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => pathsIn(item, underPathKey));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => pathsIn(item, PATH_KEY.test(key)));
  }
  return [];
}

function isInside(root: string, candidate: string): boolean {
  const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const relative = path.relative(fold(path.resolve(root)), fold(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
