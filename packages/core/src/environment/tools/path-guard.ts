/**
 * Roots a tool may read but must never write.
 *
 * Some workspaces sit beside trees the agent genuinely needs to READ — a shared
 * framework checkout it compiles against, a media library it resolves references in —
 * which rules out confining it to the workspace alone. Naming those trees is the
 * difference between "please do not write here" in a prompt and a refusal.
 *
 * This guards the in-process file tools only. Commands the agent spawns go through the
 * sandbox layer instead, which wraps argv before exec and never sees these calls.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface ProtectedRoot {
  /** Absolute path of the directory that is off limits for writes. */
  root: string;
  /** What the root is, named in the refusal so the agent can act on it. */
  label: string;
}

/** Whether `target` is `root` or sits beneath it, comparing lexically. */
function within(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The real path of `target`, or of the nearest ancestor that exists.
 *
 * A path being written usually does not exist yet, so it cannot be realpath'd
 * directly; and a lexical check alone is fooled by a symlink or a Windows junction
 * inside the workspace that points at a protected tree.
 */
async function realNearest(target: string): Promise<string> {
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = await fs.realpath(current);
      // Re-attach the part that does not exist yet, so a not-yet-created file under a
      // linked directory is still judged against where the link actually leads.
      const rest = path.relative(current, path.resolve(target));
      return rest ? path.join(real, rest) : real;
    } catch {
      const parent = path.dirname(current);
      // A root that cannot be resolved at all leaves the lexical answer standing.
      if (parent === current) return path.resolve(target);
      current = parent;
    }
  }
}

/**
 * The protected root a write to `target` would land in, or null when it is allowed.
 *
 * Checks lexically first because that is the common case and costs nothing, then
 * resolves links on both sides before allowing a write, so a path that only looks
 * outside a protected tree does not get through.
 */
export async function protectedWrite(
  target: string,
  roots: readonly ProtectedRoot[] | undefined,
): Promise<ProtectedRoot | null> {
  if (!roots?.length) return null;
  const resolved = path.resolve(target);
  for (const entry of roots) {
    if (within(resolved, path.resolve(entry.root))) return entry;
  }
  const real = await realNearest(resolved);
  for (const entry of roots) {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(entry.root);
    } catch {
      // A protected root that is not there cannot be written into either.
      continue;
    }
    if (within(real, realRoot)) return entry;
  }
  return null;
}

/** What the tool tells the model when it refuses. States the rule, not just the failure. */
export function protectedWriteMessage(target: string, entry: ProtectedRoot): string {
  return (
    `Refused to write ${target}: it is inside ${entry.label}, which is read-only ` +
    `(${entry.root}). Read from it freely, but write your changes inside the workspace.`
  );
}
