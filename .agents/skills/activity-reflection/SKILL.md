---
name: activity-reflection
description: Use when improving how activities are authored from what their runs show — one reflection cycle: read the outcome ledger, the bench scoreboard and score-linked Traces, state one hypothesis, make one bounded change to a waf-authoring skill body or a stage prompt's text, score it with `pnpm bench`, and propose it for review only on a "better" verdict.
---

# One reflection cycle

A reflection cycle is one round of improving the recipe: find a recurring failure in outcomes,
change one thing, score it on the activity bench, and propose it for review only if it scores
better (GLOSSARY.md). One cycle, one hypothesis, one change. Nothing is adopted automatically: a
person reviews and merges every change (decision 3), and you never merge.

Read `.agents/skills/activity-bench/SKILL.md` first: the bench is how a cycle is scored, and it
costs money.

## 1. Read what the runs show

You may read:

- **The outcome ledger**, through the admin route of the Penguin server the person names. Ask
  them to run the queries with their own admin session and save the JSON where you can read it;
  never ask for a password, a cookie or a token.
  - `GET /api/admin/activity-outcomes/tally?kind=<run kind>&by=<recipe|runtime|prompt|library|harness|penguin>`
    with optional `projectId`, `activityId` (repeatable), `since`, `until`: runs counted per
    recipe or part of one. Metrics include how runs ended (`succeeded`, `failed`, …), `seconds`,
    `tests.passed` / `tests.failed` / `tests.notRun` / `tests.untrusted`, `judged.*`,
    `superseded`, `replaced`, `reverted`, `edits.author` / `edits.stages` / `edits.run`,
    `accepted.*`, `deployed.qa` / `deployed.prod`.
  - `GET /api/admin/activity-outcomes/history?projectId=…&activityId=…[&runId=…]`: one
    activity's runs with their recipes and facts, oldest first.
- **The bench scoreboard**: `<bench home>/<project>/benchmarks/activity-bench-r<N>/scoreboard.yaml`
  — each recorded recipe's score per dev case, with its Session ids.
- **Score-linked Traces**: the dev trials of a bench evaluation, under `<bench home>/trials/`: each
  trial's `server.log` and its home's run folders and Traces. Held-out trials are deleted once
  scored; never look for them.
- **Public case statements**: the Benchmark's `CASE-*/statement/README.md`.

Never read the private case store, a sealed vault or its passphrase, a hidden check, or a
held-out script. The ledger keeps the sizes of authors' edits, never their text; read authors'
edits or assist messages only where the project has a visible setting that allows it, off by
default (decision 7). No such setting exists yet, so do not read them.

## 2. One hypothesis

Cluster what failed: one stage, one recurring pattern (the module runs whose tests fail on media
that never plays, say), seen in the tallies and confirmed in Traces. Then write down, before
changing anything, one falsifiable hypothesis: what you will change, which runs it should help,
and which dev cases' scores should rise. If you cannot name the cases, you do not have a
hypothesis yet.

## 3. One bounded change, in the write set

On a new branch from `origin/main` (`fix/waf-authoring-<topic>`), change exactly one of:

- **the body of one existing skill** under `plugins/waf-authoring/skills/<skill>/` — never its
  frontmatter: a skill's name and description sit in the agent's system prefix;
- **the text of one stage prompt** in `packages/server/src/activities/prompts/<stage>.ts` — only
  what is inside its string and template literals.

Keep it small: a few sentences, one section, one concern. Never add or delete a skill or a file,
and never touch `ACTIVITY_AGENT_MD` (`packages/core/src/state/builtin-agents.ts`) or any
AGENTS.md, the harness, a collector, a check, a test, the bench or the golden (decision 15). The
check below refuses all of that; the bench itself refuses anything outside its recipe surface as
`out_of_surface`.

Commit the change alone: this is **commit 1**, the one the bench scores. For a skill-body change,
raise the dated `version` in that skill's `SKILL.md` frontmatter in the same commit (it is in the
bench's surface, and CI's `scripts/check-plugin-versions.mjs` requires it). Then check it:

```bash
node scripts/activity-reflection/check-change.mjs origin/main HEAD
```

It refuses a file outside the write set, a frontmatter changed beyond its version, a manifest changed beyond its
version, and any added character a reviewer cannot see: every format, control, private-use and
line- or paragraph-separator character (soft hyphen, zero-width and joiner characters, direction
marks, embeddings, overrides and isolates, the tag block that can spell a hidden prompt), and the
invisible marks and fillers beyond them (variation selectors, the combining grapheme joiner,
Hangul fillers). It prints the change as a word diff with every such character shown as
`<U+XXXX>`, in the changed lines and the lines around them. Read that diff, not the plain one:
text can read one way to a person and another to a model.

## 4. Score it

Ask the person before running the bench: a full comparison costs real money (up to the $150
cap) and they type the vault's passphrase. Then, with commit 1 as `HEAD`:

```bash
pnpm bench HEAD origin/main
```

- **better**: note commit 1's sha and the evaluation id the Verdict gives, and go on.
- **inconclusive, worse or invalid**: drop the branch. Keep what you tried and the numbers in
  the conversation. Do not try variations of the same change to chase a better number; a new
  hypothesis is a new cycle.

## 5. Propose it, for a person to decide

Only on **better**, add **commit 2**, which changes no behaviour:

- add `changelog/unreleased/<date>-waf-authoring-<topic>.md` (Type `fix`);
- for a prompt change, refresh the run-kinds golden with `UPDATE_RUN_KIND_GOLDEN=1` on
  `packages/server/test/activity-run-kinds-golden.test.ts`, and check its diff is exactly your
  text change.

Both are outside the bench's surface, so the PR's head is `out_of_surface` by construction: the
scored recipe is commit 1. Open the PR on the fork (`gh pr create --repo
nicolaepocroianu/penguin-harness`). Its description carries:

- the hypothesis and the change;
- **the scored commit (commit 1's sha) and the evaluation id**; re-scoring it is
  `pnpm bench <commit 1> origin/main`, never the PR head;
- the check script's output;
- the Verdict: dev delta and its 90% interval, held-out, both guardrails, the Claude Code check
  and the cost.

Then stop: the person reviews and merges, or not.
