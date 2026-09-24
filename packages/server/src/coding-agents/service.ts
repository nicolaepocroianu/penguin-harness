/**
 * The coding-agents runtime service: bridges the ACP kernel (packages/coding-agents) into
 * the server's world. Owns three seams:
 * - definitions: persisted as one JSON setting (`coding_agent_servers`), handed to the
 *   kernel manager, which stays storage-free;
 * - child environments: the kernel spawns whatever a definition names, so the env it gets
 *   is an allow-list of this process's environment plus the definition's own vars — never
 *   a wholesale `process.env`;
 * - events: every session gets a Channel (`coding-agent:<id>`); kernel events publish
 *   there as `coding_agent` SSE events, so replay/resync come for free from the hub.
 *
 * Two ways in. A Penguin Session whose model is a coding agent (chats, activity stages) goes
 * through `openSessionRuntime`/`loadSessionRuntime`: an AcpRuntimeSession the session manager
 * drives, with a Trace, approvals, usage and reopening like any Session. The bare
 * `/api/coding-agents/sessions` routes still open agent sessions directly — kept for API
 * clients, in memory for the App's lifetime, with no Trace; no screen uses them.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import {
  VERSION,
  Writer,
  agentStateDir,
  findLatestTraceFile,
  readTraceTolerant,
  tracesDir,
  workspacesDir,
} from "@prismshadow/penguin-core";
import {
  CodingAgentManager,
  discoverAgents as discoverKnownAgents,
  parseDefinition,
  probeAgentOptions,
  sandboxedAgentEnv,
  validateAgentEnvEntry,
  type AgentDiscoveryCandidate,
  type AgentPermissionOutcome,
  type AgentResumeSupport,
  type AgentServerDefinition,
  type AgentSessionOptions,
  type AgentSessionEvent,
} from "@prismshadow/penguin-coding-agents";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryCandidate,
  CodingAgentDiscoveryResponse,
  CodingAgentEnvEntryInfo,
  CodingAgentServerInfo,
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
  CodingAgentTestResult,
} from "../api/types.js";
import { Channels, Config, type ChannelApi } from "../hmr/capabilities.js";
import { Settings } from "../mechanisms/settings.js";
import { CodingAgents } from "../mechanisms/coding-agents.js";
import { AcpAgentError } from "@prismshadow/penguin-coding-agents";
import { maskApiKey } from "../services/project-config-service.js";
import { renderTranscriptMarkdown, transcriptFilename } from "./transcript.js";
import type { RuntimeSession } from "../runtime/session-manager.js";
import {
  AcpRuntimeSession,
  CODING_AGENT_PROVIDER,
  parseCodingAgentModel,
  usageSoFar,
} from "./session-runtime.js";

/** The settings key holding the custom definitions as a JSON array. */
const DEFINITIONS_KEY = "coding_agent_servers";

/** The settings key holding the model remembered per agent id: { configId, value, name? }. */
const MODELS_KEY = "coding_agent_models";

/** The settings key holding other remembered session settings: { [agentId]: { [configId]: value } }. */
const OPTIONS_KEY = "coding_agent_options";

/** How long a probed discovery answer is reused before the next read re-runs the fs pass. */
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;

/** Agent credential/state homes live under the data root, keyed by definition id. */
function agentHome(root: string, agentId: string): string {
  return path.join(root, "coding-agents", agentId);
}

/**
 * Where a Penguin Session records which of the agent's own sessions it is: one small file
 * per Session in the agent's home, read back when the Session is reopened after a restart.
 */
function sessionLinkPath(root: string, codingAgentId: string, sessionId: string): string {
  return path.join(agentHome(root, codingAgentId), "sessions", `${sessionId}.json`);
}

