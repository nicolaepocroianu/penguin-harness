---
name: activity-bench
description: Use when scoring a change to activity authoring (the waf-authoring plugin, later a stage prompt) on the activity bench — running `pnpm bench`, setting up a bench home, sealing cases, or reading a Verdict. Covers what the bench refuses and why, what it costs, and what never to do with it.
---

# The activity bench

`pnpm bench` answers one question: does a commit (head) author activities better than the one it
came from (base)? It takes every case of a frozen case set through the Stages on both commits,
scores each trial with hidden checks only the evaluator holds, and returns a Verdict. A change to
`plugins/waf-authoring` or to a stage prompt's text (`packages/server/src/activities/prompts/`)
that claims to help gets its numbers here, and they go in its PR.

Terms (GLOSSARY.md): an **Activity bench** is the case set; a **Case** is one frozen request; a
**Trial** is one case taken through its Stages once; a **Hidden check** is a check only the
evaluator runs.

## What it costs — ask first

Every trial runs real agents on real models: about 40–50 trials of 15–40 minutes for a full
comparison, capped at $150 (decision 11) until an A/A run has measured real cost. The bench prints
its estimate and asks before the first trial is paid for. **Never run it, or a smoke trial,
without the person's go-ahead.** `pnpm bench HEAD HEAD` is the A/A run: same recipe twice, which
measures the noise.

## Running it

```bash
pnpm bench                      # HEAD against its merge base with origin/main
pnpm bench <head> <base>        # two commits
pnpm bench --trials 3 --max-cost 150 --json --no-claude --yes
pnpm bench seal <private source> --bench <id>   # people only, see below
```

- It runs from a clean checkout and compares commits: commit first. It grades with this
  checkout's harness, never the candidate's.
- It asks for the sealed bench's passphrase at the terminal. The passphrase is never passed in
  the environment or on the command line.
- Exit codes: `0` better, `1` inconclusive or worse, `2` invalid, `64` usage.
- Running the same comparison again resumes it: trials already scored are kept. A finished one
  answers as it did.

## Reading the Verdict

- **better**: the dev cases' paired-bootstrap 90% interval is above 0 and the rise beats
  `minDetectable` (max(2 points, 2 × paired standard error)); held-out cases did not fall; Claude
  Code (the non-regression check, when its bench login is there) did not fall; no guardrail got
  worse. Only then is head recorded.
- **worse**: any of those intervals lies wholly below 0.
- **inconclusive**: anything else. More trials narrow the interval; they cost the same again.
- Guardrails: the **self-grading gap** (criteria a trial's own tests pass while the hidden checks
  fail) and **cost per trial**. A rise that comes with a wider gap is not taken.
- `selfReportMismatches` counts trials whose own report says what their tests, re-run by the
  evaluator, do not.

| invalid | meaning |
| --- | --- |
| `dirty_tree` | The checkout has uncommitted changes. Commit or remove them. |
| `out_of_surface` | Head changes something besides the plugin's skills, `README.md` and `icon.svg` — its `package.json` only in its `version` — and the stage prompts' own modules (`packages/server/src/activities/prompts/`) only inside their string and template literals; or it changes a symbolic link anywhere. Split the change. |
| `preflight` | A revision, the seed, the test browser or a recipe build is not ready; the reason says which. |
| `budget` | The estimate or the next block would pass the cap, or the estimate was not confirmed. |
| `infrastructure` | The machinery failed twice in a row. Fix it and run the same comparison again. |
| `bench_changed` | The cases or the grading checkout changed mid-evaluation. |
| `contaminated` | A graded Trace holds the canary or the vault's path. The evaluation is void for good: report it. |
| `busy` | Another evaluation holds the bench home. |

## A bench home

A folder of its own (`PENGUIN_BENCH_HOME`, else `~/.penguin-bench`) — never inside `~/.penguin`,
a running server's data root, or this repository; the bench refuses those.

```
<bench home>/
  bench.json        { "project": "<seed project id>", "vault": "vault/<id>.sealed",
                      "trialEstimateUsd": 3, "agent": "activity_agent", "mainRef": "origin/main" }
  seed/             a Penguin home a person prepares once
  claude-config/    CLAUDE_CONFIG_DIR for Claude Code trials
  vault/            sealed case files
  recipes/<sha>/    a worktree per compared commit, built once (remove with git worktree remove)
  trials/           one folder per trial: its home and its server's log
  evaluations/<id>/ progress, so a comparison resumes
  <project>/benchmarks/activity-bench-r<N>/   the scoreboard, agent-tuning's format
```

