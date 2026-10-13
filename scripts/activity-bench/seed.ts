/**
 * `pnpm bench seed`: prepares the bench's seed home, the Penguin home every trial starts from,
 * step by step and again without harm — each step is skipped once it is done. A throwaway
 * server runs on the seed while it is prepared; what it leaves behind is the seed.
 *
 *   1. the Project, with the built-in Activity Agent;
 *   2. its default model, with an API key typed at the terminal and sent to that loopback
 *      server only — never printed, logged, stored anywhere else, or put in argv or env;
 *   3. a WAF workspace Penguin prepares in the seed (never a checkout from elsewhere);
 *   4. the test browser;
 *   5. the bench home's bench.json, keeping what it already says (its vault);
 *   6. the bench's own preflight of the seed, which says ready or what is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { SEMANTIC_ID_PATTERN } from "../../packages/server/src/services/ids.js";
import { benchLayout } from "./isolated-server.js";
import type { Prompter } from "./prompt.js";
import { message, sleep, type Server } from "./server-boot.js";

/** Why the seed could not be prepared, in a sentence a person acts on. */
export class SeedRefusal extends Error {}

export interface SeedOptions {
  home: string;
  /** The Project's display name; its id is the name lowercased. */
  projectName: string;
  agentId: string;
  /** `provider/modelId`; asked at the terminal when absent. */
  model?: string;
  mainRef: string;
  trialEstimateUsd: number;
  /** How often the workspace and the browser install are looked at. */
  pollMs?: number;
}

export interface SeedPorts {
  /** A server on the seed, signed in as its admin; stopped by the seed once it is done. */
  server(): Promise<Server>;
  prompt: Prompter;
  /** The bench's own preflight of the seed, run once the server is stopped. */
  preflight(): Promise<{ refused: string } | { claude: true | string }>;
  log(line: string): void;
}

export interface SeedReport {
  projectId: string;
  /** The default model, as `provider/modelId`. */
  model: string;
  ready: boolean;
  /** What the preflight found missing; empty when ready. */
  missing: string[];
  /** Whether Claude Code trials can run, or why not; null when the seed is not ready. */
  claude: true | string | null;
}

interface ModelRef {
  provider: string;
  modelId: string;
}

interface ModelRow extends ModelRef {
  displayName?: string;
  contextWindow?: number;
  clientType?: string;
  vision?: boolean;
  maxTokens?: number;
  fastMode?: boolean;
  pricing?: { cacheRead: number; cacheWrite: number; output: number };
  credential?: { apiKeyMasked?: string };
  envKeyMasked?: string;
  isDefault: boolean;
}

interface WorkspaceStatus {
  managed: boolean;
  ready: boolean;
  preparing: boolean;
  lastError: string | null;
  log: string[];
  repos: { id: string; present: boolean; installed: boolean | null }[];
}

interface BrowserStatus {
  available: boolean;
  installed: boolean;
  installing: boolean;
  error: string | null;
  log: string | null;
}

const WORKSPACE_TIMEOUT_MS = 45 * 60_000;
const BROWSER_TIMEOUT_MS = 20 * 60_000;

/** The Project id a display name makes; refuses one that cannot be a Project id. */
export function projectIdOf(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  if (!SEMANTIC_ID_PATTERN.test(id))
    throw new SeedRefusal(
      `"${name}" does not make a Project id: use letters, digits and underscores, starting with a letter.`,
    );
  return id;
}

const refOf = (ref: ModelRef) => `${ref.provider}/${ref.modelId}`;

/** Whether a model holds a key: one stored in the Project, or one the server's environment gives it. */
const hasKeyOf = (row: ModelRow) => !!row.credential?.apiKeyMasked || !!row.envKeyMasked;

/** `provider/modelId`, split at the first slash: a model id may hold one of its own. */
function parseRef(text: string): ModelRef | null {
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) return null;
  return { provider: text.slice(0, slash), modelId: text.slice(slash + 1) };
}

export async function seedBench(options: SeedOptions, ports: SeedPorts): Promise<SeedReport> {
  const projectId = projectIdOf(options.projectName);
  const layout = benchLayout(options.home);
  // Read before anything is started: a bench.json that cannot be kept stops the seed here.
  const existing = readBenchConfig(options.home);
  fs.mkdirSync(layout.seed, { recursive: true });
  const server = await ports.server();
  let model: string;
  try {
    await ensureProject(server, projectId, options.projectName, ports.log);
    await ensureAgent(server, projectId, options.agentId, ports.log);
    model = await ensureDefaultModel(server, projectId, options.model, ports);
    await ensureWorkspace(server, options.pollMs ?? 2_000, ports.log);
    await ensureBrowser(server, options.pollMs ?? 2_000, ports.log);
  } finally {
    await server.stop();
  }
  writeBenchConfig(options.home, existing, {
    project: projectId,
    agent: options.agentId,
    trialEstimateUsd: options.trialEstimateUsd,
    mainRef: options.mainRef,
  });
  ports.log(`Wrote ${path.join(options.home, "bench.json")}.`);
  const checked = await ports.preflight();
  if ("refused" in checked) {
    ports.log(`The seed is not ready: ${checked.refused}`);
    return { projectId, model, ready: false, missing: [checked.refused], claude: null };
  }
  ports.log(
    checked.claude === true
      ? "The seed is ready; Claude Code trials can run."
      : `The seed is ready. Claude Code trials cannot run yet: ${checked.claude}`,
  );
  return { projectId, model, ready: true, missing: [], claude: checked.claude };
}

