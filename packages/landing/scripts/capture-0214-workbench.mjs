/**
 * Capture the 0.2.14 workbench screenshots: an agent's own page beside its chat, built from
 * one sentence, edited by asking, versioned.
 *
 * Everything on screen is the real thing: the built server on a scratch data root, a scripted
 * mock LLM (OpenAI chat-completions SSE) whose tool calls really run, and the workbench the
 * server really hot-loads from the files those tool calls write.
 *
 * - BUILD: on the start page the "A legal agent app from one sentence" example fills the
 *   composer; Send. The default agent creates `legal_agent` on disk (exec_command), writes its
 *   AGENTS.md and the workbench `workbenches/legal-desk/` (package.json, index.ts, ui/index.html),
 *   then reads `.build/status.json`. The desk's state (five uploaded contracts, four reviewed)
 *   is seeded as the workbench's `state.json` fixture before its first load.
 * - EDIT: on the legal agent's own chat page the "Contract desk" tab sits beside Chat. The
 *   user asks for a risk column; the agent reads the page, makes two real edit_file calls, and
 *   reads the load status. The watcher reloads the workbench and the open tab refreshes.
 * - HISTORY: the tab's History fold lists both recorded versions, with Restore on the older.
 *
 * Files (into $SHOT_OUT, PNG, deviceScaleFactor 2), in English:
 *   workflow-example-en, workflow-build-en, workflow-page-en (before the edit),
 *   workflow-edit-en, workflow-page-after-en, workflow-history-en,
 *   workflow-restore-en, workflow-fill-app-en,
 *   waf-harness-0-2-14-workflow-en (= page after), waf-harness-0-2-14-workflow-edit-en.
 *
 * Env: SHOT_SCRATCH (data roots go under it), SHOT_OUT, SHOT_LANGS (default "en"),
 * SHOT_SRV_PORT / SHOT_MOCK_PORT (default 19120 / 19121).
 * Prereqs: a built tree (`pnpm -r build`) and Playwright's chromium.
 * Run from the tree: `node packages/landing/scripts/capture-0214-workbench.mjs`.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SCRATCH = process.env.SHOT_SCRATCH ?? path.join(ROOT, ".shots-0214-workbench");
const OUT_DIR = process.env.SHOT_OUT ?? path.join(SCRATCH, "out");
const LANGS = (process.env.SHOT_LANGS ?? "en").split(",");
const SRV_PORT = Number(process.env.SHOT_SRV_PORT ?? 19120);
const MOCK_PORT = Number(process.env.SHOT_MOCK_PORT ?? 19121);
const ADMIN_PASSWORD = "wafh-2026";
// The App is canonically served on `localhost` (127.0.0.1 is the Workspace-preview host).
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const RUN = path.join(SCRATCH, `run-${Date.now()}`);
const HOME = path.join(RUN, "home");
const LEGAL = "legal_agent";
const WF = "legal-desk";

// ---------------------------------------------------------------------------
// What the agents write: the legal desk workbench, in each UI language.
// ---------------------------------------------------------------------------

const PAGE_TEXT = {
  en: {
    htmlLang: "en",
    locale: "en-US",
    title: "Contract desk",
    intro:
      "Upload a contract or agreement. The legal agent reviews it in the background and leaves a report here for you to download.",
    upload: "Upload files",
    dropHint: "or drop them here",
    types: "PDF, DOCX or TXT, up to 50 MB each",
    file: "File",
    uploaded: "Uploaded",
    size: "Size",
    status: "Status",
    report: "Report",
    done: "Reviewed",
    analyzing: "Analyzing…",
    failed: "Failed",
    download: "Download",
    empty: "No files yet. Upload a contract to start.",
    summary: "{n} files · {ready} reports ready",
    risk: "Risk",
    levels: { high: "High", medium: "Medium", low: "Low" },
  },
};

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "legal-desk",
    version: "1.0.0",
    type: "module",
    wafh: {
      modules: [
        {
          name: "Workbench",
          requires: {
            host: { iface: "@waterford/waf-harness-server#WorkbenchHost", from: "Host" },
          },
          provides: { main: "@waterford/waf-harness-server#WorkbenchMain" },
          contributes: {
            "WebModule.sessionTabs": [
              {
                id: "legal-desk.desk",
                key: "desk",
                title: "Contract desk",
                renderer: { iframe: { src: "ui/index.html" } },
              },
            ],
          },
        },
      ],
    },
  },
  null,
  2,
)}\n`;

const INDEX_TS = `import type { WorkbenchPackage } from "@waterford/waf-harness-server/plugin";

type Risk = "high" | "medium" | "low";

interface DeskFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  status: "analyzing" | "done" | "failed";
  sessionId?: string;
  risk?: Risk;
  /** The review, in Markdown, once the legal agent has posted it. */
  report?: string;
}

