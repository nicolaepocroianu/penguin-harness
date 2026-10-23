# @waterford/waf-harness-web

The WAF Harness Web App — a React 19 + Vite + Tailwind CSS 4 SPA that renders the OmniMessage stream (same protocol and statistics as the CLI) and manages Agents, Skills, Models, usage and Traces. Feature tour: [Web App Guide](https://penguin.ooo/docs/web-app).

## Layout

```
src/
├── main.tsx / app.tsx / router.tsx / styles.css
├── api/            # fetch wrapper, typed endpoint functions, EventSource (SSE) wrapper
├── state/          # auth / project / sessions / theme / locale contexts
├── lib/
│   ├── omni/       # OmniMessage stream → view-model reducer + connect-first/dedup controller
│   └── …           # formatting, i18n dictionaries (zh/en), attachments, helpers
├── components/     # ui primitives (modal, drawer, select, …) + app layout
└── features/       # chat / agents / plugins / skills / models / usage / traces / benchmark / admin
```

DTO types are imported type-only from `@waterford/waf-harness-server/api`; no server code enters the bundle. Rendering rules for streaming partials (start/delta/stop aggregation, complete-message replacement, origin-chain nesting into subagent cards) live in `lib/omni/stream-model.ts`, which is fully unit-tested.

## Development

Prereqs: Node >= 24, pnpm; run `pnpm install` at the repo root first (core must be built — the root `dev:*` scripts handle that).

```bash
pnpm dev:server   # backend at 127.0.0.1:7368 (dev port, not the installed server's 7364)
pnpm dev:web      # Vite dev server at 127.0.0.1:7365; /api proxied (SSE passes through)
```

The proxy target defaults to `http://127.0.0.1:7368` — the development backend, kept off the installed server's 7364 so the two can run at once (`PORT` moves both, `WAFH_API_PROXY` overrides the target outright). Auth is a same-origin HttpOnly cookie, so the proxy keeps everything same-origin.

```bash
pnpm --filter @waterford/waf-harness-web typecheck
pnpm --filter @waterford/waf-harness-web test        # vitest (pure logic)
pnpm --filter @waterford/waf-harness-web test:e2e    # Playwright against a mock LLM
pnpm --filter @waterford/waf-harness-web build       # vite build → dist/
```

## Production

No separate static server needed: `@waterford/waf-harness-server` auto-hosts `packages/web/dist` (or `WAFH_WEB_DIST`) with an SPA fallback — build the web app, start the server, done. The published npm packages bundle the built front end.

Part of [WAF Harness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
