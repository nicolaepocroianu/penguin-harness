/**
 * Coding agents: drive external ACP-speaking agents (Claude Code, Codex, Gemini CLI, or any
 * custom command) against a folder on the server machine, and watch their sessions live —
 * text and thinking streams, tool-call cards, permission asks, mode switches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryCandidate,
  CodingAgentEvent,
  CodingAgentSaveRequest,
  CodingAgentServerInfo,
  CodingAgentSessionInfo,
} from "@prismshadow/penguin-server/api";
import {
  answerCodingAgentPermission,
  cancelCodingAgentSession,
  createCodingAgentSession,
  discoverCodingAgents,
  downloadCodingAgentTranscript,
  promptCodingAgentSession,
  refreshCodingAgents,
  removeCodingAgent,
  renameCodingAgentSession,
  saveCodingAgent,
  setCodingAgentMode,
  setCodingAgentModel,
  setCodingAgentSessionConfig,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Field } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { WorkspaceSelect } from "../chat/workspace-select";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { useCodingAgents, useCodingAgentStream } from "./use-coding-agents";

/** The page's own mark, shared by the nav icon and the section rows. */
const BOT_PATH =
  "M12 2.6v2.9M6.5 21h11M6 10.5h12V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8.5ZM9.2 14.6h.01M14.8 14.6h.01M6 10.5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3";

/** The transcript-export affordance's download tray (the icon module's DownloadIcon path). */
const DOWNLOAD_PATH = "M12 4v11m0 0l-5-5m5 5l5-5M4 20h16";

/** The rename affordance's pencil. */
const PENCIL_PATH = "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z";

/** Tool-call status → tone, by meaning (a pending ask reads as waiting on the user). */
const TOOL_TONE: Record<string, Tone> = {
  pending: "attention",
  in_progress: "busy",
  completed: "success",
  failed: "danger",
};

const STOP_LABEL: Record<
  string,
  { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }
> = {
  end_turn: { label: "turnEnded", tone: "muted" },
  cancelled: { label: "turnCancelled", tone: "muted" },
  failed: { label: "turnFailed", tone: "danger" },
};

type PermissionRequest = Extract<CodingAgentEvent, { type: "permission_request" }>["request"];
type ToolCallSnapshot = Extract<CodingAgentEvent, { type: "tool_call" }>["call"];

interface TextBlock {
  kind: "assistant" | "thinking";
  text: string;
}

/** One card on the screen: a known recipe probed on the server, or a saved custom agent. */
interface AgentCardModel {
  key: string;
  agentId: string;
  title: string;
  commandLine: string;
  saved: boolean;
  version?: string;
  authStatus?: "ok" | "missing" | "unknown";
  setupHint?: string | null;
  homepageUrl?: string;
  models?: CodingAgentConfigOption[];
  rememberedModel?: { configId: string; value: boolean | string; name?: string } | null;
}

/**
 * The session id a route visit should select, if any. A pushed (or replaced) location
 * naming a session wins even when the page is already mounted — that is how a Quick
 * Switcher pick reaches an open page, whose useState initializer never re-runs.
 * Back/forward pops return null so history navigation does not yank the selection.
 */
export function selectSessionFromRoute(
  requested: unknown,
  navigationType: "PUSH" | "REPLACE" | "POP",
): string | null {
  if (navigationType === "POP") return null;
  return typeof requested === "string" && requested !== "" ? requested : null;
}

