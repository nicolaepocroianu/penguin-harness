# WAF-Loom port: three workspace prototypes

Throwaway, unimported UI exploration beside the Activities feature. No production route,
API calls, persisted data, dependencies, or changes to WAF-Loom. The scene artwork is
an inline vector fixture. The prototype shell approximates Penguin's chrome; it does
not mount its authenticated application shell.

Run from the repository root:

```sh
node packages/web/src/features/activities/prototype/serve.mjs
```

Open <http://127.0.0.1:7416/?variant=A>. Set `PROTOTYPE_PORT` for another port.
The server binds only to loopback, serves three allowlisted files, and refuses to
start with `NODE_ENV=production`.

- **A — Conversation desk:** persistent conversation beside scene and asset editors.
- **B — Storyboard studio:** the scene sequence leads; conversation follows selection.
- **C — Review room:** scene navigation, current/proposed comparison, conversation below.

Use the bottom switcher or left/right keys outside form controls. Switching layouts
keeps edits; reloading resets them. The State disclosure exposes relevant demo state.

Try the same flow in each layout: select Scene 4, attach Rock P in Inspect mode,
send a message, review the sample proposal, accept just the script, upload an MP3,
refresh Spanish, and play the scene. Try saving a different script while the proposal
is pending: applying stays disabled until you compare against the newer revision.

Audio auditions use browser speech, not a Loom voice. Uploaded MP3s can be played
locally. Trim records a selection without processing the file. Agent responses,
generation, translations, runtime behavior and assembly are deterministic simulations.
The optional downloaded JSON is a prototype snapshot, not a WAF module.

Source references reviewed in the WAF-Loom repository:

- `frontend/src/app/features/scene-asset-panel/components/scene-audio-asset-editor/`
- `frontend/src/app/features/scene-asset-panel/components/scene-image-asset-editor/`
- `frontend/src/app/features/tab-group-controller/tab-layout-builtins.ts`

Question: which layout best preserves Loom's editing depth while making conversations
and proposals easy to follow? No winning design is assumed. Keep this on the
`codex/waf-loom-prototypes` branch; rebuild an accepted direction with the application's
components and APIs before shipping.
