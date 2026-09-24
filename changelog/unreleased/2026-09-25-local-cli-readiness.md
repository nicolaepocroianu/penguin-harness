# Local CLI cards: readiness, a model dropdown on every card, and more agents to install

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `coding-agents`, `server`, `web`

## Whether each agent is ready

Each installed CLI on **Models → Local CLI** now ends in a state dot and a word: **Ready**,
**Sign-in required**, **Needs setup**, **Won't start**, or **Sign-in unknown**. The heading
counts how many are ready. Opening a card that is not signed in shows how to sign it in
on the server machine. Opening one that won't start shows what the agent said when it
refused, for example Gemini CLI turning away individual Google accounts.

Discovery now reads each agent's stored sign-in on every call, without running the agent:
the env key it accepts, or its own credential file (Gemini's `oauth_creds.json`, Claude
Code's `.credentials.json`, Codex's `auth.json`, OpenCode's `auth.json`, Copilot's
signed-in users, Cline's provider settings). Where a login may sit somewhere the server
cannot read (a macOS keychain, the GitHub CLI), no file reads as unknown, not as signed
out. A Rescan still asks Claude Code and Codex themselves, and their answer wins. Claude
Code saying `"loggedIn": false` now counts as signed out, and a status check that times
out counts as unknown instead of signed out.

## A model dropdown on every card

The model an agent will use is now chosen from a dropdown in its card's row, without
opening the card (on narrow screens it opens with the card). Reasoning effort, the Test
button and the launch command stay inside the opened card.

The versions, models and failures a Rescan learns are now saved (the
`coding_agent_probes` setting). They used to vanish five minutes after a Rescan and on
every restart, which left cards without a dropdown. The first time an admin opens the
page, a Rescan runs by itself. Why a probe failed is shown to admins only, since it is
the agent's own text and may name paths on the server machine.

## More agents, and how to install them

Seven more agents that speak the Agent Client Protocol are recognised: Devin for
Terminal, Hermes, Kilo, Kimi CLI, Kiro CLI, Trae CLI and Mistral Vibe. None is launched
with a flag that skips approvals. **Available CLIs** lists each agent not found on the
server machine with its maker, a link to its install page, and, where one command installs
it on every OS, that command with a copy button. Installing still happens in a terminal on
the server machine; the page does not run it.
