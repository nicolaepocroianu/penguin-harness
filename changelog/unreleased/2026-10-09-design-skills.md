# Two shared design skills for agents working on the Web App

- **Date:** 2026-10-09
- **Type:** process
- **Scope:** `repo`

Agents working in this repository now share two third-party design skills under `.agents/skills/`,
pinned in `skills-lock.json`: `impeccable` (pbakaus/impeccable) for critique, audit, polish,
layout, copy and hardening passes on an interface, and `web-design-guidelines`
(vercel-labs/agent-skills) for a review of UI code against the Web Interface Guidelines.
`penguin-harness-frontend` still decides tones, icons, control sizes, strings and disclosure;
these skills are for refining work inside those rules, not replacing them. Both are kept as
published and are excluded from Prettier.