interface Desk {
  files: DeskFile[];
}

const RISKS: readonly string[] = ["high", "medium", "low"];

/** What the legal agent is asked to do with one upload, in a Session of its own. */
function reviewRequest(file: DeskFile, text: string): string {
  return [
    \`Review the document "\${file.name}" (desk file \${file.id}).\`,
    "Find the risky clauses, explain why each one is a risk, and suggest a revision.",
    "Rate the overall risk as high, medium or low.",
    \`Then post the result to this desk's /report route as JSON: { "id": "\${file.id}", "risk": "<high|medium|low>", "report": "<the review in Markdown>" }.\`,
    "",
    "<document>",
    text,
    "</document>",
  ].join("\\n");
}

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        const desk = (): Desk => {
          const state = host.getState() as Partial<Desk> | null;
          return { files: Array.isArray(state?.files) ? state.files : [] };
        };
        return {
          api: {
            main: {
              async handle(req) {
                if (req.method === "GET" && req.path === "/files") {
                  // The page sees statuses and whether a report is ready, never the reviews themselves.
                  const files = desk().files.map(({ report, sessionId, ...file }) => ({
                    ...file,
                    hasReport: report !== undefined,
                  }));
                  return { body: { files } };
                }
                if (req.method === "POST" && req.path === "/upload") {
                  const bytes = req.bytes ?? new Uint8Array();
                  const file: DeskFile = {
                    id: crypto.randomUUID(),
                    name: decodeURIComponent(req.headers["x-file-name"] ?? "document"),
                    size: bytes.byteLength,
                    uploadedAt: new Date().toISOString(),
                    status: "analyzing",
                  };
                  const { sessionId } = await host.createSession();
                  file.sessionId = sessionId;
                  const next = desk();
                  next.files.unshift(file);
                  await host.setState(next);
                  const text = new TextDecoder().decode(bytes);
                  await host.run(sessionId, [{ text: reviewRequest(file, text) }]);
                  return { status: 201, body: { id: file.id } };
                }
                if (req.method === "POST" && req.path === "/report") {
                  const { id, risk, report } = (req.body ?? {}) as {
                    id?: string;
                    risk?: string;
                    report?: string;
                  };
                  const next = desk();
                  const file = next.files.find((f) => f.id === id);
                  if (!file || typeof report !== "string" || !RISKS.includes(risk ?? "")) {
                    return { status: 400, body: { error: "expected { id, risk, report } for a file on this desk" } };
                  }
                  file.status = "done";
                  file.risk = risk as Risk;
                  file.report = report;
                  await host.setState(next);
                  return { body: { ok: true } };
                }
                if (req.method === "GET" && req.path === "/report") {
                  const file = desk().files.find((f) => f.id === req.query["id"]);
                  if (!file || file.report === undefined) {
                    return { status: 404, body: { error: "no report for this file yet" } };
                  }
                  const base = file.name.replace(/\\.[^.]+$/, "");
                  const headers: Record<string, string> = {
                    "content-type": "text/markdown; charset=utf-8",
                    "content-disposition": \`attachment; filename*=UTF-8''\${encodeURIComponent(base + " - review.md")}\`,
                  };
                  return { headers, body: file.report };
                }
                return { status: 404, body: { error: "no such route" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

// The page is written in plain JS with string concatenation (no template literals), so this
// file can hold it in template literals of its own without escaping.
const STYLE_ANCHOR = "  .summary { margin-top: 12px; }\n";
const STYLE_RISK = `  .risk { display: inline-flex; align-items: center; gap: 2px; }
  .risk i { width: 4px; height: 12px; border-radius: 1px; background: var(--wb-border); }
  .risk b { margin-left: 6px; font-weight: 500; }
  .risk-low i:nth-child(1), .risk-medium i:nth-child(-n+2), .risk-high i { background: var(--wb-fg); }
  .risk-high b { font-weight: 700; }
`;

const RENDER_V1 = `function render(files) {
  var table = document.getElementById("files");
  var summary = document.getElementById("summary");
  if (files.length === 0) {
    table.innerHTML = "<tbody><tr><td class=\\"wb-muted\\">" + T.empty + "</td></tr></tbody>";
    summary.textContent = "";
    return;
  }
  table.innerHTML =
    "<thead><tr><th>" + T.file + "</th><th>" + T.uploaded + "</th><th class=\\"num\\">" + T.size +
    "</th><th>" + T.status + "</th><th>" + T.report + "</th></tr></thead><tbody>" +
    files.map(function (f) {
      return "<tr><td class=\\"name\\">" + esc(f.name) + "</td><td>" + when(f.uploadedAt) +
        "</td><td class=\\"num\\">" + size(f.size) + "</td><td>" + status(f) + "</td><td>" +
        report(f) + "</td></tr>";
    }).join("") + "</tbody>";
  summary.textContent = T.summary.replace("{n}", files.length)
    .replace("{ready}", files.filter(function (f) { return f.hasReport; }).length);
}
`;

function renderV2(lang) {
  const t = PAGE_TEXT[lang];
  return `var RANK = { high: 0, medium: 1, low: 2 };
var LEVELS = ${JSON.stringify(t.levels)};

function risk(f) {
  if (!f.risk) return "<span class=\\"wb-muted\\">—</span>";
  return "<span class=\\"risk risk-" + f.risk + "\\"><i></i><i></i><i></i><b>" + LEVELS[f.risk] + "</b></span>";
}

function render(files) {
  var table = document.getElementById("files");
  var summary = document.getElementById("summary");
  if (files.length === 0) {
    table.innerHTML = "<tbody><tr><td class=\\"wb-muted\\">" + T.empty + "</td></tr></tbody>";
    summary.textContent = "";
    return;
  }
  // Riskiest first; files still under review (no rating yet) go last, newest first among equals.
  var sorted = files.slice().sort(function (a, b) {
    var ra = a.risk ? RANK[a.risk] : 3;
    var rb = b.risk ? RANK[b.risk] : 3;
    return ra - rb;
  });
  table.innerHTML =
    "<thead><tr><th>" + T.file + "</th><th>" + T.uploaded + "</th><th class=\\"num\\">" + T.size +
    "</th><th>" + T.status + "</th><th>" + ${JSON.stringify(t.risk)} + "</th><th>" + T.report +
    "</th></tr></thead><tbody>" +
    sorted.map(function (f) {
      return "<tr><td class=\\"name\\">" + esc(f.name) + "</td><td>" + when(f.uploadedAt) +
        "</td><td class=\\"num\\">" + size(f.size) + "</td><td>" + status(f) + "</td><td>" +
        risk(f) + "</td><td>" + report(f) + "</td></tr>";
    }).join("") + "</tbody>";
  summary.textContent = T.summary.replace("{n}", files.length)
    .replace("{ready}", files.filter(function (f) { return f.hasReport; }).length);
}
`;
}

function pageHtml(lang) {
  const t = PAGE_TEXT[lang];
  const T = {
    empty: t.empty,
    file: t.file,
    uploaded: t.uploaded,
    size: t.size,
    status: t.status,
    report: t.report,
    done: t.done,
    analyzing: t.analyzing,
    failed: t.failed,
    download: t.download,
    summary: t.summary,
  };
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<link rel="stylesheet" href="/workbench-ui.css">
<style>
  body { max-width: 980px; margin: 0 auto; padding: 28px 24px; }
  .intro { color: var(--wb-muted); margin-bottom: 20px; max-width: 640px; }
  .drop { display: flex; align-items: center; gap: 14px; padding: 18px 20px; border-style: dashed; margin-bottom: 24px; }
  .drop.over { border-color: var(--wb-accent); }
  .drop p { margin: 0; }
  td.name { font-weight: 500; }
  td a { text-decoration: underline; text-underline-offset: 3px; }
  .num { text-align: right; }
  .status { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wb-muted); }
  .dot.done { background: var(--wb-accent); }
  .dot.analyzing { background: transparent; border: 1.5px solid var(--wb-muted); width: 5px; height: 5px; }
${STYLE_ANCHOR}</style>
</head>
<body>
<h1>${t.title}</h1>
<p class="intro">${t.intro}</p>
<div class="wb-card drop" id="drop">
  <button class="wb-primary" type="button" id="pick">${t.upload}</button>
  <p>${t.dropHint} <span class="wb-muted">· ${t.types}</span></p>
  <input type="file" id="file" multiple hidden accept=".pdf,.docx,.doc,.txt,.md">
</div>
<table id="files"></table>
<p class="summary wb-muted" id="summary"></p>
<script>
var T = ${JSON.stringify(T)};
var LOCALE = ${JSON.stringify(t.locale)};

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;" }[c];
  });
}
function size(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}
function when(iso) {
  return new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function status(f) {
  return "<span class=\\"status\\"><span class=\\"dot " + f.status + "\\"></span>" + T[f.status] + "</span>";
}
function report(f) {
  if (!f.hasReport) return "<span class=\\"wb-muted\\">—</span>";
  return "<a href=\\"../api/report?id=" + encodeURIComponent(f.id) + "\\" download>" + T.download + "</a>";
}

${RENDER_V1}
function refresh() {
  return fetch("../api/files").then(function (r) { return r.json(); }).then(function (d) { render(d.files); });
}
function upload(list) {
  return Promise.all(Array.prototype.map.call(list, function (f) {
    return fetch("../api/upload", {
      method: "POST",
      headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name) },
      body: f,
    });
  })).then(refresh);
}

var input = document.getElementById("file");
var drop = document.getElementById("drop");
document.getElementById("pick").onclick = function () { input.click(); };
input.onchange = function () { upload(input.files); input.value = ""; };
drop.ondragover = function (e) { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = function () { drop.classList.remove("over"); };
drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files); };

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;
}

const AGENTS_MD = {
  en: `# Legal Reviewer

You review contracts, agreements and other legal documents for the user.

- Find the clauses that carry risk: liability caps, indemnities, auto-renewal, termination, IP ownership, governing law, unusual penalties.
- For each one, quote the clause, say why it is a risk for the user's side, and suggest a revision.
- Rate the document's overall risk as high, medium or low, and say what drives the rating.
- Write the report in Markdown, in the language of the document.
- You are not a lawyer of record: flag what needs a lawyer's review rather than deciding it.
`,
};

/**
 * The desk's state before the shots: five uploads, four reviewed. Upload times are minutes
 * before the run (the third field), so they read as earlier today beside the conversation's
 * own timestamps, which the server stamps with the real clock.
 */
const DESK_FILES = {
  en: [
    ["Employment Contract - Template v3.docx", 55_296, 4, null],
    ["Supplier Agreement - Kestrel Foods.pdf", 655_360, 27, "high"],
    ["Office Lease - Unit 1204.pdf", 1_405_092, 49, "medium"],
    ["Mutual NDA - Helios Labs.docx", 88_064, 70, "low"],
    ["Master Services Agreement - Northwind Logistics.pdf", 431_104, 76, "high"],
  ],
};

function deskState(lang) {
  return {
    files: DESK_FILES[lang].map(([name, size, minutesAgo, risk], i) => ({
      id: `f${5 - i}`,
      name,
      size,
      uploadedAt: new Date(Math.floor(Date.now() / 60000 - minutesAgo) * 60000).toISOString(),
      status: risk === null ? "analyzing" : "done",
      ...(risk === null
        ? {}
        : {
            risk,
            report: `# Review: ${name}\n\nOverall risk: ${risk}\n`,
          }),
    })),
  };
}

