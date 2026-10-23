/**
 * Drift guard for the server's self-update classifier.
 *
 * POST /api/version/update (packages/server/src/http/routes/version.ts) runs the update
 * job (packages/server/src/services/update-job.ts), which tells a refusal ("unsupported")
 * apart from a successful run by matching `wafh update` output against REFUSAL_MARKERS —
 * six English fragments duplicated from this package's i18n catalog.
 * The server cannot import the CLI (the dependency runs the other way), so the fragments
 * are hardcoded here too, on purpose: editing a refusal message without updating
 * REFUSAL_MARKERS would silently misclassify refusals as "updated", and this test turns
 * that drift into a loud failure at edit time. If it fails, change the marker in
 * packages/server/src/services/update-job.ts REFUSAL_MARKERS together with the string
 * (or keep the fragment intact in the new wording).
 */
import { describe, expect, it } from "vitest";
import { getMessages } from "../src/i18n.js";

const en = getMessages("en").update;

/**
 * Keep in sync with REFUSAL_MARKERS in packages/server/src/services/update-job.ts —
 * one marker per refusal message, paired with the en output that must contain it.
 * (`needsYes` / `cancelled` are not refusals the server can see: it always runs with
 * `--yes`.) The argument values are arbitrary; markers must not depend on them.
 */
const MARKERS: ReadonlyArray<{ marker: string; name: string; message: string }> = [
  {
    marker: "runs from a source checkout",
    name: "sourceCheckout",
    message: en.sourceCheckout(),
  },
  {
    marker: "Cannot tell how this wafh was installed",
    name: "unknownInstall",
    message: en.unknownInstall("/opt/wafh/cli.js"),
  },
  {
    marker: "could not be identified",
    name: "npmUnknownManager",
    message: en.npmUnknownManager("/usr/lib/node_modules", "1.2.3"),
  },
  {
    marker: "does not run on Windows",
    name: "windowsUnsupported",
    message: en.windowsUnsupported(),
  },
  {
    marker: "cannot run your package manager for you",
    name: "windowsGlobalInstall",
    message: en.windowsGlobalInstall("npm install -g @waterford/waf-harness-cli@1.2.3"),
  },
  {
    marker: "which publishes no releases",
    name: "noReleases",
    message: en.noReleases("example/fork"),
  },
];

describe("update refusal markers (server classifier contract)", () => {
  for (const { marker, name, message } of MARKERS) {
    it(`en update.${name} still contains its server-side marker`, () => {
      expect(message).toContain(marker);
    });
  }
});