/** A Session id in the shape every Penguin Session has (core's formatSessionId). */
function newSessionId(date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `session-${day}-${time}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * npx package names earlier recipes suggested that no longer install a working adapter: the
 * unscoped `claude-agent-acp` never existed on npm, and Codex's adapter moved scope. A
 * definition saved from one of those suggestions would otherwise fail every start.
 */
const RENAMED_ADAPTER_PACKAGES: Record<string, string> = {
  "claude-agent-acp": "@agentclientprotocol/claude-agent-acp",
  "@zed-industries/codex-acp": "@agentclientprotocol/codex-acp",
};

/** A saved npx launch of a renamed adapter package, pointed at the package's current name. */
export function upgradeAdapterPackage(definition: AgentServerDefinition): AgentServerDefinition {
  const file = definition.command.split(/[\\/]/u).pop() ?? "";
  if (file.toLowerCase().replace(/\.(cmd|exe|bat)$/u, "") !== "npx") return definition;
  const renamed = (arg: string) =>
    Object.hasOwn(RENAMED_ADAPTER_PACKAGES, arg) ? RENAMED_ADAPTER_PACKAGES[arg]! : arg;
  const args = definition.args ?? [];
  if (args.every((arg) => renamed(arg) === arg)) return definition;
  return { ...definition, args: args.map(renamed) };
}

/** An agent's variables as the API shows them: names in order, values masked. */
function maskedEnv(env: Record<string, string> | undefined): CodingAgentEnvEntryInfo[] {
  return Object.entries(env ?? {}).map(([key, value]) => ({ key, valueMasked: maskApiKey(value) }));
}

/** What a connection test asks: an answer anyone can check, which costs next to nothing. */
const SMOKE_PROMPT = "Reply with only the word: ok";

/** A reply counts as ok regardless of case and closing punctuation ("OK.", "ok!"). */
function isOk(reply: string): boolean {
  return (
    reply
      .trim()
      .toLowerCase()
      .replace(/[.!\s]+$/u, "") === "ok"
  );
}

/** Resolves with `work`'s value, or with `onTimeout` once `ms` has passed, whichever is first. */
function within<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout), Math.max(0, ms));
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const REOPEN_FRESH_NOTICE =
  "The coding agent could not reopen its earlier conversation, so this Session continues in a fresh agent session. Everything above is still in this Session's Trace.";

@Component()
export class CodingAgentService implements CodingAgents {
  @Use() private readonly channels!: Channels;
  @Use() private readonly config!: Config;
  @Use() private readonly settings!: Settings;

  private manager: CodingAgentManager | null = null;
  private readonly unbridges = new Map<string, () => void>();
  private discoveryCache: {
    at: number;
    candidates: AgentDiscoveryCandidate[];
    agentModels: Record<string, CodingAgentConfigOption[]>;
  } | null = null;
  /** User-set display names, keyed by session id; in-memory like the sessions themselves. */
  private readonly titles = new Map<string, string>();

  private getManager(): CodingAgentManager {
    if (this.manager === null) {
      this.manager = new CodingAgentManager({
        clientInfo: { name: "penguin", version: VERSION },
        envFor: (definition) => this.envFor(definition),
      });
      this.manager.setDefinitions(this.loadDefinitions());
    }
    return this.manager;
  }

  listAgents(opts: { withEnv?: boolean } = {}): CodingAgentServerInfo[] {
    const models = this.loadRememberedModels();
    const options = this.loadRememberedOptions();
    const manager = this.getManager();
    return manager.listDefinitions().map((d) => ({
      ...this.infoOf(d),
      ...(models[d.id] !== undefined ? { rememberedModel: models[d.id] } : {}),
      ...(options[d.id] !== undefined ? { rememberedOptions: options[d.id] } : {}),
      ...(opts.withEnv === true
        ? { env: maskedEnv(d.env), envPending: manager.startedWithOtherEnv(d.id) }
        : {}),
    }));
  }

  async discoverAgents(
    refresh = false,
    probeTimeoutMs?: number,
  ): Promise<CodingAgentDiscoveryResponse> {
    const cached = this.discoveryCache;
    if (!refresh && cached !== null && Date.now() - cached.at < DISCOVERY_CACHE_TTL_MS) {
      return { candidates: this.annotate(cached.candidates), agentModels: cached.agentModels };
    }
    const candidates = await discoverKnownAgents({
      env: process.env,
      home: os.homedir(),
      // Live probes (versions, auth) only on refresh: they execute the found CLIs.
      probe: refresh,
    });
    let agentModels: Record<string, CodingAgentConfigOption[]> = {};
    if (refresh) {
      // The card's Model dropdown needs each runnable agent's advertised options: one
      // throwaway session per agent, best-effort. A saved definition is authoritative
      // for its id and is probed at its own command — its sessions run that command,
      // not the recipe's suggestion. A recipe launch is probed only for a detected
      // candidate with nothing saved over it: probing an npx fallback otherwise
      // installs-and-runs an adapter for an agent that is not even installed.
      const definitions = this.loadDefinitions();
      const saved = new Set(definitions.map((d) => d.id));
      await Promise.all([
        ...definitions.map(async (definition) => {
          const models = await this.probeOptions(definition, probeTimeoutMs);
          if (models.length > 0) agentModels[definition.id] = models;
        }),
        ...candidates.map(async (candidate) => {
          if (saved.has(candidate.recipeId)) return;
          if (!candidate.detected || candidate.launch === null) return;
          const models = await this.probeOptions(
            {
              id: candidate.recipeId,
              command: candidate.launch.command,
              args: candidate.launch.args,
            },
            probeTimeoutMs,
          );
          if (models.length > 0) candidate.models = models;
        }),
      ]);
      this.discoveryCache = { at: Date.now(), candidates, agentModels };
    }
    return { candidates: this.annotate(candidates), agentModels };
  }

  saveAgent(input: unknown): CodingAgentServerInfo {
    const parsed: AgentServerDefinition = parseDefinition(input);
    const existing = this.loadDefinitions().find((d) => d.id === parsed.id);
    if (existing?.builtin !== undefined || parsed.builtin !== undefined) {
      throw new AcpAgentError(`${parsed.id} is managed on Models → Built-in.`);
    }
    // A save that names no variables keeps the stored ones: the form never has their values.
    const sentEnv =
      input !== null && typeof input === "object" && Object.hasOwn(input as object, "env");
    for (const [key, value] of Object.entries(parsed.env ?? {})) {
      const problem = validateAgentEnvEntry(key, value);
      if (problem !== null) throw new AcpAgentError(problem);
    }
    const definition = sentEnv ? parsed : { ...parsed, env: existing?.env ?? {} };
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== definition.id),
      definition,
    ]);
    return this.infoOf(definition);
  }

  removeAgent(agentId: string): boolean {
    const definitions = this.loadDefinitions();
    const target = definitions.find((d) => d.id === agentId);
    if (target?.builtin !== undefined) {
      throw new AcpAgentError(`${agentId} is managed on Models → Built-in.`);
    }
    const remaining = definitions.filter((d) => d.id !== agentId);
    if (remaining.length === definitions.length) return false;
    this.persistDefinitions(remaining);
    return true;
  }

  async setAgentEnv(
    agentId: string,
    entries: { key: string; value?: string }[],
  ): Promise<CodingAgentServerInfo> {
    await this.ensureDefinition(agentId);
    const definition = this.loadDefinitions().find((d) => d.id === agentId);
    if (definition === undefined) throw new AcpAgentError(`unknown agent: ${agentId}`);
    if (definition.builtin !== undefined) {
      throw new AcpAgentError(`${agentId} is managed on Models → Built-in.`);
    }
    const stored = definition.env ?? {};
    const next: Record<string, string> = {};
    for (const entry of entries) {
      const problem = validateAgentEnvEntry(entry.key, entry.value);
      if (problem !== null) throw new AcpAgentError(problem);
      if (Object.hasOwn(next, entry.key)) throw new AcpAgentError(`${entry.key} is listed twice.`);
      const value = entry.value ?? stored[entry.key];
      if (value === undefined) throw new AcpAgentError(`${entry.key} has no stored value to keep.`);
      next[entry.key] = value;
    }
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== agentId),
      { ...definition, env: next },
    ]);
    return this.listAgents({ withEnv: true }).find((a) => a.id === agentId)!;
  }

  saveBuiltinDefinition(definition: AgentServerDefinition): void {
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== definition.id),
      definition,
    ]);
  }

  listDefinitionsForBuiltin(): AgentServerDefinition[] {
    return this.loadDefinitions().filter((d) => d.builtin !== undefined);
  }

  removeBuiltinDefinition(agentId: string): boolean {
    const definitions = this.loadDefinitions();
    const remaining = definitions.filter((d) => !(d.id === agentId && d.builtin !== undefined));
    if (remaining.length === definitions.length) return false;
    this.persistDefinitions(remaining);
    return true;
  }

  setAgentModel(
    agentId: string,
    model: { configId: string; value: boolean | string; name?: string },
  ): void {
    const models = this.loadRememberedModels();
    models[agentId] = {
      configId: model.configId,
      value: model.value,
      ...(model.name !== undefined ? { name: model.name } : {}),
    };
    this.settings.set(MODELS_KEY, JSON.stringify(models));
  }

  setAgentOption(agentId: string, option: { configId: string; value: boolean | string }): void {
    const all = this.loadRememberedOptions();
    all[agentId] = { ...all[agentId], [option.configId]: option.value };
    this.settings.set(OPTIONS_KEY, JSON.stringify(all));
  }

  async testAgent(agentId: string, timeoutMs = 60_000): Promise<CodingAgentTestResult> {
    const started = Date.now();
    const deadline = started + timeoutMs;
    const left = () => deadline - Date.now();
    const result = (fields: Omit<CodingAgentTestResult, "ms">): CodingAgentTestResult => ({
      ...fields,
      ms: Date.now() - started,
    });
    const manager = this.getManager();
    let dir: string | null = null;
    let sessionId: string | null = null;
    try {
      await this.ensureDefinition(agentId);
      const home = agentHome(this.config.root, agentId);
      await fs.mkdir(home, { recursive: true, mode: 0o700 });
      dir = await this.createTempWorkspace(home);
      const workspace = dir;
      let opened: { sessionId: string } | "timeout";
      try {
        opened = await within<{ sessionId: string } | "timeout">(
          manager.createSession(agentId, workspace),
          left(),
          "timeout",
        );
      } catch (error) {
        return result({
          ok: false,
          reply: "",
          failure: "start",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (opened === "timeout") return result({ ok: false, reply: "", failure: "timeout" });
      sessionId = opened.sessionId;
      const session = sessionId;
      await this.applyRememberedModel(manager, agentId, session);
      let reply = "";
      let stop: string | null = null;
      const unsubscribe = manager.subscribe(session, (event: AgentSessionEvent) => {
        if (event.type === "message_chunk") reply += event.delta;
        if (event.type === "turn_end") stop = event.stopReason;
        // Nobody is there to answer: a test must not wait on a person, nor let the agent act.
        if (event.type === "permission_request") {
          manager.respondPermission(event.request.requestId, { outcome: "cancelled" });
        }
      });
      try {
        const turn = await within(
          manager.prompt(session, SMOKE_PROMPT).then(() => "done" as const),
          left(),
          "timeout" as const,
        ).catch(() => "done" as const);
        if (turn === "timeout") {
          void manager.cancel(session).catch(() => undefined);
          return result({ ok: false, reply: reply.trim(), failure: "timeout" });
        }
      } finally {
        unsubscribe();
      }
      if (stop !== "end_turn") {
        return result({
          ok: false,
          reply: reply.trim(),
          failure: "failed",
          message: `The agent ended its turn: ${stop ?? "failed"}.`,
        });
      }
      return isOk(reply)
        ? result({ ok: true, reply: reply.trim() })
        : result({ ok: false, reply: reply.trim(), failure: "reply" });
    } finally {
      // A hung agent must not hang the answer: closing gets a moment, then the result goes.
      if (sessionId !== null) {
        await within(manager.disposeSession(sessionId), 3_000, undefined).catch(() => undefined);
      }
      if (dir !== null) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  listSessions(): CodingAgentSessionInfo[] {
    return this.getManager()
      .listSessions()
      .map((s) => this.toInfo(s));
  }

  async createSession(
    agentId: string,
    workspaceDir: string,
    options: AgentSessionOptions = {},
  ): Promise<CodingAgentSessionInfo> {
    const manager = this.getManager();
    await this.ensureDefinition(agentId);
    const home = agentHome(this.config.root, agentId);
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    // No explicit folder: the session gets its own temporary workspace, the same
    // auto-create contract core Sessions have (the Web App's pickers treat empty as
    // exactly this).
    const auto = workspaceDir.trim() === "";
    const dir = auto ? await this.createTempWorkspace(home) : workspaceDir.trim();
    try {
      const view = await manager.createSession(agentId, dir, options);
      this.bridge(view.sessionId);
      await this.applyRememberedModel(manager, agentId, view.sessionId);
      return this.toInfo(view);
    } catch (error) {
      // A failed start (agent won't spawn, handshake refused) must not litter the
      // agent home with the workspace it would have used.
      if (auto) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async resumeSession(
    agentId: string,
    workspaceDir: string,
    sessionId: string,
  ): Promise<CodingAgentSessionInfo> {
    const manager = this.getManager();
    await this.ensureDefinition(agentId);
    await fs.mkdir(agentHome(this.config.root, agentId), { recursive: true, mode: 0o700 });
    const alreadyOpen = manager.sessionView(sessionId) !== undefined;
    const view = await manager.resumeSession(agentId, workspaceDir.trim(), sessionId);
    // A reopened session keeps whatever model it had; the remembered one is for new ones.
    if (!alreadyOpen) this.bridge(view.sessionId);
    return this.toInfo(view);
  }

  /** Publish a session's kernel events to its channel; replay/resync belong to the hub. */
  private bridge(sessionId: string): void {
    const channel = this.channels.get(`coding-agent:${sessionId}`);
    const unbridge = this.getManager().subscribe(sessionId, (event: AgentSessionEvent) => {
      channel.publish(event, "coding_agent");
    });
    this.unbridges.set(sessionId, unbridge);
  }

  /**
   * The definition a session start needs, auto-saving a detected-but-unsaved known agent
   * on first use.
   */
  private async ensureDefinition(agentId: string): Promise<void> {
    const manager = this.getManager();
    let definition = manager.listDefinitions().find((d) => d.id === agentId);
    if (definition === undefined) {
      // A detected-but-unsaved known agent is usable directly: the definition is
      // derived entirely from the built-in recipe plus the machine's own probe results
      // (no user-supplied fields), so this adds no authority the discover endpoint
      // did not already expose.
      const derived = await this.definitionForKnownAgent(agentId);
      if (derived === undefined) {
        throw new AcpAgentError(`unknown agent: ${agentId}`);
      }
      // Filter by id first (saveAgent does the same): interleaved starts of the same
      // detected-but-unsaved agent must not append the definition twice.
      this.persistDefinitions([
        ...this.loadDefinitions().filter((d) => d.id !== derived.id),
        derived,
      ]);
      definition = derived;
    }
  }

  sessionDetail(sessionId: string): CodingAgentSessionDetailResponse | undefined {
    const view = this.getManager().sessionView(sessionId);
    if (view === undefined) return undefined;
    return { ...this.toInfo(view), configOptions: view.configOptions, events: view.events };
  }

  renameSession(sessionId: string, title: string): CodingAgentSessionInfo {
    const view = this.getManager().sessionView(sessionId);
    if (view === undefined) {
      throw new AcpAgentError(`unknown session: ${sessionId}`);
    }
    if (title === "") this.titles.delete(sessionId);
    else this.titles.set(sessionId, title);
    return this.toInfo(view);
  }

  sessionTranscript(sessionId: string): { markdown: string; filename: string } | undefined {
    const detail = this.sessionDetail(sessionId);
    if (detail === undefined) return undefined;
    const agentTitle = this.getManager()
      .listDefinitions()
      .find((d) => d.id === detail.agentId)?.title;
    const sessionTitle = this.titles.get(sessionId);
    return {
      markdown: renderTranscriptMarkdown({
        detail,
        ...(sessionTitle !== undefined ? { sessionTitle } : {}),
        ...(agentTitle !== undefined ? { agentTitle } : {}),
      }),
      filename: transcriptFilename(sessionId),
    };
  }

  channelFor(sessionId: string): ChannelApi | undefined {
    if (this.getManager().sessionView(sessionId) === undefined) return undefined;
    return this.channels.get(`coding-agent:${sessionId}`);
  }

  prompt(sessionId: string, text: string): void {
    // Fire-and-forget by design: the turn streams over the session channel; the POST
    // answers 202 immediately (the session-tasks pattern). Turn failures land in the
    // log as turn_end failed.
    void this.getManager()
      .prompt(sessionId, text)
      .catch(() => undefined);
  }

  async cancel(sessionId: string): Promise<void> {
    await this.getManager().cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.getManager().setMode(sessionId, modeId);
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: boolean | string,
  ): Promise<void> {
    await this.getManager().setConfigOption(sessionId, configId, value);
    // What the user picked for the option the card would render as the Model becomes
    // the agent's remembered model — any other session setting must not clobber it.
    // The option is computed exactly as the card computes its Model dropdown.
    const view = this.getManager().sessionView(sessionId);
    if (view === undefined) return;
    const modelOption =
      view.configOptions.find((o) => o.category === "model" && o.type === "select") ??
      view.configOptions.find((o) => o.type === "select");
    if (modelOption === undefined || modelOption.id !== configId) return;
    this.setAgentModel(view.definitionId, { configId, value, name: modelOption.name });
  }

  /** Right after session/new: the agent's remembered model, best-effort. */
  private async applyRememberedModel(
    manager: CodingAgentManager,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const remembered = this.loadRememberedModels()[agentId];
    if (remembered !== undefined) {
      await manager
        .setConfigOption(sessionId, remembered.configId, remembered.value)
        .catch(() => undefined);
    }
    // After the model: an effort a model does not offer is refused, and dropped here.
    for (const [configId, value] of Object.entries(this.loadRememberedOptions()[agentId] ?? {})) {
      await manager.setConfigOption(sessionId, configId, value).catch(() => undefined);
    }
  }

  private loadRememberedOptions(): Record<string, Record<string, boolean | string>> {
    const raw = this.settings.get(OPTIONS_KEY);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, Record<string, boolean | string>>;
    } catch {
      return {};
    }
  }

  respondPermission(requestId: string, outcome: AgentPermissionOutcome): boolean {
    return this.getManager().respondPermission(requestId, outcome);
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.unbridges.get(sessionId)?.();
    this.unbridges.delete(sessionId);
    this.titles.delete(sessionId);
    await this.getManager().disposeSession(sessionId);
  }

  async openSessionRuntime(args: {
    projectId: string;
    agentId: string;
    modelId: string;
    workspace?: string;
    protectedRoots?: { root: string; label: string }[];
  }): Promise<{ sessionId: string; workspace: string; runtime: RuntimeSession }> {
    const { agentId: codingAgentId, model } = parseCodingAgentModel(args.modelId);
    const workspace =
      args.workspace?.trim() || (await this.penguinTempWorkspace(args.projectId, args.agentId));
    const view = await this.createSession(
      codingAgentId,
      workspace,
      args.protectedRoots?.length ? { protectedRoots: args.protectedRoots } : {},
    );
    try {
      // A model picked in the dropdown is the one this Session asked for: a refusal is an
      // error, not a silent fall back to whatever the agent would otherwise use.
      if (model !== null) {
        await this.getManager().setConfigOption(view.sessionId, model.configId, model.value);
      }
      const sessionId = newSessionId();
      await this.writeSessionLink(codingAgentId, sessionId, view.sessionId);
      const runtime = this.runtimeFor({
        sessionId,
        acpSessionId: view.sessionId,
        projectId: args.projectId,
        agentId: args.agentId,
        modelId: args.modelId,
        workspace,
        located: null,
      });
      return { sessionId, workspace, runtime };
    } catch (error) {
      await this.disposeSession(view.sessionId).catch(() => undefined);
      throw error;
    }
  }

  async loadSessionRuntime(row: {
    sessionId: string;
    projectId: string;
    agentId: string;
    provider: string;
    modelId: string;
    workspace: string;
  }): Promise<RuntimeSession> {
    const { agentId: codingAgentId, model } = parseCodingAgentModel(row.modelId);
    const linked = await this.readSessionLink(codingAgentId, row.sessionId);
    let acpSessionId: string;
    let notice: string | undefined;
    try {
      if (linked === null) throw new AcpAgentError("no agent session is recorded for this Session");
      acpSessionId = (await this.resumeSession(codingAgentId, row.workspace, linked)).sessionId;
    } catch {
      // Not every agent can reopen a session, and one that can may have lost it. The
      // Session goes on in a fresh agent session rather than refusing to open, and says so.
      const view = await this.createSession(codingAgentId, row.workspace);
      if (model !== null) {
        await this.getManager()
          .setConfigOption(view.sessionId, model.configId, model.value)
          .catch(() => undefined);
      }
      acpSessionId = view.sessionId;
      notice = REOPEN_FRESH_NOTICE;
      await this.writeSessionLink(codingAgentId, row.sessionId, acpSessionId);
    }
    const located = await findLatestTraceFile(
      tracesDir(this.config.root, row.projectId, row.agentId),
      row.sessionId,
    );
    const trace = located === null ? [] : await readTraceTolerant(located.path);
    return this.runtimeFor({
      sessionId: row.sessionId,
      acpSessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      modelId: row.modelId,
      workspace: row.workspace,
      located,
      ...(notice !== undefined ? { notice } : {}),
      usageStart: usageSoFar(trace, notice === undefined),
    });
  }

  // --- internals ---------------------------------------------------------------------------

  private runtimeFor(args: {
    sessionId: string;
    acpSessionId: string;
    projectId: string;
    agentId: string;
    modelId: string;
    workspace: string;
    located: { dateDir: string; index: number } | null;
    notice?: string;
    usageStart?: ReturnType<typeof usageSoFar>;
  }): AcpRuntimeSession {
    const dir = tracesDir(this.config.root, args.projectId, args.agentId);
    return new AcpRuntimeSession({
      manager: this.getManager(),
      sessionId: args.sessionId,
      acpSessionId: args.acpSessionId,
      provider: CODING_AGENT_PROVIDER,
      modelId: args.modelId,
      workspace: args.workspace,
      agentState: agentStateDir(this.config.root, args.projectId, args.agentId),
      writer:
        args.located === null
          ? new Writer({ tracesDir: dir, sessionId: args.sessionId })
          : new Writer({
              tracesDir: dir,
              sessionId: args.sessionId,
              dateDir: args.located.dateDir,
              startIndex: args.located.index,
            }),
      metaWritten: args.located !== null,
      ...(args.notice !== undefined ? { notice: args.notice } : {}),
      ...(args.usageStart !== undefined ? { usageStart: args.usageStart } : {}),
    });
  }

  /** A temporary workspace laid out exactly like core's, under the owning Penguin Agent. */
  private async penguinTempWorkspace(projectId: string, agentId: string): Promise<string> {
    const base = workspacesDir(this.config.root, projectId, agentId);
    await fs.mkdir(base, { recursive: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      const dir = path.join(base, `tmp-${randomUUID().slice(0, 8)}`);
      try {
        await fs.mkdir(dir);
        return dir;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new AcpAgentError("could not allocate a unique temporary workspace directory");
  }

  private async writeSessionLink(
    codingAgentId: string,
    sessionId: string,
    acpSessionId: string,
  ): Promise<void> {
    const file = sessionLinkPath(this.config.root, codingAgentId, sessionId);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify({ acpSessionId }), { mode: 0o600 });
  }

  private async readSessionLink(codingAgentId: string, sessionId: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(
        sessionLinkPath(this.config.root, codingAgentId, sessionId),
        "utf8",
      );
      const parsed = JSON.parse(raw) as { acpSessionId?: unknown };
      return typeof parsed.acpSessionId === "string" ? parsed.acpSessionId : null;
    } catch {
      return null;
    }
  }

  /**
   * One throwaway probe session at the definition's own command; empty when the agent
   * will not answer — a failed probe is not a broken agent, its session will surface
   * what went wrong.
   */
  private async probeOptions(
    definition: AgentServerDefinition,
    probeTimeoutMs: number | undefined,
  ): Promise<CodingAgentConfigOption[]> {
    try {
      return await probeAgentOptions({
        command: definition.command,
        args: definition.args ?? [],
        env: this.envFor(definition),
        clientInfo: { name: "penguin", version: VERSION },
        ...(probeTimeoutMs !== undefined ? { timeoutMs: probeTimeoutMs } : {}),
      });
    } catch {
      return [];
    }
  }

  /** Merge the per-request facts (saved state, remembered model) into a discovery answer. */
  private annotate(candidates: AgentDiscoveryCandidate[]): CodingAgentDiscoveryCandidate[] {
    const definitions = this.loadDefinitions();
    const models = this.loadRememberedModels();
    const options = this.loadRememberedOptions();
    return candidates.map((candidate) => ({
      ...candidate,
      alreadyAdded: definitions.some((d) => d.id === candidate.recipeId),
      rememberedModel: models[candidate.recipeId] ?? null,
      ...(options[candidate.recipeId] !== undefined
        ? { rememberedOptions: options[candidate.recipeId] }
        : {}),
    }));
  }

  /**
   * The definition a known recipe would auto-save, from the recipe's own launch plus
   * the machine probe — never from user input. Undefined when discovery has not seen
   * a runnable entrypoint for it.
   */
  private async definitionForKnownAgent(
    agentId: string,
  ): Promise<AgentServerDefinition | undefined> {
    const candidates = await discoverKnownAgents({ env: process.env, home: os.homedir() });
    const candidate = candidates.find((c) => c.recipeId === agentId);
    if (candidate?.launch === undefined || candidate.launch === null) return undefined;
    return parseDefinition({
      id: candidate.recipeId,
      title: candidate.title,
      command: candidate.launch.command,
      args: candidate.launch.args,
    });
  }

  private persistDefinitions(definitions: AgentServerDefinition[]): void {
    this.settings.set(DEFINITIONS_KEY, JSON.stringify(definitions));
    this.getManager().setDefinitions([...definitions]);
  }

  private loadRememberedModels(): Record<
    string,
    { configId: string; value: boolean | string; name?: string }
  > {
    const raw = this.settings.get(MODELS_KEY);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, { configId: string; value: boolean | string; name?: string }>;
    } catch {
      return {};
    }
  }

  /**
   * Create a temporary workspace under the agent's home: `workspaces/tmp-<8hex>`, the
   * same auto-create contract core Sessions have (that helper is project/agent-keyed,
   * which coding-agent sessions deliberately are not). The final mkdir is non-recursive
   * on purpose: recursive mkdir succeeds silently on an existing directory, which would
   * put two sessions into one workspace.
   */
  private async createTempWorkspace(home: string): Promise<string> {
    const base = path.join(home, "workspaces");
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 5; attempt++) {
      const dir = path.join(base, `tmp-${randomUUID().slice(0, 8)}`);
      try {
        await fs.mkdir(dir, { mode: 0o700 });
        return dir;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new AcpAgentError("could not allocate a unique temporary workspace directory");
  }

  private loadDefinitions(): AgentServerDefinition[] {
    const raw = this.settings.get(DEFINITIONS_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // One bad entry must not take the whole registry down; parseDefinition throws on it.
      const definitions: AgentServerDefinition[] = [];
      for (const entry of parsed) {
        try {
          definitions.push(upgradeAdapterPackage(parseDefinition(entry)));
        } catch {
          // Skip the malformed entry.
        }
      }
      return definitions;
    } catch {
      return [];
    }
  }

  private envFor(definition: AgentServerDefinition): Record<string, string> {
    const extra: Record<string, string> = {
      ...definition.env,
      PENGUIN_CODING_AGENT_HOME: agentHome(this.config.root, definition.id),
      // Login flows open on the host, not in a browser the agent can spawn.
      NO_BROWSER: "1",
    };
    const url = this.settings.getProxyUrl();
    if (url !== null && url !== "" && this.settings.getProxyForAgent()) {
      extra.HTTPS_PROXY = url;
      extra.HTTP_PROXY = url;
    }
    return sandboxedAgentEnv(extra);
  }

  /** The listing shape of a definition, without remembered settings or env. */
  private infoOf(d: AgentServerDefinition): CodingAgentServerInfo {
    return {
      id: d.id,
      command: d.command,
      args: d.args ?? [],
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.builtin !== undefined ? { builtin: d.builtin } : {}),
    };
  }

  private toInfo(view: {
    sessionId: string;
    definitionId: string;
    workspaceDir: string;
    busy: boolean;
    createdAt: number;
    resumeSupport: AgentResumeSupport;
  }): CodingAgentSessionInfo {
    const title = this.titles.get(view.sessionId);
    return {
      sessionId: view.sessionId,
      agentId: view.definitionId,
      workspaceDir: view.workspaceDir,
      busy: view.busy,
      createdAt: view.createdAt,
      resumeSupport: view.resumeSupport,
      ...(title !== undefined ? { title } : {}),
    };
  }
}