// ---------------------------------------------------------------------------
// The two conversations, in each language.
// ---------------------------------------------------------------------------

const SCENES = {
  en: {
    // The start page example's prompt (S.chat.exampleTasks.legalDesk.prompt); matched by its head.
    buildMarker: "Create a legal agent that reviews contracts",
    buildTitle: "Legal agent and its desk",
    agentName: "Legal Reviewer",
    agentDesc:
      "Reviews contracts and agreements: finds risky clauses, explains why, suggests revisions",
    build: [
      {
        thinking:
          "Two parts. First the legal agent itself: a new agent folder with its own AGENTS.md. Then its desk, as a workbench in the legal agent's own workbenches/ folder, so the tab sits beside that agent's chat rather than mine.",
        text: "I'll create the legal agent first, then build its desk as a workbench in that agent's folder.",
      },
      { text: "Now its role and review rules." },
      { text: "Next, the desk: a workbench with one tab, an upload route and a report download." },
      {},
      {},
      { text: "Checking that the server loaded it." },
    ],
    buildDone: `Done. **Legal Reviewer** (\`legal_agent\`) is ready, and its **Contract desk** tab is live: \`.build/status.json\` reports \`ok: true\` with the \`desk\` tab.

- Upload files on the desk; each one starts a review Session of the legal agent in the background.
- The list shows every file's status, and a **Download** link once its report is ready.
- The page shows no conversation, and every colour comes from the theme variables.

Open Legal Reviewer in the sidebar to use the desk.`,
    editPrompt:
      "On the desk, show each contract's overall risk next to its status, and put the riskiest contracts at the top.",
    editTitle: "Risk column on the desk",
    edit: [
      {
        thinking:
          "Every finished review already carries a risk rating in the desk's state, so the handler needs no change. The page gets a Risk column and a sort.",
        text: "Each review already records a risk rating, so only the page changes.",
      },
      {},
      {},
      { text: "Checking the reload." },
    ],
    editDone: (rev) =>
      `The desk now has a **Risk** column (High, Medium, Low) and lists the riskiest contracts first; files still under review stay at the bottom. The edit loaded cleanly (\`ok: true\`, revision \`${rev}\`), so the open tab has already refreshed. The previous version is under **History** if you want it back.`,
  },
};

