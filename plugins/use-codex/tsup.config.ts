import { defineConfig } from "tsup";

export default defineConfig({
  // The MCP server the Agent launches; a builtin plugin ships what it runs as one bundle.
  entry: { server: "src/server.mjs" },
  format: ["esm"],
  target: "node24",
  clean: true,
  sourcemap: true,
  noExternal: ["@agentclientprotocol/sdk", "@modelcontextprotocol/server", "zod"],
  // The Codex ACP adapter is spawned by its resolved path as its own process, and it pulls the
  // per-platform Codex binary through @openai/codex, so it stays an installed dependency.
  external: ["@agentclientprotocol/codex-acp"],
  banner: {
    js: 'import { createRequire as __wafHarnessCreateRequire } from "node:module"; const require = __wafHarnessCreateRequire(import.meta.url);',
  },
});
