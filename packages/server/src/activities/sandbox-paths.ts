/**
 * Where the sandbox reads and writes, and the reply it sends about a preview.
 *
 * Path resolution is worth its own module because every one of these is a containment
 * boundary. The sandbox serves files chosen by a URL, so "which directory is this request
 * allowed to reach" has to be one answer in one place rather than a `path.join` at each
 * call site.
 */
import path from "node:path";
import { previewNeedsBuild, previewPlayable, type PreviewState } from "./sandbox-model.js";

export interface SandboxRoots {
  /** The draft's directory, which is where authored media lives. */
  draftWorkspace: string;
}

/**
 * The directory a preview's media requests resolve against.
 *
 * The draft's own `media/`, not an assembly run's copy — serving the draft's files is what
 * makes a newly saved asset appear without rebuilding anything.
 */
export function sandboxMediaRoot(roots: SandboxRoots): string {
  return path.join(roots.draftWorkspace, "media");
}

/** The directory the built module is served from. */
export function sandboxModuleRoot(workspace: string): string {
  return path.join(workspace, "module");
}

/**
 * A file inside a root, or null when the relative path would escape it.
 *
 * Belt and braces over `previewMediaPath`: that rejects a path by shape, this one checks
 * the result after joining, so a shape nobody anticipated still cannot reach outside.
 * Symlinks are the caller's problem — it has the real paths and this does not touch disk.
 */
export function withinRoot(root: string, relative: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  const rel = path.relative(resolvedRoot, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

/** What the web client is told about a build it asked for. */
export interface SandboxBuildReport {
  ok: boolean;
  /** True when this request joined a build already running. */
  joined: boolean;
  /** True when nothing was built because the module was already current. */
  skipped: boolean;
  /** One line an author can act on. */
  message: string;
  /** The build's own output, kept whole. */
  log: string;
}

/** What the web client is told about a preview. */
export interface SandboxStatus {
  state: PreviewState;
  /** Whether the activity can be played at all right now. */
  playable: boolean;
  /** Whether asking for it would trigger a build. */
  buildable: boolean;
  /** One line an author can act on. */
  message: string;
  /** The last build's output, when there is one to show. */
  buildLog: string | null;
}

const MESSAGES: Record<PreviewState, string> = {
  pending_spec: "Save a specification first — there are no scenes to play yet.",
  pending_scaffold: "No module has been built for this activity yet.",
  missing_shared_module:
    "This activity shares its module with another ref, which owns the module code. Build it from that ref.",
  stale: "The module is older than the activity; it will rebuild when you play it.",
  ready: "Ready.",
};

/**
 * The reply, assembled in one place.
 *
 * A failed build is reported as a failed build even when a preview from an earlier build
 * is still sitting on disk. Reporting `ready` because stale output happens to exist is the
 * quiet-success failure this port is not allowed to produce.
 */
export function sandboxStatus(state: PreviewState, buildLog: string | null): SandboxStatus {
  return {
    state,
    playable: previewPlayable(state),
    buildable: previewNeedsBuild(state),
    message: MESSAGES[state],
    buildLog,
  };
}
