/**
 * The learner runtime a preview plays in.
 *
 * Loom's dev sandbox played an activity in a page of its own: the WAF framework's source,
 * bundled with webpack, started with `lifecycle.startActivity` and a set of stand-in
 * services, fetching its configuration from routes that answer the way the WAF backend
 * would. This is that page, ported. It is built once from the checkout's framework and
 * served per activity under one base path, which the framework is told about twice: as
 * `content.baseUrl`, which every relative asset path it resolves is joined to, and as the
 * API host, which every configuration and assessment call is made against.
 *
 * Everything here is a string or a pure function. The service builds and serves it.
 */
import { createHash } from "node:crypto";

/**
 * The player's entry, bundled against the framework.
 *
 * Loom's `player.js`, less what only Loom's shell used (interactable highlighting and the
 * state relay to its inspector). What the page needs to know arrives as JSON in
 * `#penguin-sandbox`, not as query parameters, because the page is the server's to write.
 */
export const PLAYER_SOURCE = String.raw`
const globals = require('@waf-framework/src/common/globals');
const Logging = require('@waf-framework/src/common/logs/logging');
const PubSub = require('wafpubsub');
const SandboxTransport = require('@waf-framework/src/sandbox/SandboxTransport');
const Activity = require('@waf-framework/src/common/activity');
const assessment = require('@waf-framework/src/common/assessmentService');
const Messaging = require('@waf-framework/src/common/Messaging');
const PauseController = require('@waf-framework/src/common/pauseController');
const Services = require('@waf-framework/src/common/Services');
const urlManager = require('@waf-framework/src/common/urlManager');

const sandbox = JSON.parse(document.getElementById('penguin-sandbox').textContent);

Logging.setTransport(new SandboxTransport());

const pubSub = new PubSub();
patchConfigurationRequests(sandbox.languageCode, sandbox.startSceneId);

globals.initialize(pubSub);
Services.initialize(pubSub);

pubSub.subscribe('services:ready', (wapApi) => {
    // The page's own origin is the stand-in backend. The bearer token is dropped because
    // the only credential this origin honours is the one already in the path.
    if (wapApi.options && wapApi.options.headers) delete wapApi.options.headers.authorization;
    const callApi = wapApi.callApi;
    wapApi.callApi = function patchedCallApi(options) {
        options.protocol = window.location.protocol;
        return callApi.call(wapApi, options);
    };
});

const pauseController = new PauseController(pubSub);
globals.setPauseController(pauseController);
Messaging.initialize(pubSub);
urlManager.initialize(pubSub);

document.body.addEventListener('keyup', (event) => {
    if (event.key === 'Pause' || (event.key === 'P' && event.shiftKey)) {
        pubSub.publish('pauseController:togglePause');
    }
});

pubSub.on(Activity.Events.Started, hideLoading);

// Every file this page fetches rides on a link that expires. Past that, pages and sounds
// fail one by one as they are asked for, which looks like a broken activity; saying so
// once, over the activity, is the honest version.
if (typeof sandbox.expiresAt === 'number') {
    const showExpired = () => {
        const notice = document.getElementById('playerExpired');
        if (notice) notice.hidden = false;
    };
    const remaining = sandbox.expiresAt - Date.now();
    if (remaining <= 0) showExpired();
    else setTimeout(showExpired, Math.min(remaining, 2147483647));
}
pubSub.on(Activity.Events.ActivityLoadFailed, handleActivityFailed);

function hideLoading() {
    const loading = document.getElementById('playerLoading');
    if (loading) loading.hidden = true;
}

function startPlayer() {
    Activity.initialize(pubSub);
    if (sandbox.hasAssessment) {
        new assessment.AssessmentItemService(pubSub);
    } else {
        pubSub.publish(assessment.Events.AssessmentServiceReady);
    }

    const base = sandbox.base;
    window.postMessage(
        {
            type: 'lifecycle.startActivity',
            loglevel: -1,
            sentryEnabled: false,
            region: 'us-east-1',
            activity: {
                id: sandbox.moduleId,
                target: 'web',
                productCode: sandbox.productCode,
                refNum: sandbox.refNum,
                ...(sandbox.resolution ? { resolution: sandbox.resolution } : {}),
            },
            jwt: 'penguin-sandbox',
            services: {
                apiKey: 'penguin-sandbox',
                // The framework joins hostname and path as text, so a host carrying the
                // base path puts every API call under it.
                hostname: window.location.host + base.replace(/\/$/, ''),
                protocol: window.location.protocol,
                content: { baseUrl: base, activity: base + 'media' },
            },
            student: {
                name: 'Developer',
                languageCode: sandbox.languageCode,
                application: 'penguin-sandbox',
                organization: 'penguin-sandbox',
                id: 'penguin-student',
            },
            user: { languageCode: sandbox.languageCode },
        },
        location.origin
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPlayer, { once: true });
} else {
    startPlayer();
}

function isConfigurationPath(pathname) {
    return /\/activity\/v[23]\/configuration\/activities\/(mapping|[^/]+\/version\/[^/]+)$/.test(pathname);
}

function withPreviewParams(input, languageCode, startSceneId) {
    if (typeof input !== 'string' && !(input instanceof URL)) return input;
    try {
        const original = String(input);
        const url = new URL(original, window.location.href);
        if (url.origin !== window.location.origin || !isConfigurationPath(url.pathname)) return input;
        if (languageCode) url.searchParams.set('languageCode', languageCode);
        if (startSceneId) url.searchParams.set('startSceneId', startSceneId);
        return /^[a-z][a-z\d+.-]*:/i.test(original) ? url.toString() : url.pathname + url.search + url.hash;
    } catch {
        return input;
    }
}

// The framework asks for "the activity"; the preview's language and start scene ride along
// on that one request, which is where the server scopes the configuration.
function patchConfigurationRequests(languageCode, startSceneId) {
    if (!languageCode && !startSceneId) return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function fetchWithPreview(input, init) {
        if (input instanceof Request) {
            return nativeFetch(new Request(withPreviewParams(input.url, languageCode, startSceneId), input), init);
        }
        return nativeFetch(withPreviewParams(input, languageCode, startSceneId), init);
    };
    const nativeOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function openWithPreview(method, url, ...rest) {
        return nativeOpen.call(this, method, withPreviewParams(url, languageCode, startSceneId), ...rest);
    };
}

function handleActivityFailed(...reasons) {
    hideLoading();
    pubSub.emit('suspendController:setSuspend', true);
    // A failure arrives as an Error, a failure-details object or a string; each says what
    // went wrong somewhere different.
    const describe = (reason) => {
        if (!reason) return '';
        if (typeof reason === 'string') return reason;
        if (reason.message) return String(reason.message);
        if (reason.details && reason.details.message) return String(reason.details.message);
        try { return JSON.stringify(reason); } catch { return String(reason); }
    };
    const message = reasons.map(describe).filter(Boolean).join(' ');
    document.getElementById('activity').textContent = message || 'Activity failed to load.';
    console.error('Activity failed to load', reasons);
}
`;