export function CodingAgentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const { agents, sessions, loading, loadError, reload } = useCodingAgents();
  // Route state names a session to open (the Quick Switcher's session entries navigate
  // here with one). The initializer covers a first mount; the effect below re-applies
  // fresh navigations while the page is already open. Back/forward pops never re-select.
  const location = useLocation();
  const navigationType = useNavigationType();
  const requestedSessionId = (location.state as { sessionId?: unknown } | null)?.sessionId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof requestedSessionId === "string" && requestedSessionId !== "" ? requestedSessionId : null,
  );
  useEffect(() => {
    const next = selectSessionFromRoute(requestedSessionId, navigationType);
    if (next !== null) setSelectedId(next);
  }, [navigationType, requestedSessionId]);
  const [addOpen, setAddOpen] = useState(false);
  const [launchFor, setLaunchFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CodingAgentServerInfo | null>(null);
  const [candidates, setCandidates] = useState<CodingAgentDiscoveryCandidate[] | null>(null);
  const [agentModels, setAgentModels] = useState<Record<string, CodingAgentConfigOption[]>>({});
  const [scanning, setScanning] = useState(false);

  const loadCandidates = useCallback(() => {
    discoverCodingAgents()
      .then((res) => {
        setCandidates(res.candidates);
        setAgentModels(res.agentModels);
      })
      .catch(() => {
        setCandidates(null);
        setAgentModels({});
      });
  }, []);
  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const rescan = () => {
    setScanning(true);
    refreshCodingAgents()
      .then((res) => {
        setCandidates(res.candidates);
        setAgentModels(res.agentModels);
      })
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setScanning(false));
  };

  // Merge probed recipes with saved definitions: a definition's command is authoritative
  // over the recipe's suggestion, custom definitions become their own cards. "Usable"
  // gates on `detected` — an npx-run adapter can resolve while the agent itself is
  // absent, and a launch alone never proves the agent is installed.
  const installed: AgentCardModel[] = [];
  const available: AgentCardModel[] = [];
  const seenRecipes = new Set<string>();
  for (const candidate of candidates ?? []) {
    seenRecipes.add(candidate.recipeId);
    const definition = agents.find((a) => a.id === candidate.recipeId);
    const usable = candidate.detected || definition !== undefined;
    const card: AgentCardModel = {
      key: `recipe:${candidate.recipeId}`,
      agentId: candidate.recipeId,
      title: definition?.title ?? candidate.title,
      commandLine: definition
        ? [definition.command, ...definition.args].join(" ")
        : candidate.launch !== null
          ? [candidate.launch.command, ...candidate.launch.args].join(" ")
          : "",
      saved: definition !== undefined || candidate.alreadyAdded,
      version: candidate.version,
      authStatus: candidate.authStatus,
      setupHint:
        candidate.launch === null ? (candidate.setupHint ?? S.codingAgents.setupRequired) : null,
      homepageUrl: candidate.homepageUrl,
      // A saved definition's own probe wins over the recipe's: its sessions run the
      // saved command, so its dropdown shows what that command advertises.
      models: agentModels[candidate.recipeId] ?? candidate.models,
      rememberedModel: definition?.rememberedModel ?? candidate.rememberedModel ?? null,
    };
    (usable ? installed : available).push(card);
  }
  for (const agent of agents) {
    if (seenRecipes.has(agent.id)) continue;
    installed.push({
      key: `def:${agent.id}`,
      agentId: agent.id,
      title: agent.title ?? agent.id,
      commandLine: [agent.command, ...agent.args].join(" "),
      saved: true,
      models: agentModels[agent.id],
      rememberedModel: agent.rememberedModel ?? null,
    });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <GlyphIcon
          d={BOT_PATH}
          size={ICON_SIZE.sectionMark}
          className="text-gray-500 dark:text-gray-400"
        />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {S.codingAgents.title}
        </h1>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{S.codingAgents.description}</p>

      {loadError ? (
        <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
          {S.codingAgents.loadFailed}
        </div>
      ) : null}

      <section className="mb-8">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {S.codingAgents.installedTitle}
            {candidates !== null ? ` (${installed.length})` : ""}
          </h2>
          <div className="flex shrink-0 gap-2">
            {isAdmin ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                {S.codingAgents.addAgent}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button size="sm" onClick={rescan} disabled={scanning}>
                {scanning ? S.codingAgents.scanning : S.codingAgents.rescan}
              </Button>
            ) : null}
          </div>
        </div>
        {installed.length === 0 && !loading ? (
          <p className="whitespace-pre-line rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {candidates === null ? S.codingAgents.scanFailed : S.codingAgents.noAgents}
          </p>
        ) : (
          <ul className="space-y-2">
            {installed.map((card) => (
              <AgentCard
                key={card.key}
                card={card}
                isAdmin={isAdmin}
                onNewSession={() => setLaunchFor(card.agentId)}
                onRemove={() => {
                  const agent = agents.find((a) => a.id === card.agentId);
                  if (agent !== undefined) setRemoving(agent);
                }}
                onModelChanged={loadCandidates}
              />
            ))}
          </ul>
        )}
      </section>

      {available.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {S.codingAgents.availableTitle} ({available.length})
          </h2>
          <ul className="space-y-2">
            {available.map((card) => (
              <li
                key={card.key}
                className="flex min-w-0 items-center gap-2.5 rounded-md border border-gray-200 px-3 py-2.5 opacity-70 dark:border-gray-800"
              >
                <GlyphIcon
                  d={BOT_PATH}
                  size={ICON_SIZE.rowLead}
                  className="shrink-0 text-gray-400 dark:text-gray-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-900 dark:text-gray-100">
                    {card.title}
                  </div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {card.setupHint ?? S.codingAgents.setupRequired}
                  </div>
                </div>
                {card.homepageUrl ? (
                  <a
                    href={card.homepageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-[var(--accent-fg)] underline-offset-2 hover:underline"
                  >
                    {S.codingAgents.installLink}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SessionsSection
        sessions={sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSettled={reload}
      />

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={reload} />
      <LaunchModal
        cards={installed}
        initialAgentId={launchFor}
        onClose={() => setLaunchFor(null)}
        onCreated={reload}
      />
      <ConfirmModal
        open={removing !== null}
        title={S.codingAgents.removeConfirmTitle}
        confirmLabel={S.codingAgents.removeAgent}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) {
            void removeCodingAgent(removing.id)
              .then(() => {
                toastSuccess(S.codingAgents.removeAgent);
                reload();
                loadCandidates();
              })
              .catch((e: unknown) => toastError(apiErrorText(e)));
          }
          setRemoving(null);
        }}
      >
        {removing !== null ? S.codingAgents.removeConfirmBody(removing.title ?? removing.id) : ""}
      </ConfirmModal>
    </div>
  );
}

/**
 * One installed agent: name, version and sign-in state (when a scan has run), the
 * command, the model remembered for it, and its actions. A Model pick on the card is
 * remembered for the agent and auto-applied to its new sessions.
 */
function AgentCard({
  card,
  isAdmin,
  onNewSession,
  onRemove,
  onModelChanged,
}: {
  card: AgentCardModel;
  isAdmin: boolean;
  onNewSession: () => void;
  onRemove: () => void;
  onModelChanged: () => void;
}) {
  const modelOption =
    card.models?.find((o) => o.category === "model" && o.type === "select") ??
    card.models?.find((o) => o.type === "select");
  const rememberedFits = card.rememberedModel?.configId === modelOption?.id;
  const modelValue = String(
    rememberedFits && card.rememberedModel != null
      ? card.rememberedModel.value
      : (modelOption?.currentValue ?? ""),
  );
  const setModel = (value: string) => {
    if (modelOption === undefined) return;
    const choice = modelOption.options.find((v) => v.value === value);
    void setCodingAgentModel(card.agentId, {
      configId: modelOption.id,
      value,
      ...(choice !== undefined ? { name: choice.name } : {}),
    })
      .then(onModelChanged)
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };
  return (
    <li className="rounded-md border border-gray-200 px-3 py-2.5 dark:border-gray-800">
      <div className="flex items-start gap-2.5">
        <GlyphIcon
          d={BOT_PATH}
          size={ICON_SIZE.rowLead}
          className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {card.title}
            </span>
            {card.version !== undefined ? (
              <span className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                {card.version}
              </span>
            ) : null}
            {card.authStatus === "ok" ? (
              <span className={`text-xs ${toneInk.success}`}>{S.codingAgents.authOk}</span>
            ) : card.authStatus === "missing" ? (
              <span className={`text-xs ${toneInk.attention}`}>{S.codingAgents.authMissing}</span>
            ) : null}
          </div>
          {card.commandLine !== "" ? (
            <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
              {card.commandLine}
            </div>
          ) : null}
          {card.setupHint !== null && card.setupHint !== undefined ? (
            <div className={`text-xs ${toneInk.attention}`}>{card.setupHint}</div>
          ) : null}
          {modelOption !== undefined && modelOption.options.length > 0 ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {S.codingAgents.modelLabel}
              </span>
              <Select
                size="sm"
                aria-label={`${card.title} ${S.codingAgents.modelLabel}`}
                value={modelValue}
                disabled={!isAdmin}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOption.options.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Startable needs a runnable entrypoint: a saved definition always has its
              own command; a recipe needs its launch (an installed-but-adapterless agent
              would only 400 at start). */}
          {card.saved || card.commandLine !== "" ? (
            <Button size="sm" onClick={onNewSession}>
              {S.codingAgents.newSession}
            </Button>
          ) : null}
          {card.saved && isAdmin ? (
            <Button size="sm" variant="danger" onClick={onRemove}>
              {S.codingAgents.removeAgent}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SessionsSection({
  sessions,
  selectedId,
  onSelect,
  onSettled,
}: {
  sessions: CodingAgentSessionInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSettled: () => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {S.codingAgents.sessionsTitle}
      </h2>
      {sessions.length === 0 ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          {S.codingAgents.noSessions}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 lg:col-span-2">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(session.sessionId)}
                  aria-pressed={selectedId === session.sessionId}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 text-left ${
                    selectedId === session.sessionId
                      ? "bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-gray-50 dark:hover:bg-gray-900"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.busy ? toneDot.busy : toneDot.muted
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                    {session.title ?? `${session.agentId} — ${session.workspaceDir}`}
                    <span className="sr-only">
                      {". "}
                      {session.busy ? S.codingAgents.busy : S.codingAgents.idle}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {session.busy ? S.codingAgents.busy : S.codingAgents.idle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="lg:col-span-3">
            {selectedId !== null ? (
              <SessionView
                sessionId={selectedId}
                session={sessions.find((s) => s.sessionId === selectedId) ?? null}
                onSettled={onSettled}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/** Fold the event log into render state: merged text blocks + tool calls at latest state. */
function buildTranscript(
  events: CodingAgentEvent[],
  seedConfigOptions: CodingAgentConfigOption[] = [],
): {
  blocks: TextBlock[];
  toolList: ToolCallSnapshot[];
  notices: string[];
  stops: { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }[];
  modes: { id: string; name: string }[];
  currentMode: string | null;
  configOptions: CodingAgentConfigOption[];
  permission: PermissionRequest | null;
} {
  const blocks: TextBlock[] = [];
  const tools = new Map<string, ToolCallSnapshot>();
  const notices: string[] = [];
  const stops: { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }[] = [];
  let modes: { id: string; name: string }[] = [];
  let currentMode: string | null = null;
  // Seeded from the session's authoritative set: the bounded log may have evicted its
  // original config_options event, so an empty log must not mean "no controls".
  let configOptions: CodingAgentConfigOption[] = seedConfigOptions;
  let permission: PermissionRequest | null = null;
  const resolved = new Set<string>();
  let current: TextBlock | null = null;
  for (const event of events) {
    if (event.type === "message_chunk" || event.type === "thought_chunk") {
      const kind = event.type === "message_chunk" ? "assistant" : "thinking";
      if (current === null || current.kind !== kind) {
        current = { kind, text: event.delta };
        blocks.push(current);
      } else {
        current.text += event.delta;
      }
      continue;
    }
    current = null;
    if (event.type === "tool_call" || event.type === "tool_call_update") {
      const existing = tools.get(event.call.toolCallId);
      tools.set(event.call.toolCallId, { ...(existing ?? {}), ...event.call });
    } else if (event.type === "notice") {
      notices.push(event.message);
    } else if (event.type === "modes") {
      if (event.modes.modes.length > 0) modes = event.modes.modes;
      currentMode = event.modes.currentModeId;
    } else if (event.type === "config_options") {
      configOptions = event.options;
    } else if (event.type === "permission_request") {
      permission = event.request;
    } else if (event.type === "permission_resolved") {
      resolved.add(event.requestId);
    } else if (event.type === "turn_end") {
      stops.push(STOP_LABEL[event.stopReason] ?? { label: "turnEnded", tone: "muted" });
    }
  }
  if (permission !== null && resolved.has(permission.requestId)) permission = null;
  return {
    blocks,
    toolList: [...tools.values()],
    notices,
    stops,
    modes,
    currentMode,
    configOptions,
    permission,
  };
}

function SessionView({
  sessionId,
  session,
  onSettled,
}: {
  sessionId: string;
  /** The session's list entry; null when the list has not caught up (or the session is gone). */
  session: CodingAgentSessionInfo | null;
  onSettled: () => void;
}) {
  const {
    events,
    configOptions: seedOptions,
    connected,
    missing,
  } = useCodingAgentStream(sessionId, onSettled);
  // The seed is the session's authoritative set (the log can have evicted its config
  // event); config_options events in the log override it as they arrive.
  const transcript = useMemo(() => buildTranscript(events, seedOptions), [events, seedOptions]);
  const [draft, setDraft] = useState("");
  const [awaitingTurn, setAwaitingTurn] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (events.some((e) => e.type === "turn_end")) setAwaitingTurn(false);
  }, [events]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    setAwaitingTurn(true);
    promptCodingAgentSession(sessionId, { text }).catch((e: unknown) => {
      toastError(apiErrorText(e));
      setAwaitingTurn(false);
      setDraft(text);
    });
  };

  if (missing) {
    return (
      <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.muted}`}>
        {S.codingAgents.sessionGone}
      </div>
    );
  }

  const busy = awaitingTurn;

  const exportTranscript = () => {
    void downloadCodingAgentTranscript(sessionId).catch((e: unknown) =>
      toastError(apiErrorText(e)),
    );
  };

  const defaultTitle =
    session !== null ? `${session.agentId} — ${session.workspaceDir}` : sessionId;
  const sessionTitle = session?.title ?? defaultTitle;

  return (
    <div className="flex max-h-[70vh] flex-col rounded-md border border-gray-200 dark:border-gray-800">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {sessionTitle}
        </span>
        {session !== null ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={S.codingAgents.renameSession}
            title={S.codingAgents.renameSession}
            onClick={() => setRenameOpen(true)}
          >
            <GlyphIcon d={PENCIL_PATH} size={ICON_SIZE.iconButton} />
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={exportTranscript}>
          <GlyphIcon d={DOWNLOAD_PATH} size={ICON_SIZE.inlineGlyph} />
          {S.codingAgents.exportTranscript}
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {transcript.blocks.map((block, i) =>
          block.kind === "assistant" ? (
            <p
              key={`t${i}`}
              className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100"
            >
              {block.text}
            </p>
          ) : (
            <p
              key={`t${i}`}
              className="whitespace-pre-wrap text-xs italic text-gray-500 dark:text-gray-400"
            >
              {S.codingAgents.thinking}: {block.text}
            </p>
          ),
        )}
        {transcript.toolList.map((call) => (
          <ToolCallCard key={call.toolCallId} call={call} />
        ))}
        {transcript.notices.map((message, i) => (
          <div
            key={`n${i}`}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${toneStrip.attention}`}
          >
            {S.codingAgents.noticeTitle}: {message}
          </div>
        ))}
        {transcript.stops.map((stop, i) => (
          <div key={`s${i}`} className={`text-xs ${toneInk[stop.tone]}`}>
            {S.codingAgents[stop.label]}
          </div>
        ))}
        {transcript.permission !== null ? (
          <div className={`rounded-md border px-2.5 py-2 ${toneStrip.attention}`}>
            <div className="mb-1.5 text-xs font-medium">{S.codingAgents.permissionTitle}</div>
            <div className="mb-2 truncate font-mono text-xs">
              {transcript.permission.toolCall.title}
            </div>
            <div className="flex gap-2">
              {transcript.permission.options.map((option) => (
                <Button
                  key={option.optionId}
                  size="sm"
                  variant={option.kind.startsWith("allow") ? "primary" : "danger"}
                  onClick={() => {
                    const request = transcript.permission;
                    if (request === null) return;
                    void answerCodingAgentPermission(sessionId, request.requestId, {
                      outcome: { outcome: "selected", optionId: option.optionId },
                    }).catch((e: unknown) => toastError(apiErrorText(e)));
                  }}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
        {transcript.configOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {transcript.configOptions.map((option) => (
              <ConfigOptionControl key={option.id} sessionId={sessionId} option={option} />
            ))}
          </div>
        ) : null}
        {transcript.modes.length > 0 ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {S.codingAgents.modeLabel}
            </span>
            {transcript.modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  void setCodingAgentMode(sessionId, { modeId: mode.id }).catch((e: unknown) =>
                    toastError(apiErrorText(e)),
                  );
                }}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  transcript.currentMode === mode.id
                    ? "border-[var(--accent-bg)] bg-[var(--accent-bg)] text-[var(--accent-fg)]"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {mode.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            size="sm"
            aria-label={S.codingAgents.composerPlaceholder}
            placeholder={S.codingAgents.composerPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="primary" onClick={send} disabled={draft.trim() === ""}>
              {S.codingAgents.send}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void cancelCodingAgentSession(sessionId).catch(() => undefined)}
            >
              {S.codingAgents.stop}
            </Button>
          </div>
        </div>
      </div>
      <RenameSessionModal
        open={renameOpen}
        session={session}
        onClose={() => setRenameOpen(false)}
        onRenamed={onSettled}
      />
    </div>
  );
}

/**
 * Rename one session. The server trims and caps the title; an empty field clears it back
 * to the default (agent — workspace). `onRenamed` refreshes the sessions list so the row
 * and this header pick the new name up.
 */
function RenameSessionModal({
  open,
  session,
  onClose,
  onRenamed,
}: {
  open: boolean;
  session: CodingAgentSessionInfo | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open && session !== null) setTitle(session.title ?? "");
  }, [open, session]);
  const save = () => {
    if (session === null) return;
    renameCodingAgentSession(session.sessionId, { title })
      .then(() => {
        toastSuccess(S.codingAgents.renameTitle);
        onRenamed();
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };
  return (
    <Modal
      open={open && session !== null}
      title={S.codingAgents.renameTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            {S.codingAgents.save}
          </Button>
        </>
      }
    >
      <Field label={S.codingAgents.renameLabel} hint={S.codingAgents.renameHint}>
        <Input size="sm" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
    </Modal>
  );
}

/**
 * One agent-advertised session setting — the model dropdown is the one that matters —
 * rendered next to the composer. The set updates itself: the agent's reply and any live
 * config_option_update arrive as config_options events on the session's stream.
 */
function ConfigOptionControl({
  sessionId,
  option,
}: {
  sessionId: string;
  option: CodingAgentConfigOption;
}) {
  const set = (value: boolean | string) => {
    void setCodingAgentSessionConfig(sessionId, { configId: option.id, value }).catch(
      (e: unknown) => toastError(apiErrorText(e)),
    );
  };
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{option.name}</span>
      {option.type === "select" ? (
        <Select
          size="sm"
          aria-label={option.name}
          value={String(option.currentValue)}
          onChange={(e) => set(e.target.value)}
        >
          {option.options.map((value) => (
            <option key={value.value} value={value.value}>
              {value.name}
            </option>
          ))}
        </Select>
      ) : (
        <button
          type="button"
          aria-pressed={option.currentValue === true}
          onClick={() => set(option.currentValue !== true)}
          className={`rounded-full border px-2 py-0.5 text-xs ${
            option.currentValue === true
              ? "border-[var(--accent-bg)] bg-[var(--accent-bg)] text-[var(--accent-fg)]"
              : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          }`}
        >
          {option.currentValue === true ? S.codingAgents.configOn : S.codingAgents.configOff}
        </button>
      )}
    </div>
  );
}

/** One tool call as a card row: status dot + title (state spoken in the accessible name), details folded beneath. */
function ToolCallCard({ call }: { call: ToolCallSnapshot }) {
  const tone = TOOL_TONE[call.status] ?? "muted";
  const [open, setOpen] = useState(false);
  const hasDetails =
    call.rawInput !== undefined || (call.output !== undefined && call.output !== "");
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
          <span className="sr-only">{`${call.status}. `}</span>
          {call.title}
        </span>
        {hasDetails ? (
          <span className={`shrink-0 ${toneInk.muted}`}>
            <GlyphIcon
              d="M6 9l6 6 6-6"
              size={ICON_SIZE.rowMark}
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="border-t border-gray-100 px-2.5 py-2 dark:border-gray-800">
          {call.rawInput !== undefined ? (
            <>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.codingAgents.toolInput}
              </div>
              <pre className="mb-2 overflow-x-auto font-mono text-xs text-gray-600 dark:text-gray-300">
                {JSON.stringify(call.rawInput, null, 2)}
              </pre>
            </>
          ) : null}
          {call.output !== undefined && call.output !== "" ? (
            <>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.codingAgents.toolOutput}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-gray-600 dark:text-gray-300">
                {call.output}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddAgentModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  const reset = () => {
    setId("");
    setTitle("");
    setCommand("");
    setArgs("");
    setEnv("");
  };

  const save = () => {
    const envRecord: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const sep = line.indexOf("=");
      if (sep <= 0) continue;
      envRecord[line.slice(0, sep).trim()] = line.slice(sep + 1);
    }
    saveCodingAgent({
      id: id.trim(),
      ...(title.trim() === "" ? {} : { title: title.trim() }),
      command: command.trim(),
      args: args
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a !== ""),
      env: envRecord,
    })
      .then(() => {
        toastSuccess(S.codingAgents.save);
        reset();
        onSaved();
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };

  return (
    <Modal
      open={open}
      title={S.codingAgents.addAgent}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={id.trim() === "" || command.trim() === ""}
            onClick={save}
          >
            {S.codingAgents.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={S.codingAgents.idLabel} hint={S.codingAgents.idHint} required>
          <Input size="sm" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.titleLabel}>
          <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.commandLabel} hint={S.codingAgents.commandHint} required>
          <Input size="sm" value={command} onChange={(e) => setCommand(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.argsLabel} hint={S.codingAgents.argsHint}>
          <Textarea size="sm" value={args} onChange={(e) => setArgs(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.envLabel} hint={S.codingAgents.envHint}>
          <Textarea size="sm" value={env} onChange={(e) => setEnv(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Start a session: pick one of the page's installed agents — a saved definition, or a
 * detected-but-unsaved recipe (the server persists the recipe-derived definition on
 * start) — and optionally pick a folder. An empty folder is the same contract chat has
 * — the server auto-creates a temporary workspace — so starting is one click, and the
 * folder browser is there for when a specific checkout matters.
 */
function LaunchModal({
  cards,
  initialAgentId,
  onClose,
  onCreated,
}: {
  cards: AgentCardModel[];
  initialAgentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { currentProject } = useProject();
  const [agentId, setAgentId] = useState("");
  const [workspace, setWorkspace] = useState("");
  // Re-open resets the picker to the row that launched it (or the first agent).
  useEffect(() => {
    if (initialAgentId !== null) {
      setAgentId(initialAgentId);
      setWorkspace("");
    }
  }, [initialAgentId]);
  // Only startable cards are offered: a saved definition always has its own command, a
  // recipe needs its launch (an installed-but-adapterless agent would only 400 at start).
  const startable = useMemo(
    () => cards.filter((c) => c.saved || c.commandLine !== ""),
    [cards],
  );
  // The preselected id is always the id of one of the startable cards (a card's own New
  // session opened the modal), so the Select's value always matches a rendered option.
  const card = startable.find((c) => c.agentId === agentId) ?? null;
  const create = () => {
    if (card === null) return;
    createCodingAgentSession({
      agentId: card.agentId,
      ...(workspace.trim() === "" ? {} : { workspaceDir: workspace.trim() }),
    })
      .then(() => {
        onCreated();
        setWorkspace("");
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };
  return (
    <Modal
      open={initialAgentId !== null}
      title={S.codingAgents.newSession}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={card === null} onClick={create}>
            {S.codingAgents.startSession}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={S.codingAgents.agentLabel} required>
          <Select size="sm" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {startable.length === 0 ? (
              <option value="">{S.codingAgents.noAgents}</option>
            ) : (
              startable.map((c) => (
                <option key={c.key} value={c.agentId}>
                  {c.title}
                </option>
              ))
            )}
          </Select>
        </Field>
        {card !== null && card.commandLine !== "" ? (
          <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {card.commandLine}
          </div>
        ) : null}
        {currentProject !== null ? (
          <WorkspaceSelect
            projectId={currentProject.projectId}
            workspace={workspace}
            onChange={setWorkspace}
            variant="form"
            fieldLabel={S.codingAgents.workspaceLabel}
          />
        ) : (
          <Field label={S.codingAgents.workspaceLabel} hint={S.codingAgents.workspaceHint}>
            <Input size="sm" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
