# Coding agents screen: installed/available cards with live probes and per-agent models

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`
- **PR:** [#35](https://github.com/nicolaepocroianu/penguin-harness/pull/35)

The coding-agents screen now reads like a launcher: an **Installed** section of cards for the agents found on the server machine (name, `--version` line, sign-in state, command, a Model dropdown), an **Available** section of dimmed cards for known agents that are not installed (with a link to get them), and a **Rescan** button that re-runs the live checks. Detected agents are usable immediately — starting a session for one persists its definition automatically; the Add-agent form remains for custom commands only.

## Details

- Discovery can now execute what it finds, opt-in per call: a `--version` run (first output line, 3 s limit) and an auth-status check (`claude auth status`, `codex login status`; exit-code classified) for each detected agent. The screen answers from a cached probe (5 minutes) and the Rescan button refreshes it; the plain read stays cheap.
- A refresh also opens one throwaway session per runnable candidate to enumerate its advertised ACP config options — the Model dropdown on each card is populated from what the agent itself reports, bounded by a probe timeout.
- The model picked on a card (or inside a session) is remembered per agent and auto-applied to that agent's future sessions; a non-admin sees the model but cannot change it.
- Starting a session for a detected-but-unsaved agent auto-persists the definition derived from the built-in recipe and the machine's own probe — no user-supplied fields — while the admin gate still guards arbitrary definitions.

## Compatibility

The discovery read now optionally executes the CLIs it finds (before: filesystem-only). The cheap read executes nothing; live probes run only for an admin's explicit rescan and are cached.
