# @waterford/waf-harness-docs

The WAF Harness documentation site (React + Vite + Tailwind CSS 4). English pages, light/dark themes, a sidebar + per-page table of contents, and a "Copy Markdown" button on every page.

## Content model

Pages are local Markdown files — `content/<slug>.en.md`, one file per page, in English. Frontmatter:

```markdown
---
title: Page title
description: One-line summary rendered under the title
---
```

Navigation (sections, order, prev/next) is defined once in `src/lib/nav.ts`; a vitest check (`test/content.test.ts`) keeps nav and content in sync — every navigated slug must have both language files with a title, and no orphan files may exist. Internal links are written as absolute doc paths (`[Core Interfaces](/interfaces)`).

## Development

```bash
pnpm dev:docs                                      # http://127.0.0.1:7367 (repo root script)
pnpm --filter @waterford/waf-harness-docs build      # dist/ + per-route shells for deep links
pnpm --filter @waterford/waf-harness-docs typecheck
pnpm --filter @waterford/waf-harness-docs test
```

## Deployment

The build is a static site. Set `BASE_PATH` (default `/`) to serve it under a sub-path.

Deep links work without a 404 fallback: the post-build step copies the SPA shell to `dist/<slug>/index.html` for every content slug.

Part of [WAF Harness](https://github.com/nicolaepocroianu/waf-harness) · Apache-2.0
