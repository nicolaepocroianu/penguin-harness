---
name: waf-harness-dev
description: Use when developing WAF Harness itself — changing packages/{core,server,web,cli,desktop,docs,skills}, the built-in model catalog, the installers or the release workflow; writing or auditing changelog entries; capturing release screenshots; running the test suite here or, when asked, on another machine; reading a prompt-cache regression out of the core suites; deciding what to do about data already on disk; auditing prose that reads like a leaked authoring session; or changing anything a user sees or reads — a component, a style, UI strings, docs — which must not read as AI slop. Covers this fork's relationship to upstream (none: nothing is contributed), the two-repo symlink layout, the CI-parity verification chain, the record-and-ship contract, and the seams that are intentional.
---

# Developing WAF Harness

WAF Harness is a TypeScript monorepo: an Agent SDK (`packages/core`), an HTTP server
(`packages/server`), a Web App (`packages/web`), a CLI (`packages/cli`), an Electron shell
(`packages/desktop`), the docs site, and the shipped plugin library — one npm package
per plugin under the repo root's `plugins/`, with `packages/plugins` as the loader that depends on
them all. It **consumes** LLM providers through `@prismshadow/mmsp` (MMSP, formerly
`@prismshadow/agenthub`) and implements no provider clients of its own.

This page is the part that applies to every change. The reference files carry the detail, read
them when the task reaches them:

| Read | When |
| --- | --- |
| `reference/verification.md` | A test fails oddly, CI reads green when it should not, or the user asks you to run the suite on another machine |
| `reference/changelog.md` | Writing or auditing a changelog entry |
| `reference/model-catalog.md` | Touching the server's model catalog, pricing, provider groups, which environment variable a keyless row reads, or glyphs |
| `reference/authoring.md` | Auditing prose, or proposing a simplification |
| `reference/release.md` | Preparing a release: the branch order, what changes, the announcement and its screenshots |
| `reference/testing.md` | **Writing or changing any test**: scenarios first, behaviour only, one fake per boundary, branch coverage, speed, CI time as a cost |
| `reference/ai-slop.md` | **Every** change a user sees or reads: UI, styles, UI strings, docs, changelog — the rules, the scanner, the catalogue of tells |

## No AI slop — every time something is rendered or written

Whatever you add to the UI or the copy, check it before you call it done: **decide before you
decorate; one accent, one voice; hierarchy from scale and space; subtract first; specific beats
punchy; decoration must mean something.** No gradients, glows, emoji, pill spam, cards in cards,
coloured keywords or "it's not just X — it's Y". Reuse the theme tokens and `lib/tone.ts`; status
is a labelled pill or an icon plus a tooltip, never a bare coloured dot; sections are ruled, not
boxed. Run `node .agents/skills/waf-harness-dev/reference/ai-slop/scan.mjs <what you touched>`
and triage every hit. `reference/ai-slop.md` has the repo's own decisions and the full catalogue.

## This repository is Waterford's fork

`nicolaepocroianu/waf-harness` is Waterford's own WAF Harness. It was forked from
`Prism-Shadow/penguin-harness`, and that is the whole relationship: nothing here is contributed
upstream. Activity authoring (the studio, the Stages, WAF modules, the Loom port), the activity
bench and every fix made here live only in this repository.

- Never open a PR, issue or comment on Prism-Shadow, and never sort or prepare work for it —
  even a fix upstream could use stays here.
- Name the fork on every PR: `gh pr create --repo nicolaepocroianu/waf-harness --base main`.
  A bare `gh pr create` can pick the parent repository and publish a PR in another organisation.
- Publishing (the site, Docker images, npm packages, GitHub Releases) runs only in
  `Prism-Shadow/penguin-harness`; the workflows skip it on this fork, and desktop installers build
  unsigned here. Do not "fix" that by adding secrets or removing the guards.
- CI runs on every PR and push here, on ubuntu, macOS and Windows. Merge only when all three are
  green: a change checked on one platform has missed real bugs on the other two.
- Keep CI load low — a burst of full runs once got Actions disabled on the fork. Open a PR as a
  draft while you iterate (drafts run the ubuntu jobs only), push fixes in batches rather than one
  commit at a time, and mark it ready when you want the full macOS/Windows matrix. Pushes to
  `main` run ubuntu only, and docs-, changelog- or skill-only changes run no CI.