// Per-language runtime facts the mock needs (filled in by provisioning).
const CTX = {};

const appDataDir = (lang) => path.join(HOME, CTX[lang].projectId);
const legalDir = (lang) => path.join(appDataDir(lang), "agents", LEGAL);
const wfDir = (lang) => path.join(legalDir(lang), "workbenches", WF);

/** The tool call of one build step (index = tool results so far). */
function buildCall(lang, step) {
  const scene = SCENES[lang];
  switch (step) {
    case 0:
      return {
        name: "exec_command",
        args: {
          description: "Create legal_agent from the default config",
          cmd: [
            `mkdir -p agents/${LEGAL}/agent_state/skills agents/${LEGAL}/agent_state/memory agents/${LEGAL}/agent_state/tools agents/${LEGAL}/scratchpad`,
            `cp agents/default_agent/agent_state/system_config.yaml agents/${LEGAL}/agent_state/`,
            `sed -i -e 's/^name: .*/name: ${scene.agentName}/' -e 's/^description: .*/description: "${scene.agentDesc}"/' agents/${LEGAL}/agent_state/system_config.yaml`,
            `grep -E '^(name|description|version):' agents/${LEGAL}/agent_state/system_config.yaml`,
          ].join(" && "),
          workdir: appDataDir(lang),
        },
      };
    case 1:
      return {
        name: "write_file",
        args: {
          file_path: path.join(legalDir(lang), "agent_state", "AGENTS.md"),
          content: AGENTS_MD[lang],
        },
      };
    case 2:
      return {
        name: "write_file",
        args: { file_path: path.join(wfDir(lang), "package.json"), content: PACKAGE_JSON },
      };
    case 3:
      return {
        name: "write_file",
        args: { file_path: path.join(wfDir(lang), "index.ts"), content: INDEX_TS },
      };
    case 4:
      return {
        name: "write_file",
        args: { file_path: path.join(wfDir(lang), "ui", "index.html"), content: pageHtml(lang) },
      };
    case 5:
      return {
        name: "read_file",
        args: { file_path: path.join(wfDir(lang), ".build", "status.json") },
      };
    default:
      return null;
  }
}

