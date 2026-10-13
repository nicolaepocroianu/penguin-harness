# An activity bench scores a change to activity authoring

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `tooling`, `skills`, `server`
- **PR:** [#129](https://github.com/nicolaepocroianu/penguin-harness/pull/129)

`pnpm bench [head] [base]` answered whether a commit authors activities better than the one it
came from, with a Verdict: better, inconclusive, worse, or invalid with the reason. Both commits
took every case of a frozen case set through the Stages, each trial on a Penguin server started
from that commit on a fresh home copied from the bench's seed, base and head interleaved in
blocks. After each block, with every graded process stopped and every graded Trace scanned for
the case set's canary and the vault's path, the evaluator unsealed the block's hidden checks into
memory and ran them in its own browser with the harness from its own checkout; it re-ran each
trial's own tests the same way first, for the self-grading gap. The verdict was noise-aware:
paired bootstrap intervals over cases and trials, better only when the dev cases rose past
max(2 points, 2 × paired standard error), the held-out cases and the Claude Code check did not
fall, and neither guardrail (self-grading gap, cost per trial) got worse. Before spending, the
bench refused a checkout with uncommitted changes, a head that changed anything but the
`waf-authoring` plugin's skills, readme and icon (its `package.json` and `plugin.json` only in
their version), a seed that was not ready, a busy bench home, and an estimate over the
cap ($150 by default) or one the person did not confirm. Base was recorded once per recipe
fingerprint and head only when better, in agent-tuning's scoreboard format unchanged, so the
Evaluation Center showed them. Cases were kept sealed (AES-256-GCM, the key from a passphrase
typed at the terminal); `pnpm bench seal` proved a folder of cases (every hidden check fails on
an empty page and passes on the case's gold module) and sealed it. Only PLACEHOLDER cases were
shipped; the real ones come from Waterford's curriculum and QA reviewer.

## Details

- The bench lived in `scripts/activity-bench/`, run with tsx; its tests in
  `packages/server/test/activity-bench-*.ts`, typechecked by `scripts/activity-bench/tsconfig.json`
  (added to `pnpm typecheck`), since the server's tsconfig stops at its own folder.
- Its seams had two adapters each: AuthoringHost (IsolatedServer, ScriptedHost) and CaseVault
  (SealedVault, PlainVault). The tests used the ScriptedHost and the placeholder cases; one test
  ran the check runner against a fixture module in a real Chromium when it was installed.
- Every check ran in a child Node process under Node's permission model, reading only its entry
  file and playwright-core, with no writes, processes, workers or addons, connected to a browser
  the evaluator started. What hidden checks printed was never kept: when they could not run, the
  reason said only how they stopped. The scorer's fingerprint included the playwright-core
  version and the Chromium build.
- Claude Code trials ran with `CLAUDE_CONFIG_DIR` set to the bench home's own folder, so they never
  read the person's `~/.claude`; without a login there, the bench skipped that check and said why.
- The admin outcome route took the run kinds it accepts from `RECORDED_RUN_KINDS`, the kinds a
  start makes and those the server records itself (`DETERMINISTIC_RUN_KINDS`, beside the
  run-kind union), instead of a list of its own.
- `.agents/skills/activity-bench/SKILL.md` told a person or an agent how to set up a bench home,
  run a comparison, read a Verdict and seal cases, and what never to do with it.
