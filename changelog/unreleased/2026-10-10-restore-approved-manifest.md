# A module agent's rewritten media manifest is restored, not refused

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`

When an activity has an approved media plan, the module stage now writes the approved
`asset_manifest.json` back over the module's copy before collecting the module, instead of
failing the run when the agent changed it. The manifest is the server's data, written by the
scaffold from the plan. The module prompt also no longer asks the agent to "complete" the asset
manifest: it says the manifest is already written and must not be rewritten. test28's decodable
book failed after 14 minutes, with 9 player checks passing, because its agent rewrote the
manifest from `input.json`'s draft shape.