async function ensureProject(
  server: Server,
  projectId: string,
  name: string,
  log: (line: string) => void,
): Promise<void> {
  const { projects } = await server.call<{ projects: { projectId: string }[] }>(
    "GET",
    "/api/projects",
  );
  if (projects.some((project) => project.projectId === projectId)) {
    log(`Project ${projectId} is already there.`);
    return;
  }
  await server.call("POST", "/api/projects", { projectId, name: name.trim() });
  log(`Project ${projectId} created.`);
}

/** Listing a Project's agents provisions the built-in ones it lacks. */
async function ensureAgent(
  server: Server,
  projectId: string,
  agentId: string,
  log: (line: string) => void,
): Promise<void> {
  const { agents } = await server.call<{ agents: { agentId: string }[] }>(
    "GET",
    `/api/projects/${projectId}/agents`,
  );
  if (!agents.some((agent) => agent.agentId === agentId))
    throw new SeedRefusal(
      `Project ${projectId} has no agent ${agentId}, and the server's built-in agents do not include it.`,
    );
  log(`Agent ${agentId} is in Project ${projectId}.`);
}

/**
 * The default model, with a key: the one named, else the one the person picks from what the
 * Project offers. A model that already holds a key keeps it; otherwise the key is typed at the
 * terminal and goes to the server as part of the Project's model table, and nowhere else.
 */
async function ensureDefaultModel(
  server: Server,
  projectId: string,
  named: string | undefined,
  ports: SeedPorts,
): Promise<string> {
  const route = `/api/projects/${projectId}/models`;
  const table = await server.call<{ models: ModelRow[]; defaultModel?: ModelRef }>("GET", route);
  if (!table.models.length)
    throw new SeedRefusal(`Project ${projectId} offers no models to choose a default from.`);
  // With no model named, a default that already holds its key is the one: nothing to ask.
  const settled = table.models.find((row) => row.isDefault && hasKeyOf(row));
  const chosen = named
    ? pickNamed(table.models, named)
    : (settled ?? (await pickAtTerminal(table.models, ports)));
  const ref = refOf(chosen);
  const hasKey = hasKeyOf(chosen);
  if (hasKey && chosen.isDefault) {
    ports.log(`Default model ${ref} is set and has its key.`);
    return ref;
  }
  if (hasKey) {
    await server.call("PUT", `${route}/default`, {
      provider: chosen.provider,
      modelId: chosen.modelId,
    });
    ports.log(`Default model set to ${ref}; it already has its key.`);
    return ref;
  }
  const apiKey = (await ports.prompt.hidden(`API key for ${ref} (typed hidden): `)).trim();
  if (!apiKey) throw new SeedRefusal("No API key was typed; the default model needs one.");
  try {
    await server.call("PUT", route, {
      defaultModel: { provider: chosen.provider, modelId: chosen.modelId },
      models: table.models.map((row) => ({
        ...entryOf(row),
        ...(row.provider === chosen.provider && row.modelId === chosen.modelId ? { apiKey } : {}),
      })),
    });
  } catch (error) {
    // Whatever the server answered, the key is not repeated.
    throw new SeedRefusal(`The default model could not be set: ${redact(message(error), apiKey)}`);
  }
  ports.log(`Default model set to ${ref}; its key is stored in the seed's Project only.`);
  return ref;
}

/** The row as the whole-table update takes it back: every field as the server reports it. */
function entryOf(row: ModelRow): Record<string, unknown> {
  const entry: Record<string, unknown> = { provider: row.provider, modelId: row.modelId };
  for (const field of [
    "displayName",
    "contextWindow",
    "clientType",
    "vision",
    "maxTokens",
    "fastMode",
    "pricing",
  ] as const)
    if (row[field] !== undefined) entry[field] = row[field];
  return entry;
}

function pickNamed(models: ModelRow[], named: string): ModelRow {
  const ref = parseRef(named);
  const found =
    ref && models.find((row) => row.provider === ref.provider && row.modelId === ref.modelId);
  if (!found)
    throw new SeedRefusal(
      `${named} is not a model this Project offers: --model takes provider/modelId, one of ${models
        .slice(0, 8)
        .map(refOf)
        .join(", ")}${models.length > 8 ? ", …" : ""}.`,
    );
  return found;
}

