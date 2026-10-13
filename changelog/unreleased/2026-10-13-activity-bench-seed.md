# The bench's seed home is prepared by one command

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `tooling`, `skills`
- **PR:** [#133](https://github.com/nicolaepocroianu/penguin-harness/pull/133)

`pnpm bench seed [--project-name Bench] [--model <provider/modelId>] [--home <bench home>]`
prepared the [activity bench](2026-10-13-activity-bench.md)'s seed home, the Penguin home every
trial starts from, step by step, skipping each step already done. It started a throwaway server
on the seed (a desktop token its only credential, a random loopback port), created the Project
as the built-in admin with the Activity Agent in it, listed the models the Project offers and set
the one named or picked as its default with an API key typed hidden at the terminal — sent to
that loopback server's model table and nowhere else — had Penguin prepare its own WAF workspace
in the seed and said plainly when git could not reach a repository, installed the test browser,
wrote `bench.json` keeping its `vault`, stopped the server, and ran the bench's own preflight,
printing ready or what was missing. Without a terminal, or in a home the bench may not use, it
stopped before starting anything.

## Details

- The server boot the bench's trials use moved to `scripts/activity-bench/server-boot.ts`, and
  the seed checks the preflight runs (the agent, the workspace, Claude Code) to functions the
  seed command runs too, so there is one of each.
- The terminal prompts (a passphrase or a key typed hidden, a line, a yes) moved to
  `scripts/activity-bench/prompt.ts`; a test stands in a scripted prompter.
- `packages/server/test/activity-bench-seed.test.ts` took the command through every step
  against a server in the test process with git, npm and the browser installer stood in, with a
  fake key: it reached the Project's model table only; a second run asked nothing and redid
  nothing; an empty key, a checkout from elsewhere and a repository git could not clone were
  refused; the real command stopped at exit 64 without a terminal and in a home it may not use.
- `.agents/skills/activity-bench/SKILL.md` pointed "A bench home" at the command.
