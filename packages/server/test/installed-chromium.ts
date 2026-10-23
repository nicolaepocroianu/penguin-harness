/**
 * Playwright's Chromium, for the suites that drive a real browser and skip where it is not
 * installed. WAFH_TEST_REQUIRE_BROWSER=1 turns that skip into a failure: CI sets it once it
 * has installed the browser (.github/actions/chromium), so a browser that went missing there
 * fails the run instead of passing it with the browser's proofs unrun.
 */
import fs from "node:fs";
import { chromium } from "playwright-core";

function chromiumOnDisk(): string | null {
  try {
    const file = chromium.executablePath();
    return file && fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

/** The executable's path; null where it is not installed and the run does not require it. */
export function installedChromium(): string | null {
  const file = chromiumOnDisk();
  if (!file && process.env.WAFH_TEST_REQUIRE_BROWSER === "1")
    throw new Error(
      "WAFH_TEST_REQUIRE_BROWSER=1 but Playwright's Chromium is not installed. Install it with " +
        "`pnpm --filter @waterford/waf-harness-server exec playwright-core install chromium`.",
    );
  return file;
}
