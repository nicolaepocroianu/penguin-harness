/**
 * Vitest config kept separate from vite.config.ts (vitest's embedded vite types conflict with this package's vite 7 plugin
 * types). Tests cover pure modules and content integrity only, so a node
 * environment with no plugins suffices.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