## Repo shape — read before your first edit

Two repositories sit side by side: the implementation repo (`waf-harness`) and the design repo
(`waf-harness-design`). Three paths inside the implementation repo are symlinks into the design
repo and are gitignored here:

- `design/` → the design repo, so specs are reachable as `design/specs/…`
- `AGENTS.md` → `design/AGENTS.md`
- `CLAUDE.md` → `AGENTS.md`

Editing `AGENTS.md`, `CLAUDE.md` or anything under `specs/` edits **the design repo's files**.
Commit them there, on their own branch, in their own PR. They can never appear in an
implementation-repo PR. A fresh clone has none of the three links; recreate them by hand. A clone
with no design repo beside it — the normal state for a remote or throwaway environment — has
nothing to link to, so it carries no `AGENTS.md` at all and these skills are its whole contract.

Both repos take changes through branch + PR against `main`, squash-merged. Do not push to `main`,
and `gh pr create --repo nicolaepocroianu/waf-harness --base main` — not `dev`, whatever a
sibling repo does.

Branches are `feat/<topic>`, `fix/<topic>`, `docs/<topic>` in both repos. Some older branches here
read `docs-<topic>` instead: a remote branch literally named `docs` once held that ref namespace and
made the slashed form unpushable. It is gone — if a push is ever rejected as a directory/file
conflict again, `git ls-remote --heads origin` names the branch responsible.

Independent changes each get their own git worktree under `../waf-harness-wt/<topic>/` so
several can run in parallel.

