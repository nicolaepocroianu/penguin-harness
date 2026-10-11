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

/** The most links a judged path may pass through, as the writer itself allows. */
const MAX_LINK_HOPS = 40;

/**
 * The real path of `target`, or of the nearest ancestor that exists — or null when its links
 * go round more than `MAX_LINK_HOPS` times, which a caller must treat as refused.
 *
 * A path being written usually does not exist yet, so it cannot be realpath'd
 * directly; and a lexical check alone is fooled by a symlink or a Windows junction
 * inside the workspace that points at a protected tree. A DANGLING link is the subtle case:
 * realpath cannot resolve it, yet the writer follows it and creates what it points at, so it
 * is judged by where it leads, not by where it sits.
 */
async function realNearest(target: string, hops = 0): Promise<string | null> {
  const full = path.resolve(target);
  let current = full;
  for (;;) {
    // Re-attached below, so a not-yet-created file under a linked directory is still
    // judged against where the link actually leads.
    const rest = path.relative(current, full);
    try {
      const real = await fs.realpath(current);
      return rest ? path.join(real, rest) : real;
    } catch {
      let link: string | null = null;
      try {
        link = await fs.readlink(current);
      } catch {
        // Not a link (or not there): look at its parent.
      }
      if (link !== null) {
        if (hops >= MAX_LINK_HOPS) return null;
        const leadsTo = path.resolve(path.dirname(current), link);
        return realNearest(rest ? path.join(leadsTo, rest) : leadsTo, hops + 1);
      }
      const parent = path.dirname(current);
      // A root that cannot be resolved at all leaves the lexical answer standing.
      if (parent === current) return full;
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
  // Links that go round and round are refused, as the writer would refuse them.
  if (real === null) return roots[0]!;
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

/**
 * Whether a write to `target` lands outside every one of `roots` — the only places a
 * confined Session may write (its Workspace, its scratchpad). Same two-step check as
 * `protectedWrite`: lexical first, then with links resolved on both sides, so a link inside
 * the Workspace that leads elsewhere does not count as inside it.
 */
export async function outsideWritableRoots(
  target: string,
  roots: readonly string[] | undefined,
): Promise<boolean> {
  if (roots === undefined) return false;
  const resolved = path.resolve(target);
  if (!roots.some((root) => within(resolved, path.resolve(root)))) return true;
  const real = await realNearest(resolved);
  if (real === null) return true;
  for (const root of roots) {
    const realRoot = await realNearest(root);
    if (realRoot !== null && within(real, realRoot)) return false;
  }
  return true;
}

/** What the tool tells a confined Session when it refuses a write outside its Workspace. */
export function outsideWritableRootsMessage(target: string): string {
  return (
    `Refused to write ${target}: this Session runs confined and may write only inside its ` +
    "workspace. Read from anywhere, but write your changes inside the workspace."
  );
}

/** What the tool tells the model when it refuses. States the rule, not just the failure. */
export function protectedWriteMessage(target: string, entry: ProtectedRoot): string {
  return (
    `Refused to write ${target}: it is inside ${entry.label}, which is read-only ` +
    `(${entry.root}). Read from it freely, but write your changes inside the workspace.`
  );
}
