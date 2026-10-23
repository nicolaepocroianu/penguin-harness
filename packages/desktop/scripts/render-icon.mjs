/**
 * Render the app icon PNGs from the brand mark (packages/web/public/wafh-logo.svg,
 * treated as immutable — landing/docs carry byte-identical copies).
 *
 * Outputs (COMMITTED — regenerate only when the SVG changes):
 * - build/icon.png            1024×1024. electron-builder converts it to icns (mac,
 *                             >=512px required) and ico (win, >=256px) at pack time;
 *                             also the runtime BrowserWindow icon (see src/app-icon.ts).
 * - build/icon-mac.png        1024×1024 macOS master. The 824px artwork is centred on
 *                             the transparent canvas so Finder, Launchpad and the Dock
 *                             give it the same optical size as native macOS app icons.
 * - build/icons/<N>x<N>.png   128/256/512 freedesktop set for the Linux targets
 *                             (used as-is, no conversion).
 * - build/tray/tray.png       32×32 (+ @2x 64×64) colour tray icon for the Windows
 *                             notification area and Linux trays.
 * - build/tray/trayTemplate.png
 *                             16×16 (+ @2x 32×32) macOS menu bar image: a black silhouette
 *                             on transparency, which the menu bar inverts with its own
 *                             appearance. The tile solid with the W cut out of it — see
 *                             TEMPLATE_SVG below for why the whole mark cannot be used.
 * - ../browser-extension/icons/wafh-128.png
 *                             128×128, the browser extension's source icon, which its build
 *                             sizes and greys.
 *
 * Regenerate: node packages/desktop/scripts/render-icon.mjs
 * Rasterizes via the Playwright chromium already installed for packages/landing (no new
 * dependency; precedent: packages/landing/scripts/capture-readme-demo.mjs). Each size is
 * rendered at its native resolution (no downscaling), with a transparent background so
 * the SVG's rounded-rect clip keeps the corners transparent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");
const SVG_PATH = path.join(REPO_ROOT, "packages", "web", "public", "wafh-logo.svg");
const BUILD_DIR = path.join(PKG_DIR, "build");
const ICON_SET_DIR = path.join(BUILD_DIR, "icons");
const TRAY_DIR = path.join(BUILD_DIR, "tray");

// Resolve @playwright/test from the landing package's context (it is not a dependency
// of this package, and must not become one).
const requireLanding = createRequire(path.join(REPO_ROOT, "packages", "landing", "package.json"));
const { chromium } = requireLanding("@playwright/test");

const svgSource = readFileSync(SVG_PATH, "utf8");
const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const svgDataUrl = dataUrl(svgSource);

/**
 * The macOS menu bar image. A template image is a mask: the menu bar paints every
 * non-transparent pixel in its own colour and throws the original away, so the colour that
 * tells the five agents apart is lost and the faint ring is noise at 16px. What reads is the
 * tile itself, solid, with the W and its five points cut out of it.
 */
const TEMPLATE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 60 60"><mask id="w">` +
  `<rect x="2" y="2" width="60" height="60" fill="#fff"/>` +
  `<path d="M15 23 23 43 32 28 41 43 49 23" fill="none" stroke="#000" stroke-width="5" ` +
  `stroke-linecap="round" stroke-linejoin="round"/>` +
  `<g fill="#000"><circle cx="15" cy="23" r="5"/><circle cx="23" cy="43" r="5"/>` +
  `<circle cx="32" cy="28" r="5.5"/><circle cx="41" cy="43" r="5"/><circle cx="49" cy="23" r="5"/></g>` +
  `</mask><rect x="2" y="2" width="60" height="60" rx="15" fill="#000" mask="url(#w)"/></svg>`;
const templateDataUrl = dataUrl(TEMPLATE_SVG);

/**
 * Apple's 1024px app-icon template keeps the full rounded-square artwork inside an
 * 824×824 safe area. Unlike iOS, macOS does not add this margin for third-party icons:
 * handing electron-builder edge-to-edge artwork makes the icon visibly larger than its
 * neighbours in the Dock and Launchpad.
 */
const MAC_ARTWORK_RATIO = 824 / 1024;

/** icon.png is the Windows master; icon-mac.png is the padded macOS master. */
const targets = [
  { size: 1024, outPath: path.join(BUILD_DIR, "icon.png"), artworkRatio: 1 },
  { size: 1024, outPath: path.join(BUILD_DIR, "icon-mac.png"), artworkRatio: MAC_ARTWORK_RATIO },
  { size: 512, outPath: path.join(ICON_SET_DIR, "512x512.png"), artworkRatio: 1 },
  { size: 256, outPath: path.join(ICON_SET_DIR, "256x256.png"), artworkRatio: 1 },
  { size: 128, outPath: path.join(ICON_SET_DIR, "128x128.png"), artworkRatio: 1 },
  { size: 32, outPath: path.join(TRAY_DIR, "tray.png"), artworkRatio: 1 },
  { size: 64, outPath: path.join(TRAY_DIR, "tray@2x.png"), artworkRatio: 1 },
  {
    size: 128,
    outPath: path.join(REPO_ROOT, "packages", "browser-extension", "icons", "wafh-128.png"),
    artworkRatio: 1,
  },
  { size: 16, outPath: path.join(TRAY_DIR, "trayTemplate.png"), artworkRatio: 1, template: true },
  {
    size: 32,
    outPath: path.join(TRAY_DIR, "trayTemplate@2x.png"),
    artworkRatio: 1,
    template: true,
  },
];

mkdirSync(ICON_SET_DIR, { recursive: true });
mkdirSync(TRAY_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  for (const { size, outPath, artworkRatio, template = false } of targets) {
    const artworkSize = size * artworkRatio;
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent}` +
        `body{display:flex;align-items:center;justify-content:center}` +
        `img{display:block;width:${artworkSize}px;height:${artworkSize}px}</style>` +
        `<img src="${template ? templateDataUrl : svgDataUrl}">`,
    );
    await page.evaluate(() => document.querySelector("img").decode());
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    writeFileSync(outPath, png);
    console.log(
      `[render-icon] ${path.relative(PKG_DIR, outPath)} (${size}x${size}, ${png.length} bytes)`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