function editCall(lang, step) {
  const page = path.join(wfDir(lang), "ui", "index.html");
  switch (step) {
    case 0:
      return { name: "read_file", args: { file_path: page } };
    case 1:
      return {
        name: "edit_file",
        args: { file_path: page, old_string: RENDER_V1, new_string: renderV2(lang) },
      };
    case 2:
      return {
        name: "edit_file",
        args: { file_path: page, old_string: STYLE_ANCHOR, new_string: STYLE_ANCHOR + STYLE_RISK },
      };
    case 3:
      return {
        name: "read_file",
        args: { file_path: path.join(wfDir(lang), ".build", "status.json") },
      };
    default:
      return null;
  }
}

/** Lists the legal agent's workbenches: starts the server's watcher and loads what changed. */
async function listWorkbenches(lang) {
  const { cookie, projectId } = CTX[lang];
  return (await api(cookie, "GET", `/api/projects/${projectId}/agents/${LEGAL}/workbenches`)).json;
}

function currentRevision(lang) {
  try {
    return JSON.parse(readFileSync(path.join(wfDir(lang), ".build", "status.json"), "utf8"))
      .revision;
  } catch {
    return "?";
  }
}

// ---------------------------------------------------------------------------
// Mock LLM (OpenAI chat-completions SSE).
// ---------------------------------------------------------------------------

/** Index of the last message whose JSON contains `marker`, or -1. */
function lastIndexWith(messages, marker) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (JSON.stringify(messages[i]).includes(marker)) return i;
  }
  return -1;
}