**Keep searches inside the worktree you are working in.** Scanning the home directory or the whole
disk is rarely worth it: it is slow, and what it turns up outside the tree is usually another
checkout's copy of the file you are already looking at. When a path does not resolve, prefer
narrowing — reason about the package layout, ask `git ls-files`, follow the conventions above — over
widening the root. The only paths outside the worktree worth reading are the siblings named here:
`../waf-harness-design` for specs, `../waf-harness-wt/*` for another topic's tree, and
`../agenthub` for MMSP where it is checked out (the checkout keeps the library's former name).
Reach them by name; never find them by scanning. Say all of this to every subagent you dispatch —
widening the search root is the first move a subagent makes when a path does not resolve.

## Tests prove behaviour, not the source

Before a test, write its scenarios (Given / When / Then) in the file header; one `it` per
scenario, named as the behaviour. Assert only what the caller can observe — and look first for
what must *not* happen (a retry that must not duplicate, a refusal that must not write). Never
test a constant, a copied table, a UI string against its dictionary, or which private helper
ran. Fake only at the system's edge with the package's shared helpers (one fetch fake, one mock
LLM, `createTestApp`, real temp dirs, fake timers); do not `vi.mock` the package's own modules.
Every branch a change adds is taken by a scenario; pruning never lowers branch coverage. No real
sleeps, no per-test servers. CI time is a cost paid three times (Linux, macOS, Windows): keep each
test well under a second, and check your PR's job durations after CI. `reference/testing.md` has
the rules and the checklist.

## Verify what you changed

Node must be >= 24. In each worktree, `pnpm install --frozen-lockfile` first.

The full chain CI runs is `pnpm build`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`,
`sh scripts/test-installer.sh`, and the web's `activities` Playwright project. CI installs
Playwright's Chromium for the server shards and sets `WAFH_TEST_REQUIRE_BROWSER=1`, so the
server's real-browser suites fail there instead of skipping. **Do not reach for `pnpm test` by reflex** — it is nine packages and
~2500 tests, minutes per run, and for a docs-only diff it proves nothing the narrow run does not.
Pick the narrowest evidence that would actually fail for this change's regression:

```sh
pnpm --filter @waterford/waf-harness-server exec vitest run test/model-catalog.test.ts # one file, ~2s
pnpm --filter @waterford/waf-harness-web test                                          # one package
```

| Changed | Run |
| --- | --- |
| Markdown only — changelog, `.github/CONTRIBUTING.md`, `.agents/`, README | `pnpm format:check` |
| `packages/docs/content/**` | `format:check` + the `docs` package tests (search index) |
| `plugins/**` (repo root) | the `plugins` package test (loader, README tables, the hook scripts against fake Traces) + `docs`'s `skills-sync.test.ts` |
| The model catalog | server `model-catalog.test.ts` and `models.test.ts`, web `model-grouping.test.ts` and `protocol-path.test.ts` |
| The credential rule or a row's effective connection | core `model-connection.test.ts`, server `models.test.ts` and `models-balance.test.ts` |
| Request assembly, history rebuild, compaction, the system prompt, a tool's description or schema | core's three `prompt-cache-*` suites — read the section below before you touch what they report |
| One package's source | that package's `test`, plus `typecheck` |
| Server `src/activities/{browser-guard,confined-checks,test-browser,quality-accessibility}.ts`, `scripts/activity-bench/` | server `activity-confined-checks`, `activity-bench-harness`, `activity-quality-probe` with Chromium installed (`pnpm --filter @waterford/waf-harness-server exec playwright-core install chromium`): without it they skip |
| Web flows, selectors, or strings the e2e specs read | the web `activities` Playwright project — see the frontend skill's Verify |
| Exported core types, or anything downstream imports | `pnpm build` + `pnpm typecheck` before any test |
| Anything that opens, folds, resizes or animates in the Web App or `packages/ui` | the `ui` and `web` tests + frames captured mid-transition in all three themes (`waf-harness-frontend`, "Motion"); a resting screenshot is not evidence |
| A remote test tree after `main` moved (a merge, a rebase) | rebuild `@waterford/waf-harness-server...` there first: a stale core `dist` reads as dozens of TS2305 "no exported member" errors in web and the gallery |
| `package.json`, the lockfile, `pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` + `pnpm build` |
| Installers, `release.yml` | `sh scripts/test-installer.sh` |

Always cheap, always worth it: `git diff --check`, and `pnpm format` + `format:check` on any diff at
all.

Run the whole chain in exactly three cases: the change spans the repo widely enough that nothing
narrower is credible, you are diagnosing a CI failure, or you are asked to. There are no coverage
thresholds in this repo, so nothing forces a wider run than the behavior needs.

**Tests run on this machine unless the user asks otherwise.** Moving a suite to another host is
something they request in so many words, not an optimisation to take on your own — see
`reference/verification.md` for how, and for why a difference between two machines is a finding
rather than something to paper over.

Once the evidence you chose passes, commit and push to the current branch without asking.
Force-pushes and reverting someone else's commits still need confirmation.

When a test fails in a way that does not match your diff, when CI reads green too easily, or when a
fake or an assertion looks like it proves nothing, read `reference/verification.md` before spending
a second round on it.

## A prompt-cache miss is a cost regression, and it has to be said out loud

A provider serves a cached prefix only while the next request repeats the previous one byte for byte
from the front: the model id, the tools, the fast-mode parameters, the system prompt, the remaining
prompt-affecting parameters, then the messages. Everything from the earliest divergence onward is
re-read at full price, on every request of every running conversation — not only the one in front of
you. A word added to a tool description costs far more than its own tokens.

Three suites in `packages/core/test` hold that line, and a failure means something different in each:

| Failing | What it is telling you |
| --- | --- |
| `prompt-cache-invariants.test.ts` | Your change made a request stop extending its predecessor. This is the regression itself; the diagnostic names the tier that diverged and estimates the input that falls after it. |
| `prompt-cache-lifecycle.test.ts` | The same thing counted in provider tokens. A number that went down is money. |
| `prompt-cache-simulator.test.ts` | You changed the rule engine, not the harness. Only correct when the provider's documented rules changed — go and check the documentation, not the test. |

**Never re-baseline these to green.** Editing an expected number, or adding a case to the list of
misses that are there by design, is a decision about spending the user's money — not a fix. Put the
tier that moved and what it costs in front of them and let them decide.

And say it in the reply, not only in a test log. A cache regression shows up in no other signal this
repo produces: nothing is slower, nothing is wrong on screen, and CI goes green the moment the
numbers are edited. If you do not raise it, it ships.

## Record and ship

Every change ships an English changelog entry in `changelog/unreleased/`:
a `YYYY-MM-DD-<slug>.md` file inside the PR that makes the change.
**There is no index file**, and
reasoning belongs in the PR description rather than on disk.

**A conclusion is not a deliverable.** Do not package findings as a standalone page, artifact or
report file: it detaches them from the diff they are about and no one opens it twice. A review's
findings go in PR comments, on the lines they concern; everything else goes in the PR description
and in the reply to whoever asked. An architecture review's report is a working aid, not a
deliverable — see below.

`changelog/README.md` is the full spec and `reference/changelog.md` has the shape plus the traps
(the metadata block's fixed order, translated headings, `#N` numbers that are often issues rather
than PRs, and the `PR:` field everyone forgets). Read one of them before writing an entry rather
than pattern-matching a neighbouring one.

## Architecture reviews

`improve-codebase-architecture` finds deepening candidates, `grilling` stress-tests one, and
`codebase-design` and `domain-modeling` supply the language. Their rules here:

- The review's HTML report is a temporary working aid: it goes to the OS temp directory and is never
  committed. Each change that comes out of a review lands as its own PR, and that PR's description
  carries the reasoning.
- Name architecture with the `codebase-design` vocabulary — module, interface, depth, seam, adapter,
  leverage, locality — and the domain with the glossary's terms.
- Before proposing a candidate, check it against what this repo already fixes: the server kernel
  contract (an `Interface` class plus a `@Component`, registered in its parent's `children` in
  `packages/server/src/platform.ts`, `gen:ifaces` passing, swappable dependencies as ports with a
  default component), the compatibility rule above (stored data stays readable as it is, or the user
  decides), prompt-cache byte-identity, and `waf-harness-frontend` for anything in the Web App.
  A candidate that breaks one of them says so up front.
- The glossary is the root `GLOSSARY.md`: terms and definitions only, no file names, classes or
  tables.
- Decisions live in `docs/adr/`, created with the first one. An ADR is the one deliberate exception to
  "reasoning belongs in the PR description", and only for a decision that is hard to reverse,
  surprising without context, and the result of a real trade-off.

## Backward compatibility is the user's call, not yours

When a change touches data or configuration already on disk — Traces, `system_config.yaml`,
`.project_config.toml`, installed skills, `web.db`, localStorage keys — do not pick a strategy.
State plainly what breaks if nothing is done, offer the options (permanent dual-format tolerance /
one-time migration / a documented reset path / accept the break and say so), and let the user decide.

Whatever is decided, compatibility code is a standing cost: name **how long it stays, who removes
it, and what has to be true first**, at the code site and in a dedicated
`changelog/unreleased/YYYY-MM-DD-backward-compatibility.md`. Other entries in that batch reference
that file instead of re-telling it. A batch with no compatibility handling has no such file.

## Core never special-cases a model, provider or gateway

`packages/core/src` contains no model ids, provider ids, vendor hostnames or endpoints, and no
catalog data. Model knowledge lives in the server's catalog (`packages/server/src/model-catalog/`,
published as the browser-safe `@waterford/waf-harness-server/model-catalog`, which the Web App, the
CLI and the gallery import) and reaches core only through the Project config the server seeds —
`[providers.<id>]`, `[[models]]`, `default_model` — or through host hooks
(`AgentAssembly`). Nor does any package keep environment or refusal logic: which variable a
keyless model reads, and which base URL is refused without a key, is MMSP's rule. Core passes the
file's key, base URL and client type to MMSP verbatim, and every preview asks MMSP's
`@prismshadow/mmsp/credentials` (the catalog's `env-keys.ts`). The one exception
is App attribution: `llm/app-attribution.ts` (`attributionHeaders`) names the gateways whose headers
`GenerativeModel` attaches. A change that wants core to know a model or a vendor belongs in the
catalog and the config it seeds instead; a core test that needs a Project writes a fixture
(`test/seeded-project.ts`), never the catalog.

## One concern per module

Logic with its own reason to change — an identification scheme (App attribution), a migration, a
derivation rule (which variable a keyless row reads), a protocol mirror (MMSP's routing table) —
gets a file of its own beside its caller, never a section appended to a large neighbour. A change that moves or
reshapes a large file splits it along its concerns, keeping the import graph acyclic: a module
cycle that reads a binding at load time fails with a TDZ `ReferenceError`. The case that set the
rule: [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167) first put App attribution
at the top of `generative-model.ts`.

## The message protocol is closed by default

- **OmniMessage is closed by default.** No new field, type or enum value unless the fact is
  unrepresentable by existing records and underivable by readers; prefer recording earlier or
  streaming an existing record over a new field. Say so in the PR. The architecture spec's
  message-format section states the rule, and `packages/core/src/omnimessage/types.ts` repeats it
  at its head.