Preparing the seed (once, by the person — it asks for an API key):

```bash
pnpm bench seed                                 # Project "Bench", model picked at the prompt
pnpm bench seed --project-name Bench --model <provider/modelId> --home <bench home>
```

It starts a throwaway server on `<bench home>/seed` (a desktop token its only credential, a
random loopback port) and, skipping each step already done: creates the Project as the built-in
admin with the Activity Agent in it; lists the models the Project offers, takes the one named or
picked, and asks for its API key **at the terminal, typed hidden** — the key goes to that
loopback server's model table and nowhere else, never to a log, `bench.json`, argv or the
environment; has Penguin prepare its own WAF workspace in the seed (never an existing checkout:
every trial copies the seed, and a shared checkout would mix them — a `WAF_ROOT_DIR` or an
`externalRoot` is refused) and says plainly when git cannot reach a repository; installs the test
browser; writes `bench.json` (keeping its `vault`); stops the server; then runs the bench's own
preflight and prints ready or what is missing. It needs a terminal and exits 64 without one.
Run it again after fixing what it named. Never type a key for it on someone's behalf, and never
put one on its command line. Each trial copies the seed except its browser.

Claude Code trials run with `CLAUDE_CONFIG_DIR=<bench home>/claude-config` (decision 19), so they
never read the person's `~/.claude` — its CLAUDE.md, hooks, plugins or memory. The person signs
in there once (`CLAUDE_CONFIG_DIR=<bench home>/claude-config claude`, then `/login`), or gives the
seed's Claude Code definition an `ANTHROPIC_API_KEY`. Never copy a login or a key into it
yourself. With no login there, the bench says so and skips the Claude Code check.

## Cases and sealing

Real cases and hidden checks are written by Waterford's curriculum and QA reviewer and kept in a
private store, never in this repository (decision 9). `scripts/activity-bench/cases/placeholder/`
holds PLACEHOLDER cases only, to build and test the bench with; `--plain <folder>` runs only
placeholder cases and records nothing.

`pnpm bench seal <folder> --bench <id>` proves each case — every hidden check fails on an empty
page, and passes on the case's `gold/` module — then seals the folder (AES-256-GCM, key from the
passphrase) into `<bench home>/vault/<id>.sealed`. Folder layout: the comment at the top of
`scripts/activity-bench/vault.ts`. Every hidden file carries the case set's canary.

## Never

- Read, print or copy a sealed vault's contents, or ask for its passphrase.
- Put real cases or hidden checks in this repository, a Benchmark folder or a run's workspace.
- Edit the harness, the checks or this bench in a change you are scoring: that change is
  `out_of_surface`, and grading rests on them being the same on both sides.
- Point the bench at `~/.penguin`, a dev server's data root, or the person's `~/.claude`.

## Limits of v0

- On Windows a graded agent is not barred from reading files; the bench relies on the vault being
  sealed and on scanning every graded Trace for the canary (decision 10).
- On Windows, any process running as the same user can read the evaluator's memory — the vault's
  key, and a block's hidden checks once they are unsealed. The sealed vault keeps cases off the
  disk; it is not a read barrier against a process of the same user. Only another OS account or
  the repository's Docker image is (decision 10, before G).
- Checks run under Node's permission model: they cannot write, start a process or a worker, or
  read files beyond playwright-core. The model has no network scope, so a check's own Node
  process still reaches the network freely: it can fetch services on loopback — the person's
  Penguin dev server, say — and send what it gets anywhere. Only a dedicated OS account or a
  container closes that.
- The browser a check drives runs unconfined, as this user. Left open, it would let a trial's own
  tests read anything this user can — a Claude login, Penguin's vaults, the other side's trial
  home — by opening a `file://` URL, and send it to any host. Two locks prevent it
  (`scripts/activity-bench/browser-guard.ts`): the browser starts with no route anywhere but the
  played module's own port (a proxy that leads nowhere for everything else, other loopback ports
  included; host names that resolve to nothing; no WebRTC around the proxy), and a check reaches
  it only through a guard that passes calls on known kinds of object only, and refuses a
  navigation anywhere but the played module's origin, a context with its own proxy, files from or
  to this disk, raw DevTools, the browser's own HTTP client, tracing and artifacts. A test proves
  each escape fails with the locks.
- Still, run the bench under a dedicated OS account that holds no credentials of its own (no
  Claude or cloud login, no SSH keys, no Penguin vaults): that is the recommended way, and the
  only real read barrier on Windows.
- A skill a recipe deletes stays in the trial from the seed's own install of the plugin.