async function pickAtTerminal(models: ModelRow[], ports: SeedPorts): Promise<ModelRow> {
  ports.log("The Project offers these models:");
  models.forEach((row, i) => {
    const marks = [row.isDefault ? "default" : "", hasKeyOf(row) ? "has a key" : ""].filter(
      Boolean,
    );
    ports.log(
      `  ${i + 1}. ${refOf(row)}${row.displayName ? ` — ${row.displayName}` : ""}${marks.length ? ` (${marks.join(", ")})` : ""}`,
    );
  });
  const answer = await ports.prompt.ask("Default model (a number or provider/modelId): ");
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) return models[index - 1]!;
  return pickNamed(models, answer);
}

/** The WAF workspace Penguin prepares in the seed; a checkout named from elsewhere is refused. */
async function ensureWorkspace(
  server: Server,
  pollMs: number,
  log: (line: string) => void,
): Promise<void> {
  const route = "/api/admin/waf-workspace";
  const read = () => server.call<{ status: WorkspaceStatus }>("GET", route);
  let { status } = await read();
  if (!status.managed)
    throw new SeedRefusal(
      "The seed names a WAF checkout outside it (WAF_ROOT_DIR, or the workspace's externalRoot): every trial copies the seed, so clear it and let Penguin prepare a workspace in the seed.",
    );
  if (status.ready && !status.preparing) {
    log("The WAF workspace is prepared.");
    return;
  }
  // A preparation already under way (the server's own, say) is waited for, not started again.
  if (status.preparing) log("The WAF workspace is being prepared; waiting for it…");
  else {
    log("Preparing the WAF workspace: cloning the framework, navbar, media and activity data…");
    ({ status } = await server.call<{ status: WorkspaceStatus }>("POST", `${route}/prepare`));
  }
  const deadline = Date.now() + WORKSPACE_TIMEOUT_MS;
  while (status.preparing) {
    if (Date.now() > deadline)
      throw new SeedRefusal("The WAF workspace took too long to prepare; look at its log.");
    await sleep(pollMs);
    ({ status } = await read());
  }
  if (status.lastError)
    throw new SeedRefusal(
      `The WAF workspace could not be prepared, so git could not reach or clone a repository: ${status.lastError}${status.log.length ? `\n${status.log.slice(-5).join("\n")}` : ""}\nCheck git, SSH keys and the remotes under /api/admin/waf-workspace/settings, then run the seed again.`,
    );
  if (!status.ready)
    throw new SeedRefusal(
      `The WAF workspace is still not ready: ${status.repos
        .filter((repo) => !repo.present || repo.installed === false)
        .map((repo) => repo.id)
        .join(", ")}.`,
    );
  log("The WAF workspace is prepared.");
}

/** The test browser, installed where the seed keeps it. */
async function ensureBrowser(
  server: Server,
  pollMs: number,
  log: (line: string) => void,
): Promise<void> {
  const route = "/api/admin/test-browser";
  const read = () => server.call<{ browser: BrowserStatus }>("GET", route);
  let { browser } = await read();
  if (!browser.available)
    throw new SeedRefusal(
      "This copy of Penguin cannot install the test browser: run the seed from a checkout that ships Playwright.",
    );
  if (browser.installed && !browser.installing) {
    log("The test browser is installed.");
    return;
  }
  log("Installing the test browser…");
  ({ browser } = await server.call<{ browser: BrowserStatus }>("POST", `${route}/install`));
  const deadline = Date.now() + BROWSER_TIMEOUT_MS;
  while (browser.installing) {
    if (Date.now() > deadline) throw new SeedRefusal("The test browser took too long to install.");
    await sleep(pollMs);
    ({ browser } = await read());
  }
  if (browser.error || !browser.installed)
    throw new SeedRefusal(
      `The test browser did not install (${browser.error ?? "not found afterwards"}).${browser.log ? `\n${browser.log.slice(-1500)}` : ""}`,
    );
  log("The test browser is installed.");
}

/** bench.json with these fields set; whatever else it says (its vault) is kept. */
function writeBenchConfig(
  home: string,
  existing: Record<string, unknown>,
  fields: Record<string, unknown>,
): void {
  const file = path.join(home, "bench.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...existing, ...fields }, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * What the bench home's bench.json says now, however little: nothing when there is none. One
 * that is there and is not a JSON object is refused rather than replaced.
 */
export function readBenchConfig(home: string): Record<string, unknown> {
  const file = path.join(home, "bench.json");
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new SeedRefusal(`${file} is not JSON (${message(error)}): fix or remove it first.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new SeedRefusal(`${file} must hold a JSON object: fix or remove it first.`);
  return parsed as Record<string, unknown>;
}

/** `text` with every appearance of `secret` — as typed, and as JSON writes it — replaced. */
export function redact(text: string, secret: string): string {
  let out = text;
  for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)]))
    if (form) out = out.split(form).join("<the key>");
  return out;
}