/**
 * Builds the player bundle with the framework's own webpack. CommonJS on stdin; the job
 * arrives in the environment. The defines are the framework's build-time constants, set
 * as Loom sets them: a debug build, and `{{MEDIA}}` resolving to `media` under the base.
 */
export const PLAYER_BUILD_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const job = JSON.parse(process.env.PENGUIN_PLAYER_BUILD);
const frameworkRoot = path.resolve(job.frameworkRoot);
const outputRoot = path.resolve(job.outputRoot);
const frameworkRequire = createRequire(path.join(frameworkRoot, 'package.json'));
const webpack = frameworkRequire('webpack');
const frameworkPackage = frameworkRequire('./package.json');

fs.mkdirSync(outputRoot, { recursive: true });
const entry = path.join(outputRoot, 'player-entry.js');
fs.writeFileSync(entry, job.source);

webpack({
    mode: 'development',
    devtool: 'source-map',
    target: ['web'],
    entry: { player: entry },
    output: {
        filename: '[name].js',
        path: outputRoot,
        // Derived from the script's own URL, so the lazily loaded framework libraries
        // arrive from wherever the player itself was served.
        publicPath: 'auto',
    },
    resolve: {
        modules: [path.join(frameworkRoot, 'node_modules'), 'node_modules'],
        alias: { '@waf-framework': frameworkRoot },
    },
    plugins: [
        new webpack.DefinePlugin({
            VERSION: JSON.stringify(frameworkPackage.version),
            TARGET: JSON.stringify('debug'),
            TIER: JSON.stringify('qa'),
            URL_PARAMETERS: JSON.stringify({ target: 'debug', MEDIA: '/media' }),
        }),
    ],
}, (error, stats) => {
    if (error) {
        console.error(error.stack || String(error));
        process.exit(1);
    }
    console.log(stats.toString({ colors: false, all: false, assets: true, errors: true, warnings: false }));
    process.exit(stats.hasErrors() ? 1 : 0);
});
`;

/**
 * What a built player was built from. A player is rebuilt when either changes: a new
 * framework version, or a new player entry in a new Penguin.
 */
export function playerStamp(frameworkVersion: string): string {
  return createHash("sha256")
    .update(frameworkVersion)
    .update("\0")
    .update(PLAYER_SOURCE)
    .update("\0")
    .update(PLAYER_BUILD_SCRIPT)
    .digest("hex")
    .slice(0, 16);
}

/** What the page tells the player about the activity it plays. */
export interface PlayerPageInput {
  /** The per-activity base every sandbox path hangs off, ending in a slash. */
  base: string;
  title: string;
  moduleId: string;
  productCode: string;
  refNum: number;
  hasAssessment: boolean;
  resolution: string | null;
  languageCode: string | null;
  startSceneId: string | null;
  /** When the page's link stops working, epoch milliseconds; null when it does not. */
  expiresAt: number | null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/**
 * The player page.
 *
 * The configuration is JSON inside a non-executing script element, with `<` escaped so a
 * title containing `</script>` cannot end the element early.
 */
export function playerPage(input: PlayerPageInput): string {
  const json = JSON.stringify(input).replace(/</g, "\\u003c");
  const base = escapeHtml(input.base);
  return `<!DOCTYPE html>