async function decideTurn(messages) {
  const flat = JSON.stringify(messages);
  if (flat.includes("You are a title generator")) {
    for (const lang of ["en"]) {
      const s = SCENES[lang];
      if (flat.includes(s.editPrompt.slice(0, 30))) return { kind: "title", text: s.editTitle };
      if (flat.includes(s.buildMarker)) return { kind: "title", text: s.buildTitle };
    }
    return { kind: "title", text: "Conversation" };
  }
  for (const lang of ["en"]) {
    const s = SCENES[lang];
    const editAt = lastIndexWith(messages, s.editPrompt.slice(0, 30));
    const buildAt = lastIndexWith(messages, s.buildMarker);
    if (editAt >= 0) {
      const step = messages.slice(editAt + 1).filter((m) => m.role === "tool").length;
      // The reload is the watcher's: make sure it has run before the agent reads the status.
      if (step === 3) await listWorkbenches(lang);
      const call = editCall(lang, step);
      if (call) return { kind: "turn", ...s.edit[step], call };
      return { kind: "turn", text: s.editDone(currentRevision(lang)) };
    }
    if (buildAt >= 0) {
      const step = messages.slice(buildAt + 1).filter((m) => m.role === "tool").length;
      if (step === 5) {
        // The desk's data (uploads made after the build, in the story) is the workbench's own
        // state.json: seeded before the first load, which is when the host first reads it.
        writeFileSync(
          path.join(wfDir(lang), "state.json"),
          JSON.stringify(deskState(lang), null, 2),
        );
        // The user opening the legal agent's page is what starts the server watching it.
        await listWorkbenches(lang);
      }
      const call = buildCall(lang, step);
      if (call) return { kind: "turn", ...s.build[step], call };
      return { kind: "turn", text: s.buildDone };
    }
  }
  return { kind: "turn", text: "OK." };
}

function sseWrite(res, chunk) {
  if (res.destroyed || res.writableEnded) return;
  res.write(chunk);
}

