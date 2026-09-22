# A tree the agent may read but never write

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `core`, `server`

Assembling a WAF module starts an agent in a workspace and hands it a shared checkout to
read: the framework it compiles against, the navbar it bundles, the media it resolves
references in. That checkout belongs to whoever cloned it and must come back unchanged.
Until now the only thing saying so was a sentence in the agent's instructions, plus a
person approving each action.

An instruction is not a permission system, and the people approving these sessions are
not all engineers. On the fiftieth prompt, someone approves without reading.

## What changed

`ToolExecutionContext` gained `protectedRoots`: trees the file tools may read but must
never write. `write_file` and `edit_file` now refuse a write that lands in one, naming the
tree and saying where to write instead. Absent roots mean the previous behaviour exactly —
the only limit is the user's own file permissions.

The activities feature declares the resolved WAF checkout when it creates an assembly
session, so the refusal is specific to the run that needs it rather than a global policy.

## Why a guard rather than a workspace jail

Confining the agent to its workspace was not open to us: it has to read the checkout, and
`waf-context.json` points straight at it. Naming the trees that are off limits keeps reads
working and makes writes impossible.

Both tools resolved `path.resolve(ctx.workspaceDir, filePath)` with no containment at all,
so an absolute path escaped the workspace entirely. That is the hole this closes.

## What it does not cover

Commands the agent spawns. Those go through the sandbox layer, which wraps argv before
exec and never sees an in-process tool call. That layer already has the right shape — the
Windows backend maps `workspace-write` onto "whole volume readable, workspace writable" —
but `SandboxService` defaults to `danger-full-access` and the setting is global rather than
per-session, so switching it on would confine every session in the harness. That is a
policy decision, not an activities change, and it is recorded rather than quietly assumed
to be handled.

A resumed session does not carry its protected roots: the spec is rebuilt from disk and
this is not persisted. Activity runs never resume — a restart marks them interrupted and a
retry is a new run — so it does not affect this use, and the option documents it.

## Details

- `packages/core/src/environment/tools/path-guard.ts` holds the check as pure functions,
  covered by `packages/core/test/path-guard.test.ts`.
- The check is lexical first, then resolves symlinks on both sides, because a link or a
  Windows junction planted inside the workspace would otherwise tunnel straight out. It
  judges paths that do not exist yet, which is the normal case for a write, by resolving
  the nearest ancestor that does.
- A sibling directory whose name merely begins with a protected root's name is not inside
  it, and is not refused.