<html lang="en" oncontextmenu="return false;">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <link rel="stylesheet" type="text/css" href="${base}css/style.css" />
    <style>
      html, body { min-height: 100%; margin: 0; background: #0b1117; color: #c7d2de; }
      #playerLoading {
        position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center;
        justify-content: center; background: #229cbd; color: #fff; font: 600 1.25rem/1.2 sans-serif;
      }
      #playerLoading[hidden], #playerExpired[hidden] { display: none; }
      #playerExpired {
        position: fixed; inset: 0; z-index: 100001; display: flex; align-items: center;
        justify-content: center; padding: 24px; text-align: center; background: rgba(11, 17, 23, 0.92);
        color: #fff; font: 600 1.1rem/1.4 sans-serif;
      }
    </style>
  </head>
  <body>
    <main id="content-wrapper">
      <div id="content">
        <div id="activity"></div>
        <div id="navBar"></div>
      </div>
      <div id="pauseOverlay" draggable="false">
        <img src="${base}images/pause.png" alt="Pause" id="pauseImage" draggable="false" />
      </div>
      <div id="teacherHelpOverlay" draggable="false">
        <img src="${base}images/teacherHelp.jpg" alt="" id="teacherHelpImage" draggable="false" />
      </div>
      <div id="playerLoading" role="status" aria-live="polite">Loading preview…</div>
      <div id="playerExpired" role="alert" hidden>
        This preview link has expired, so its pictures and sounds can no longer load. Reload the preview to keep playing.
      </div>
    </main>
    <script type="application/json" id="penguin-sandbox">${json}</script>
    <script src="${base}player/player.js"></script>
  </body>
</html>
`;
}
