#!/usr/bin/env node
/** `wafh-hmr` as `pnpm link:cli` puts it on PATH; see launch.mjs. */
import { launch } from "./launch.mjs";

await launch("wafh-hmr.js");