async function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const turn = await decideTurn(messages);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-shot",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) payload.usage = usage;
    sseWrite(res, `data: ${JSON.stringify(payload)}\n\n`);
  };
  const prompt = 2400 + messages.length * 900;
  const done = (reason) => {
    chunk({}, reason, {
      prompt_tokens: prompt,
      completion_tokens: 240,
      total_tokens: prompt + 240,
      prompt_cache_hit_tokens: prompt - 600,
      prompt_cache_miss_tokens: 600,
    });
    sseWrite(res, "data: [DONE]\n\n");
    res.end();
  };
  chunk({ role: "assistant" });
  if (turn.kind === "title") {
    chunk({ content: turn.text });
    done("stop");
    return;
  }
  if (turn.thinking) {
    for (const t of turn.thinking.match(/[\s\S]{1,24}/g) ?? []) chunk({ reasoning_content: t });
  }
  if (turn.text) for (const t of turn.text.match(/[\s\S]{1,24}/g) ?? []) chunk({ content: t });
  if (turn.call) {
    const json = JSON.stringify(turn.call.args);
    chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_shot_${Date.now()}`,
          type: "function",
          function: { name: turn.call.name, arguments: "" },
        },
      ],
    });
    for (const part of json.match(/[\s\S]{1,200}/g) ?? []) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    }
    done("tool_calls");
  } else {
    done("stop");
  }
}

function startMock() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {}
      if (!req.url?.includes("chat/completions")) {
        console.log(`[mock] unexpected path ${req.url}`);
        res.writeHead(404).end();
        return;
      }
      openaiReply(res, json).catch((err) => {
        console.error("[mock] reply error:", err);
        try {
          res.end();
        } catch {}
      });
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server + API helpers.
// ---------------------------------------------------------------------------

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(userId, password) {
  const { setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  if (!setCookie) throw new Error("no session cookie from login");
  return setCookie.split(";")[0];
}

const USERS = { en: "alex" };

/**
 * A timezone where it is working hours now: the conversation's timestamps come from the
 * server's real clock, so a fixed zone would show a 1 a.m. session half of the time.
 */
function daytimeZone() {
  const candidates = ["America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Singapore"];
  for (const timeZone of candidates) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
        new Date(),
      ),
    );
    if (hour >= 9 && hour <= 17) return timeZone;
  }
  return candidates[0];
}

/** The top `height` CSS px of an element, as a page clip (locator.screenshot takes no clip). */
async function topOf(locator, height) {
  const box = await locator.boundingBox();
  return { x: box.x, y: box.y, width: box.width, height: Math.min(height, box.height) };
}

/** Opens every "N steps" group of the conversation, so its tool calls show by name. */
async function expandSteps(page) {
  const groups = page.locator("button").filter({ hasText: /\d+ steps?/ });
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const g = groups.nth(i);
    if ((await g.getAttribute("aria-expanded")) === "true") continue;
    await g.click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

/** A per-language user with the mock model; password rotated so no banner shows. */
async function provisionUser(adminCookie, lang) {
  const userId = USERS[lang];
  const initial = `${userId}12345`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let password = initial;
  let cookie = await login(userId, initial);
  try {
    await api(cookie, "PUT", "/api/me/password", {
      oldPassword: initial,
      newPassword: `wafh-${userId}-2026`,
    });
    password = `wafh-${userId}-2026`;
  } catch {}
  cookie = await login(userId, password);
  const projects = (await api(cookie, "GET", "/api/projects")).json;
  const projectId = projects.projects[0].projectId;
  await api(cookie, "PUT", `/api/projects/${projectId}/models`, {
    defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    models: [
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        clientType: "openai-chat",
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
        pricing: { cacheRead: 0.003571, cacheWrite: 0.428571, output: 0.857143 },
      },
    ],
  });
  return { userId, password, cookie, projectId };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

mkdirSync(RUN, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
console.log(`[wf] run dir ${RUN}`);

const mock = await startMock();
const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    WAFH_HOME: HOME,
    WAFH_WEB_DB: path.join(RUN, "web.db"),
    WAFH_WEB_DIST: path.join(ROOT, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
    WAFH_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    TZ: "Asia/Shanghai",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stdout.on("data", (d) => {
  if (process.env.SHOT_DEBUG) process.stdout.write(`[srv] ${d}`);
});
srv.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
const cleanup = () => {
  try {
    srv.kill();
  } catch {}
  try {
    mock.close();
  } catch {}
};
process.on("exit", cleanup);

let lastPage = null;

try {
  await waitFor(`${BASE}/`);
  console.log(`[wf] server ready on ${BASE}`);
  const adminCookie = await login("admin", ADMIN_PASSWORD);
  // Rotate the admin's seeded password too, as a person would on first sign-in.
  await api(adminCookie, "PUT", "/api/me/password", {
    oldPassword: ADMIN_PASSWORD,
    newPassword: "wafh-admin-2026",
  }).catch(() => {});
  const admin = await login("admin", "wafh-admin-2026").catch(() => adminCookie);

  const browser = await chromium.launch({
    env: {
      ...process.env,
      FONTCONFIG_FILE: path.join(ROOT, "packages/ui-gallery/scripts/fonts.conf"),
      LANG: "en_US.UTF-8",
    },
  });

  const shot = async (target, name, opts = {}) => {
    const file = path.join(OUT_DIR, `${name}.png`);
    // A clip is page coordinates: taken off the page, whatever the target.
    const on = opts.clip && typeof target.page === "function" ? target.page() : target;
    await on.screenshot({ path: file, ...opts });
    console.log(`[wf] ${name}.png`);
  };

  for (const lang of LANGS) {
    const user = await provisionUser(admin, lang);
    CTX[lang] = user;
    const p = user.projectId;
    const scene = SCENES[lang];
    const text = PAGE_TEXT[lang];

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: daytimeZone(),
    });
    await context.addInitScript(
      ([l, projectId]) => {
        try {
          localStorage.setItem("wafh.lang", l);
          localStorage.setItem("wafh.themeId", "modern");
          localStorage.setItem("wafh.theme", "light");
          localStorage.setItem("wafh.lastProjectId", projectId);
          if (!localStorage.getItem(`wafh.lastAgentId.${projectId}`)) {
            localStorage.setItem(`wafh.lastAgentId.${projectId}`, "default_agent");
          }
        } catch {}
      },
      [lang, p],
    );
    const page = await context.newPage();
    lastPage = page;
    const res = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: user.userId, password: user.password },
    });
    if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);

    // The chat column: everything right of the sidebar.
    const main = () => page.locator("[data-dock-host]").first();
    const dismiss = async () => {
      await page.keyboard.press("Escape").catch(() => {});
    };

    // ---- 1. The example on the start page ---------------------------------------------
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const exampleLabel = "A legal agent app from one sentence";
    const example = page.getByText(exampleLabel, { exact: true }).first();
    await example.waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await dismiss();
    await example.click();
    const composer = page.locator("textarea").first();
    await page.waitForFunction(
      (m) => [...document.querySelectorAll("textarea")].some((t) => t.value.includes(m)),
      scene.buildMarker,
      { timeout: 10000 },
    );
    // The composer grew under the pointer: park it, or the row now under it shows its hover.
    await page.mouse.move(4, 890);
    await page.waitForTimeout(600);
    // The composer and the examples, below the brand line (whose version is the tree's own).
    {
      const box = await composer.boundingBox();
      await shot(page, `workflow-example-${lang}`, {
        clip: { x: box.x - 40, y: box.y - 75, width: box.width + 80, height: 650 },
      });
    }

    // ---- 2. Send: the default agent builds the legal agent and its desk ------------------
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/chat\//, { timeout: 30000 });
    await page.getByText("to use the desk").first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.setViewportSize({ width: 1440, height: 1500 });
    await expandSteps(page);
    await page.waitForTimeout(1200);
    await shot(main(), `workflow-build-${lang}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!existsSync(path.join(wfDir(lang), ".build", "status.json"))) {
      throw new Error("the workbench never loaded");
    }
    console.log(
      `[wf] status: ${readFileSync(path.join(wfDir(lang), ".build", "status.json"), "utf8")}`,
    );

    // ---- 3. The legal agent's own page: the desk beside its chat ------------------------
    // A new chat, with the legal agent picked in the draft's agent menu.
    await page.goto(`${BASE}/chat/new`, { waitUntil: "domcontentloaded" });
    const agentPill = page.getByRole("button", {
      name: "Choose agent",
      exact: true,
    });
    await agentPill.waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await dismiss();
    await agentPill.click();
    await page.getByText(scene.agentName, { exact: true }).last().click();
    const deskTab = page.getByRole("tab", { name: text.title });
    await deskTab.waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await dismiss();
    await deskTab.click();
    // The frame is titled with the tab's `title` (the manifest's English one) in every language.
    const frame = page.frameLocator('iframe[title="Contract desk"]');
    await frame.getByText(DESK_FILES[lang][4][0]).waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(main(), `workflow-page-${lang}`, { clip: await topOf(main(), 640) });

    // ---- 4. Ask for a change, in the legal agent's chat ---------------------------------
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await composer.waitFor({ timeout: 10000 });
    await composer.fill(scene.editPrompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/chat\//, { timeout: 30000 });
    await page.getByText("The previous version is under").first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(2500);
    // Tall enough for the whole exchange, short enough that the composer sits under it.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expandSteps(page);
    await page.waitForTimeout(1200);
    await shot(main(), `workflow-edit-${lang}`);
    await shot(main(), `waf-harness-0-2-14-workflow-edit-${lang}`);
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- 5. The desk after the edit -----------------------------------------------------
    await page.getByRole("tab", { name: text.title }).click();
    await frame.getByText(text.risk, { exact: true }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(main(), `workflow-page-after-${lang}`, { clip: await topOf(main(), 640) });
    await shot(main(), `waf-harness-0-2-14-workflow-${lang}`, {
      clip: await topOf(main(), 640),
    });

    // ---- 6. History: both versions, Restore on the older ---------------------------------
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page
      .getByRole("button", { name: "Restore", exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await shot(main(), `workflow-history-${lang}`, { clip: await topOf(main(), 520) });
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await shot(main(), `workflow-restore-${lang}`, { clip: await topOf(main(), 700) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // ---- 7. Fill the app ----------------------------------------------------------------
    await page.goto(`${BASE}/app/${p}/${LEGAL}/${WF}`, { waitUntil: "domcontentloaded" });
    await page
      .frameLocator('iframe[title="Contract desk"]')
      .getByText(text.risk, { exact: true })
      .waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(page, `workflow-fill-app-${lang}`, {
      clip: { x: 0, y: 0, width: 1440, height: 520 },
    });

    console.log(
      `[wf] versions: ${JSON.stringify((await listWorkbenches(lang)).workbenches?.[0]?.revision)}`,
    );
    await context.close();
  }

  await browser.close();
  console.log(`[wf] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[wf] FAILED:", err);
  try {
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: path.join(OUT_DIR, "failure.png") });
      writeFileSync(
        path.join(OUT_DIR, "failure.txt"),
        await lastPage.evaluate(() => document.body.innerText),
      );
    }
  } catch {}
  process.exit(1);
}
