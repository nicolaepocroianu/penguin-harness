/**
 * Find-in-page text matching lives in the shared UI package (components/content/find), where the
 * Markdown reader's find shares it with the page's find bar; this path keeps the app's imports.
 */
export { findMatches, matchAll, matchSnippet, stepMatchIndex } from "@waterford/waf-harness-ui";
export type { FindQuery, MatchSnippet, TextMatch } from "@waterford/waf-harness-ui";
