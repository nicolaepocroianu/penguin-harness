# Loom's WAF authoring skills, as a plugin

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `plugins`

Loom's generation stages lean on about 250 KB of markdown contracts — the activity-state
protocol, the XState-backed state machine, assessment JSON, audio, video and asset
patterns, stable element ids, style guardrails and the book module contract — which it
vendors into each generated module's `.skills/` directory.

Penguin already has that concept, so these ship as the `waf-authoring` plugin rather than
as anything new. Their frontmatter was already exactly `name` and `description`, which is
the library skill contract here, so this is close to a copy.

## Twelve of Loom's fifteen

Three are deliberately left behind:

- `waf-sequence-from-prose` and `waf-sequence-implementation-patterns`, which Loom itself
  marks legacy — they implement `src/sequence.js`, replaced by the state-machine path.
- `waf-playwright-test-writing`, whose only reader was `test_activity`, which is out of
  scope for the port.

## Not preinstalled

A fresh Agent does not get these. The stages that need them read their files directly, and
nobody else should carry 250 KB of WAF contracts in a system prompt.

## Details

- `xstate-v5` keeps its five `references/*.md` files, which its own prose points at; the
  loader carries them as the skill's auxiliary files, and that is the same mechanism the
  server already uses to stage a helper script into a run workspace.
- The plugin is declared in `packages/core/package.json`, which is the dependency list the
  plugin loader actually reads — it resolves against the nearest package above itself, not
  the CLI's.
