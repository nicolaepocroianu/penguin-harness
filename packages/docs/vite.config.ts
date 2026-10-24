/**
 * Vite config: static docs site (React SPA + Tailwind CSS 4).
 *
 * BASE_PATH sets the public path the site is served under; it defaults to "/".
 * Doc pages are local Markdown files imported at build time via import.meta.glob
 * (?raw), so the built site is fully static — no server or CMS involved.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  // Fixed WAF Harness dev port (stands alone — only the main server default is
  // shared, as DEFAULT_SERVER_PORT in core; vite configs cannot import core TS).
  server: { port: 7367 },
});
