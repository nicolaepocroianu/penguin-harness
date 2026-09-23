import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  AssetManifest,
  PipelineSelection,
  PipelineState,
  UploadedMedia,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { discoverCodingAgents, listCodingAgents } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneSurface, toneStrip, type Tone } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { InfoPopover } from "../../components/ui/info-popover";
import { CreateActivityDialog } from "./create-activity-dialog";
import { ImportDialog } from "./import-dialog";
import { ActivityWorkspace as WorkspaceShell, type StudioPanelEntry } from "./activity-workspace";
import { AssetEditor } from "./asset-editor";
import { fileSizeText } from "./media-library";
import { SpeechCoverage } from "./speech-coverage";
import { buildSceneTree, filterTree, treeSelections, type SceneAssetType } from "./scene-assets";
import { firstSelection, sameSelection, type SceneAssetSelection } from "./scene-asset-tree";
import {
  resolveSection,
  workspaceSections,
  type StudioPanel,
  type WorkspaceSection,
} from "./workspace-model";
import { assetForPick, buildStudioTree } from "./studio-tree";
import { ConversationPanel } from "./conversation-panel";
import { focusFor, latestConversation } from "./conversation";
import { applyMediaChange, type ProposalChange } from "./proposal";
import { ScriptEditor } from "./script-editor";
import { PipelineControls, PipelinePanel } from "./pipeline-panel";
import { storyboardFrames, type StoryboardFrame } from "./storyboard";
import { Storyboard } from "./storyboard-view";
import { BuildPanel } from "./build-panel";
import { ModuleDocumentView } from "./module-document-view";
import { useAssistProposal } from "./use-assist-proposal";
import { StudioTreeView } from "./studio-tree-view";
import { SessionsPanel } from "./sessions-panel";
import { ModulePreview } from "./module-preview";
import { SandboxPanel } from "./sandbox-panel";
import { sandboxHasModule, type SandboxStatusLike } from "./sandbox";
import { SceneReview } from "./scene-review";
import { SpecDiffView } from "./spec-diff-view";
import { activityInitials, filterActivities, latestModuleRun } from "./preview";

const basePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/activities`;
const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");
const runTone: Record<ActivityRun["status"], Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  conflict: "attention",
  cancelled: "muted",
  interrupted: "attention",
};

/** How long after the last keystroke the script saves itself, as in Loom. */
const SCRIPT_AUTOSAVE_MS = 5000;
export function ActivitiesPage() {
  useLocale();
  useDocumentTitle(S.activities.title);
  const { currentProject, unavailableProjectId } = useProject();
  const previousProject = useRef(currentProject);
  if (currentProject) previousProject.current = currentProject;
  const project =
    currentProject ??
    (previousProject.current?.projectId === unavailableProjectId ? previousProject.current : null);
  if (!project) return <p className="p-6 text-sm text-gray-500">{S.activities.noProject}</p>;
  return (
    <ActivityWorkspace
      key={project.projectId}
      projectId={project.projectId}
      available={currentProject !== null}
      editable={currentProject?.role === "owner"}
    />
  );
}

function ActivityWorkspace({
  projectId,
  editable,
  available,
}: {
  projectId: string;
  editable: boolean;
  available: boolean;
}) {
  const { registerProjectChangeGuard } = useProject();
  const { activityId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const accessible = useRef(available);
  accessible.current = available;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!accessible.current) return;
    try {
      const result = await apiFetch<{ activities: ActivityRecord[] }>(basePath(projectId));
      if (mounted.current) {
        setItems(result.activities);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError(apiErrorText(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const canLeave = useCallback(() => !dirty.current || window.confirm(S.activities.discard), []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && !canLeave(),
  );
  useEffect(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  useLayoutEffect(
    () => registerProjectChangeGuard(canLeave),
    [registerProjectChangeGuard, canLeave],
  );
  const visible = useMemo(() => filterActivities(items, search), [items, search]);
  if (activityId) {
    // The workspace fills this pane and scrolls inside itself, so nothing may wrap it
    // in a scroller or a max-width column.
    return (
      <div className="h-full min-h-0">
        <ActivityEditor
          key={activityId}
          projectId={projectId}
          activityId={activityId}
          editable={editable}
          available={available}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onSaved={reload}
        />
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{S.activities.title}</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!available} onClick={() => void reload()}>
              {S.activities.refresh}
            </Button>
            {editable && (
              <Button size="sm" disabled={!available} onClick={() => setImportOpen(true)}>
                {S.activities.importFromLoom}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="primary"
                disabled={!available || !canLeave()}
                onClick={() => setCreateOpen(true)}
              >
                {S.activities.newActivity}
              </Button>
            )}
          </div>
        </header>
        {!available && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.unavailable}
          </p>
        )}
        {available && !editable && (
          <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.readOnly}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {items.length > 0 && (
          <Input
            size="sm"
            aria-label={S.activities.search}
            placeholder={S.activities.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
        )}
        {loading ? (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.loading}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500">
            {items.length === 0 ? S.activities.empty : S.activities.noMatches}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/activities/${item.id}`}
                  className="flex h-full flex-col gap-2 rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {activityInitials(item.title, item.productCode)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {item.productCode} / {item.refNum}
                      </span>
                    </span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                      {item.activityType === "book" ? S.activities.book : S.activities.standard}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {importOpen && (
        <ImportDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={() => void reload()}
        />
      )}
      {createOpen && (
        <CreateActivityDialog
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            dirty.current = false;
            navigate(`/activities/${created}`);
          }}
        />
      )}
    </div>
  );
}

function ActivityEditor({
  projectId,
  activityId,
  editable,
  available,
  onDirty,
  onSaved,
}: {
  projectId: string;
  activityId: string;
  editable: boolean;
  available: boolean;
  onDirty: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { agents, currentAgent } = useProject();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [specOpen, setSpecOpen] = useState(false);
  const [sectionChoice, setSection] = useState<WorkspaceSection | null>(null);
  const [languageChoice, setLanguage] = useState("");
  const [kind, setKind] = useState<SceneAssetType | "all">("all");
  const [selected, setSelected] = useState<SceneAssetSelection | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  // Controlled like the specification's, so moving between sections does not close it.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [media, setMedia] = useState("");
  const [runs, setRuns] = useState<ActivityRunSummary[]>([]);
  const [sandboxModule, setSandboxModule] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  // The activity's run of its stages, as the server last reported it (pipeline-run.ts).
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [pipelineChoice, setPipelineChoice] = useState<PipelineSelection>("all");
  // The Scenes section opens on the storyboard; opening an asset leaves it for the editor.
  const [board, setBoard] = useState(true);
  const [boardScene, setBoardScene] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState<{ key: StudioPanel; at: number } | null>(null);
  // An excerpt on its way to the conversation's composer, from another panel.
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const takeExcerpt = useCallback(() => setExcerpt(null), []);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  /** A Penguin agent id, or `coding:<id>` for an external coding agent. */
  const [agentId, setAgentId] = useState("");
  const [codingAgents, setCodingAgents] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Saved coding agents plus the ones detected as runnable on the server; either can run a
    // stage. Unavailable coding agents simply leave the list with Penguin agents only.
    void Promise.all([listCodingAgents(), discoverCodingAgents()])
      .then(([saved, discovered]) => {
        if (cancelled) return;
        const byId = new Map(saved.agents.map((a) => [a.id, a.title ?? a.id]));
        for (const candidate of discovered.candidates)
          if (candidate.detected && candidate.launch && !byId.has(candidate.recipeId))
            byId.set(candidate.recipeId, candidate.title);
        setCodingAgents([...byId].map(([id, title]) => ({ id, title })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [bookMode, setBookMode] = useState<"" | "readAlong" | "decodable">("");
  const [wafRoot, setWafRoot] = useState("");
  const [voices, setVoices] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadedMedia[]>([]);
  /**
   * Narration still to ask for. The server runs one generation per activity at a time,
   * so a bulk request is a queue this page drains as each run finishes rather than a
   * burst of requests the server would reject. It lives in the page, so leaving the
   * page stops the queue; the runs already started carry on.
   */
  const [speechQueue, setSpeechQueue] = useState<{
    language: string;
    voice: string;
    keys: string[];
  } | null>(null);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const state = useRef({ dirty: false, busy: false, revision: "", available });
  const alive = useRef(true);
  const endpoint = `${basePath(projectId)}/${encodeURIComponent(activityId)}`;
  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const value = await apiFetch<{ media: UploadedMedia[] }>(`${endpoint}/media-uploads`);
      if (alive.current) setUploads(value.media);
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      if (alive.current) setUploadsLoading(false);
    }
  }, [endpoint]);
  /** Read the file the author chose, store it, and hand back its binding reference. */
  const upload = useCallback(
    async (file: File) => {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000)
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      const stored = await apiFetch<UploadedMedia>(`${endpoint}/media-uploads`, {
        method: "POST",
        body: { name: file.name, dataBase64: btoa(binary) },
      });
      await loadUploads();
      return stored;
    },
    [endpoint, loadUploads],
  );
  useEffect(() => {
    if (!available || !editable) return;
    let cancelled = false;
    void apiFetch<{ voices: string[] }>(`${basePath(projectId)}/speech-setup`)
      .then((value) => {
        if (!cancelled) setVoices(value.voices);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    void loadUploads();
    void apiFetch<{ wafRoot: string | null }>(`${basePath(projectId)}/module-setup`)
      .then((value) => {
        if (!cancelled) setWafRoot(value.wafRoot ?? "");
      })
      .catch(() => {
        /* An explicit path can still be supplied when discovery fails. */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, available, editable]);
  const dirty =
    detail !== null &&
    (description !== detail.draft.description ||
      spec !== pretty(detail.draft.spec) ||
      media !== pretty(detail.draft.mediaPlan?.manifest));
  state.current = { dirty, busy, revision: detail?.draft.contentRevision ?? "", available };
  const proposal = useAssistProposal(endpoint, latestConversation(runs)?.runId ?? null);
  // The proposed script, while it still differs from the saved one.
  const proposedScript = proposal.read?.proposal?.changes.find(
    (change) => change.target === "description",
  );
  const scriptProposal =
    proposedScript && detail && proposedScript.text !== detail.draft.description
      ? proposedScript.text
      : null;
  useLayoutEffect(() => {
    onDirty(dirty);
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirty(false);
    };
  }, []); // The editor is keyed by activity and the workspace by project.
  function accept(value: ActivityDetail) {
    setDetail(value);
    setDescription(value.draft.description);
    setSpec(pretty(value.draft.spec));
    setMedia(pretty(value.draft.mediaPlan?.manifest));
    setChanged(false);
  }
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const revisionAtStart = state.current.revision;
      let active = false;
      try {
        const [value, history, sandbox, stages] = await Promise.all([
          apiFetch<ActivityDetail>(endpoint),
          apiFetch<{ runs: ActivityRunSummary[] }>(`${endpoint}/runs`),
          // A module this project never assembled -- one Loom generated -- still has a
          // Module section; only the sandbox knows it is there.
          apiFetch<SandboxStatusLike>(`${endpoint}/sandbox/status`).catch(() => null),
          // Following a run is a courtesy over the history, which stands without it.
          apiFetch<{ pipeline: PipelineState | null }>(`${endpoint}/pipeline`).catch(() => null),
        ]);
        if (cancelled) return;
        setLoadError("");
        setRuns(history.runs);
        setSandboxModule(sandboxHasModule(sandbox));
        if (stages) setPipeline(stages.pipeline);
        active =
          history.runs.some((run) => run.status === "running") ||
          stages?.pipeline?.status === "running";
        if (!state.current.busy && state.current.revision === revisionAtStart) {
          if (!state.current.dirty) accept(value);
          else if (value.draft.contentRevision !== state.current.revision) setChanged(true);
        }
      } catch (e) {
        if (!cancelled) setLoadError(apiErrorText(e));
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), active ? 2000 : 30_000);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, refreshVersion, available]);
  /** Run one change at a time; resolves true only when it went through. */
  async function action(operation: () => Promise<void>): Promise<boolean> {
    if (state.current.busy || !state.current.available) return false;
    state.current.busy = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      return true;
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  /** Save one part of the draft. `quiet` leaves out the notice, for an autosave. */
  async function save(kind: "description" | "spec" | "media", quiet = false): Promise<boolean> {
    if (!detail) return false;
    return action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/${kind === "description" ? "description" : kind === "media" ? "media" : "apply-generated-spec"}`,
        {
          method: kind === "description" ? "PATCH" : kind === "media" ? "PUT" : "POST",
          body: {
            expectedRevision: detail.draft.contentRevision,
            ...(kind === "description"
              ? { description }
              : kind === "media"
                ? { manifest: JSON.parse(media) }
                : { spec: JSON.parse(spec) }),
          },
        },
      );
      if (!alive.current) return;
      setDetail({
        ...detail,
        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
        draft,
      });
      if (kind === "spec") setSpec(pretty(draft.spec));
      if (kind === "media") setMedia(pretty(draft.mediaPlan?.manifest));
      if (!quiet) setNotice(S.activities.saved);
      await onSaved();
    });
  }
  const selectedAgent = agentId || currentAgent?.agentId || agents[0]?.agentId || "";
  const codingAgentId = selectedAgent.startsWith("coding:") ? selectedAgent.slice(7) : null;
  /** Who runs a stage, as the stage routes take it. */
  // A coding agent's run is a Session too, owned by the Penguin agent the Project would use.
  const penguinAgent = currentAgent?.agentId ?? agents[0]?.agentId;
  const runner = codingAgentId
    ? { codingAgentId, ...(penguinAgent !== undefined ? { agentId: penguinAgent } : {}) }
    : { agentId: selectedAgent };
  const running = runs.some((run) => run.status === "running");
  const pipelineRunning = pipeline?.status === "running";
  // Loom's editor saves the script a few seconds after typing stops, and holds off while
  // the pipeline runs so a save never moves the draft under a stage. Text typed during a
  // save stays: a save never writes the saved text back over the editor.
  const [scriptSave, setScriptSave] = useState<"saving" | "saved" | "failed" | null>(null);
  const scriptDirty = !!detail && description !== detail.draft.description;
  const autosaveHeld = running || pipelineRunning;
  useEffect(() => {
    if (!scriptDirty || !editable || !available || busy || autosaveHeld) return;
    const timer = setTimeout(() => {
      setScriptSave("saving");
      void save("description", true).then((ok) => {
        if (alive.current) setScriptSave(ok ? "saved" : "failed");
      });
    }, SCRIPT_AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` reads the latest text when it fires; the timer restarts on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, scriptDirty, editable, available, busy, autosaveHeld]);
  const scriptStatus = scriptDirty
    ? autosaveHeld
      ? S.activities.studioScript.autosave.held
      : scriptSave === "saving"
        ? S.activities.studioScript.autosave.saving
        : scriptSave === "failed"
          ? S.activities.studioScript.autosave.failed
          : S.activities.studioScript.autosave.pending
    : scriptSave === "saved"
      ? S.activities.studioScript.autosave.saved
      : null;
  const words = S.activities.studioRun;
  // Why Run cannot start the stages now. The server refuses the same cases; saying so
  // here saves the round trip, and says it in the author's terms.
  const pipelineBlocked =
    !editable || !available
      ? null
      : dirty
        ? words.saveFirst
        : running || pipelineRunning
          ? words.otherRun
          : !selectedAgent
            ? words.noAgent
            : null;
  const agentLabel = codingAgentId
    ? (codingAgents.find((agent) => agent.id === codingAgentId)?.title ?? codingAgentId)
    : (agents.find((agent) => agent.agentId === selectedAgent)?.name ?? selectedAgent);
  function runStages(stage: PipelineSelection = pipelineChoice) {
    void action(async () => {
      if (!detail) return;
      const started = await apiFetch<PipelineState>(`${endpoint}/pipeline`, {
        method: "POST",
        body: {
          ...runner,
          stage,
          ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
          ...(detail.activityType === "book" && bookMode ? { bookMode } : {}),
        },
      });
      if (!alive.current) return;
      setPipeline(started);
      setShowPanel({ key: "run", at: Date.now() });
      setRefreshVersion((value) => value + 1);
    });
  }
  function stopStages() {
    void action(async () => {
      const stopped = await apiFetch<{ pipeline: PipelineState | null }>(
        `${endpoint}/pipeline/stop`,
        { method: "POST", body: {} },
      );
      if (alive.current) setPipeline(stopped.pipeline);
    });
  }
  useEffect(() => {
    const next = speechQueue?.keys[0];
    if (!next || running || busy || dirty || !selectedAgent || codingAgentId || !detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const run = await apiFetch<ActivityRun>(`${endpoint}/generate-audio`, {
          method: "POST",
          body: {
            agentId: selectedAgent,
            expectedRevision: detail.draft.contentRevision,
            language: speechQueue!.language,
            assetKey: next,
            voice: speechQueue!.voice,
          },
        });
        if (cancelled || !alive.current) return;
        setRuns((previous) => [
          summarize(run),
          ...previous.filter((item) => item.runId !== run.runId),
        ]);
        setRefreshVersion((value) => value + 1);
        setSpeechQueue((queue) =>
          queue && queue.keys[0] === next
            ? queue.keys.length > 1
              ? { ...queue, keys: queue.keys.slice(1) }
              : null
            : queue,
        );
      } catch (e) {
        if (cancelled || !alive.current) return;
        // Stop the queue rather than let every remaining narration fail the same way.
        setSpeechQueue(null);
        setError(apiErrorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [speechQueue, running, busy, dirty, selectedAgent, codingAgentId, detail, endpoint]);
  let editedManifest: AssetManifest | null = null;
  try {
    const value = JSON.parse(media);
    // Structured controls require the saved shape; advanced edits are validated by the server.
    if (
      value &&
      typeof value.assets === "object" &&
      value.assets &&
      Object.values(value.assets).every(
        (items) =>
          Array.isArray(items) &&
          items.every(
            (item) =>
              item &&
              typeof item.key === "string" &&
              ["audio", "image", "video", "animation"].includes(item.type) &&
              typeof item.description === "string" &&
              Array.isArray(item.usages) &&
              item.usages.every(
                (usage: unknown) =>
                  usage &&
                  typeof usage === "object" &&
                  "sceneId" in usage &&
                  typeof usage.sceneId === "string",
              ) &&
              (item.script === undefined || typeof item.script === "string") &&
              (item.path === undefined || typeof item.path === "string") &&
              (item.generatedAudio === undefined ||
                (item.generatedAudio && typeof item.generatedAudio.runId === "string")) &&
              (item.generatedImage === undefined ||
                (item.generatedImage &&
                  typeof item.generatedImage.runId === "string" &&
                  typeof item.generatedImage.sha256 === "string")),
          ),
      )
    )
      editedManifest = value;
  } catch {
    /* Preserve invalid JSON for correction without replacing it with a saved manifest. */
  }
  /** Start one generation run and show it at the top of the history immediately. */
  function startRun(path: string, body: Record<string, unknown>) {
    void action(async () => {
      const run = await apiFetch<ActivityRun>(`${endpoint}/${path}`, {
        method: "POST",
        body: { ...runner, expectedRevision: detail!.draft.contentRevision, ...body },
      });
      if (alive.current) {
        setRuns((previous) => [
          summarize(run),
          ...previous.filter((item) => item.runId !== run.runId),
        ]);
        setRefreshVersion((value) => value + 1);
      }
    });
  }
  /**
   * Accept one change an agent proposed, through the route the author's own save uses, so
   * it is checked and recorded the same way. The author's unsaved edits are never
   * overwritten: the card will not offer Accept while there are any.
   */
  async function acceptProposal(change: ProposalChange): Promise<void> {
    await action(async () => {
      if (!detail || state.current.dirty) throw new Error(S.activities.studioProposal.saveFirst);
      const [path, method, body] =
        change.target === "description"
          ? (["description", "PATCH", { description: change.text }] as const)
          : change.target === "spec"
            ? (["apply-generated-spec", "POST", { spec: change.spec }] as const)
            : ([
                "media",
                "PUT",
                {
                  manifest: applyMediaChange(
                    detail.draft.mediaPlan?.manifest ??
                      fail(S.activities.studioProposal.missingAsset(change.assetKey)),
                    change,
                  ),
                },
              ] as const);
      const draft = await apiFetch<ActivityDraft>(`${endpoint}/${path}`, {
        method,
        body: { expectedRevision: detail.draft.contentRevision, ...body },
      });
      if (!alive.current) return;
      accept({
        ...detail,
        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
        draft,
      });
      setNotice(S.activities.saved);
    });
  }
  /** Accept a candidate, which replaces the draft rather than starting anything. */
  function acceptRun(runId: string, path: string) {
    void action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/runs/${encodeURIComponent(runId)}/${path}`,
        { method: "POST", body: { expectedRevision: detail!.draft.contentRevision } },
      );
      if (alive.current) {
        accept({ ...detail!, draft });
        setNotice(S.activities.saved);
      }
    });
  }
  // The rail and the detail pane read one derivation, so they cannot disagree about
  // which language, which scene, or which asset is being shown.
  const sections = workspaceSections({
    hasSpec: !!detail?.draft.spec,
    hasPlan: !!detail?.draft.mediaPlan,
    hasModule: !!latestModuleRun(runs) || sandboxModule,
  });
  const section = resolveSection(sectionChoice, {
    hasSpec: !!detail?.draft.spec,
    hasPlan: !!detail?.draft.mediaPlan,
    hasModule: !!latestModuleRun(runs) || sandboxModule,
  });
  const language = editedManifest?.assets[languageChoice]
    ? languageChoice
    : (Object.keys(editedManifest?.assets ?? {})[0] ?? "en-US");
  const tree = filterTree(
    buildSceneTree(detail?.draft.spec ?? null, editedManifest?.assets[language] ?? []),
    kind,
  );
  // A selection the filter or a rebuilt plan removed falls back to the first leaf, so
  // the detail pane never points at an asset the tree no longer draws.
  const fullTree = buildSceneTree(
    detail?.draft.spec ?? null,
    editedManifest?.assets[language] ?? [],
  );
  const frames = storyboardFrames(
    fullTree,
    detail?.draft.mediaPlan?.manifest.assets[language] ?? [],
    runs,
    proposal.read?.proposal?.changes ?? [],
    language,
  );
  const selection =
    selected && treeSelections(tree).some((entry) => sameSelection(entry, selected))
      ? selected
      : firstSelection(tree);
  // The open asset's place on the storyboard, and the scenes either side that have media
  // to open, so an author can walk the activity scene by scene from the editor.
  const frameLabel = (frame: StoryboardFrame) =>
    frame.general
      ? S.activities.studioBoard.shared
      : S.activities.studioBoard.scene(frame.number, frame.sceneId);
  const openFrame = (frame: StoryboardFrame | undefined) =>
    frame?.firstAssetKey
      ? {
          label: frameLabel(frame),
          open: () => {
            setKind("all");
            setSelected({ sceneId: frame.sceneId, key: frame.firstAssetKey! });
            setBoardScene(frame.sceneId);
          },
        }
      : null;
  const openable = frames.filter((frame) => frame.firstAssetKey);
  const here = openable.findIndex((frame) => frame.sceneId === selection?.sceneId);
  const sceneNav =
    here >= 0
      ? {
          label: frameLabel(openable[here]!),
          onBoard: () => {
            setBoardScene(openable[here]!.sceneId);
            setBoard(true);
          },
          previous: openFrame(openable[here - 1]),
          next: openFrame(openable[here + 1]),
        }
      : undefined;
  const languages = Object.keys(detail?.draft.mediaPlan?.manifest.assets ?? {});
  const panels: StudioPanelEntry[] = detail
    ? [
        {
          key: "run",
          label: S.activities.studioPanels.names.run,
          icon: "M5 6h10M5 12h14M5 18h7",
          render: () => (
            <PipelinePanel
              pipeline={pipeline}
              agentLabel={agentLabel}
              onAddExcerpt={(text) => {
                setExcerpt(text);
                setShowPanel({ key: "conversation", at: Date.now() });
              }}
            />
          ),
        },
        {
          key: "player",
          label: S.activities.studioPanels.names.player,
          icon: "M8 5v14l11-7z",
          render: () => (
            <div className="p-3">
              <SandboxPanel
                projectId={projectId}
                activityId={detail.id}
                spec={detail.draft.spec}
                languages={languages}
                hasMedia={!!editedManifest?.assets[language]?.length}
                onPick={(pick, sceneId) => {
                  // Matched against every kind of media, whatever the tree shows.
                  const found = assetForPick(
                    buildSceneTree(detail.draft.spec, editedManifest?.assets[language] ?? []),
                    sceneId,
                    pick,
                  );
                  if (!found) return null;
                  setSelected(found);
                  setBoard(false);
                  setSection("scenes");
                  return found.key;
                }}
              />
            </div>
          ),
        },
        {
          key: "conversation",
          label: S.activities.studioPanels.names.conversation,
          icon: "M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z",
          render: () => (
            <ConversationPanel
              endpoint={endpoint}
              runs={runs}
              runner={selectedAgent ? runner : null}
              revision={detail.draft.contentRevision}
              focus={
                section === "scenes" && board
                  ? { section, ...(boardScene ? { sceneId: boardScene, language } : {}) }
                  : focusFor(section, selection, language)
              }
              editable={editable}
              onStarted={(run) => {
                setRuns((previous) => [
                  summarize(run),
                  ...previous.filter((item) => item.runId !== run.runId),
                ]);
                setRefreshVersion((value) => value + 1);
              }}
              base={{
                description: detail.draft.description,
                spec: detail.draft.spec,
                manifest: detail.draft.mediaPlan?.manifest ?? null,
              }}
              dirty={dirty}
              onAccept={acceptProposal}
              proposal={proposal.read}
              onReplyEnded={proposal.reload}
              seed={excerpt}
              onSeedTaken={takeExcerpt}
            />
          ),
        },
        {
          key: "sessions",
          label: S.activities.studioPanels.names.sessions,
          icon: "M4 5h16v11H9l-5 4z",
          render: () => <SessionsPanel runs={runs} />,
        },
      ]
    : [];
  if (!detail)
    return (
      <p
        role={error || loadError ? "alert" : "status"}
        className={`text-sm ${error || loadError ? toneInk.danger : "text-gray-500"}`}
      >
        {error || loadError || S.activities.loading}
      </p>
    );
  return (
    <WorkspaceShell
      panels={panels}
      showPanel={showPanel}
      header={
        <>
          <Link
            to="/activities"
            className="shrink-0 text-xs text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            {S.activities.backToActivities}
          </Link>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" title={detail.title}>
              {detail.title}
            </h2>
            <p className="truncate text-xs text-gray-500">
              {detail.productCode} / {detail.refNum} · {S.activities.collection}:{" "}
              {detail.collectionId}
            </p>
          </div>
          <p aria-live="polite" className={`text-xs ${dirty ? toneInk.attention : toneInk.muted}`}>
            {dirty ? S.activities.unsaved : S.activities.draftStatus[detail.draft.status]}
          </p>
          <Button
            size="sm"
            disabled={busy || !available}
            onClick={() => {
              if (!dirty || window.confirm(S.activities.discard))
                void action(async () => {
                  const value = await apiFetch<ActivityDetail>(endpoint);
                  if (alive.current) accept(value);
                });
            }}
          >
            {S.activities.reload}
          </Button>
        </>
      }
      notices={
        <>
          {!available && (
            <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
              {S.activities.unavailable}
            </p>
          )}
          {available && !editable && (
            <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
              {S.activities.readOnly}
            </p>
          )}
          {error && (
            <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
              {error}
            </p>
          )}
          {loadError && available && (
            <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
              {loadError}
            </p>
          )}
          {notice && (
            <p role="status" className={`text-xs ${toneInk.success}`}>
              {notice}
            </p>
          )}
          {changed && (
            <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
              {S.activities.remoteChanged}
            </p>
          )}
        </>
      }
      rail={(dismiss) => (
        <div className="flex min-h-0 flex-1 flex-col">
          {Object.keys(editedManifest?.assets ?? {}).length > 1 && (
            <div className="shrink-0 px-3 pt-2">
              <Select
                size="sm"
                label={S.activities.mediaLanguage}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {Object.keys(editedManifest?.assets ?? {}).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <StudioTreeView
            nodes={buildStudioTree(sections, tree)}
            section={section}
            selection={section === "scenes" && !board ? selection : null}
            onChoose={(target) => {
              if (target.kind === "section") {
                setSection(target.section);
                if (target.section === "scenes") setBoard(true);
              } else if (target.kind === "asset") {
                setSelected(target.selection);
                setBoard(false);
                setSection("scenes");
              }
              dismiss();
            }}
          />
          {editable && available && (
            <PipelineControls
              choice={pipelineChoice}
              pipeline={pipeline}
              blocked={pipelineBlocked}
              onChoose={setPipelineChoice}
              onRun={() => runStages()}
              onStop={stopStages}
            />
          )}
        </div>
      )}
    >
      {section === "scenes" && editedManifest && board ? (
        <Storyboard
          frames={frames}
          selected={boardScene}
          assetsOf={(sceneId) =>
            fullTree.scenes
              .find((scene) => scene.sceneId === sceneId)
              ?.categories.flatMap((category) => category.assets) ?? []
          }
          thumbnailUrl={(assetKey) =>
            `${endpoint}/media-image?${new URLSearchParams({
              language,
              assetKey,
              expectedRevision: detail.draft.contentRevision,
              ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
            })}`
          }
          onSelect={setBoardScene}
          onOpen={(sceneId, key) => {
            setKind("all");
            setSelected({ sceneId, key });
            setBoardScene(sceneId);
            setBoard(false);
          }}
          onPlay={() => setShowPanel({ key: "player", at: Date.now() })}
          onEditMedia={() => {
            const first = frames.find((frame) => frame.sceneId === boardScene)?.firstAssetKey;
            if (boardScene && first) setSelected({ sceneId: boardScene, key: first });
            setBoard(false);
          }}
          onAssemble={() => setSection("module")}
        />
      ) : section === "scenes" && editedManifest ? (
        <AssetEditor
          manifest={editedManifest}
          language={language}
          selection={selection}
          media={uploads}
          mediaLoading={uploadsLoading}
          onUpload={upload}
          runs={runs}
          endpoint={endpoint}
          editable={editable}
          disabled={busy || !available}
          mediaDirty={!!editedManifest && media !== pretty(detail.draft.mediaPlan?.manifest)}
          onSaveMedia={() => void save("media")}
          canGenerate={
            editable &&
            available &&
            detail.draft.status === "valid" &&
            !busy &&
            !running &&
            !dirty &&
            !!selectedAgent
          }
          canGenerateMedia={
            editable &&
            available &&
            detail.draft.status === "valid" &&
            !busy &&
            !running &&
            !dirty &&
            !!selectedAgent &&
            !codingAgentId
          }
          revision={detail.draft.contentRevision}
          canAccept={editable && available && !busy && !running && !dirty}
          canPreview={editable && available && !busy && !dirty}
          wafRoot={wafRoot}
          voices={voices}
          onChange={(value) => setMedia(pretty(value))}
          onGenerateAudio={(lang, assetKey, voice) =>
            startRun("generate-audio", { language: lang, assetKey, voice })
          }
          onGenerateImage={(lang, assetKey) =>
            startRun("generate-image", { language: lang, assetKey })
          }
          onAcceptAudio={(runId) => acceptRun(runId, "accept-audio")}
          onAcceptImage={(runId) => acceptRun(runId, "accept-image")}
          onGenerateText={(lang, assetKey) =>
            startRun("generate-media-text", { language: lang, assetKey })
          }
          onAcceptText={(runId) => acceptRun(runId, "accept-media-text")}
          sceneNav={sceneNav}
        />
      ) : section === "description" ? (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScriptEditor
            value={description}
            saved={detail.draft.description}
            proposal={scriptProposal}
            access={!available ? "read" : editable ? "edit" : "disabled"}
            status={scriptStatus}
            canSave={editable}
            saveDisabled={busy || description === detail.draft.description}
            acceptBlocked={dirty ? S.activities.studioProposal.saveFirst : null}
            onChange={setDescription}
            onSave={() => void save("description")}
            onAcceptProposal={
              editable && available && scriptProposal !== null
                ? () => void acceptProposal({ target: "description", text: scriptProposal })
                : undefined
            }
          />
          {editable && (
            <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-gray-200 p-4 dark:border-gray-800">
              <div className="mx-auto max-w-4xl">
                <div className="space-y-3">
                  <Select
                    size="sm"
                    label={S.activities.agent}
                    value={selectedAgent}
                    onChange={(e) => setAgentId(e.target.value)}
                    disabled={busy || running}
                  >
                    <optgroup label={S.activities.penguinAgents}>
                      {agents.map((agent) => (
                        <option key={agent.agentId} value={agent.agentId}>
                          {agent.name ?? agent.agentId}
                        </option>
                      ))}
                    </optgroup>
                    {codingAgents.length > 0 && (
                      <optgroup label={S.activities.codingAgents}>
                        {codingAgents.map((agent) => (
                          <option key={agent.id} value={`coding:${agent.id}`}>
                            {agent.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                  {codingAgentId && (
                    <p className="text-xs text-gray-500">{S.activities.codingAgentMedia}</p>
                  )}
                  {dirty && (
                    <p className={`text-xs ${toneInk.attention}`}>{S.activities.saveFirst}</p>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || running || dirty || !selectedAgent || !description.trim()}
                    onClick={() =>
                      void action(async () => {
                        const run = await apiFetch<ActivityRun>(`${endpoint}/generate-spec`, {
                          method: "POST",
                          body: {
                            ...runner,
                            expectedRevision: detail.draft.contentRevision,
                          },
                        });
                        if (alive.current) {
                          setRuns((previous) => [
                            summarize(run),
                            ...previous.filter((item) => item.runId !== run.runId),
                          ]);
                          setRefreshVersion((value) => value + 1);
                        }
                      })
                    }
                  >
                    {S.activities.generate}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-4xl space-y-5">
              {section === "specification" && (
                <>
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">{S.activities.sceneReview}</h3>
                    <SceneReview spec={detail.draft.spec} />
                  </section>
                  <details
                    className="space-y-2"
                    open={specOpen}
                    onToggle={(event) => setSpecOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-xs font-medium">
                      {S.activities.advancedSpec}
                    </summary>
                    <Textarea
                      size="sm"
                      label={S.activities.spec}
                      rows={15}
                      className="font-mono"
                      value={spec}
                      onChange={(e) => setSpec(e.target.value)}
                      disabled={available && (!editable || busy)}
                      readOnly={!available}
                      spellCheck={false}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {editable && (
                        <Button
                          size="sm"
                          disabled={busy || !spec.trim() || spec === pretty(detail.draft.spec)}
                          onClick={() => void save("spec")}
                        >
                          {S.activities.saveSpec}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={spec === pretty(detail.draft.spec)}
                        onClick={() => setDiffOpen((value) => !value)}
                      >
                        {diffOpen ? S.activities.diffHide : S.activities.diffShow}
                      </Button>
                    </div>
                    {diffOpen && (
                      <SpecDiffView
                        saved={pretty(detail.draft.spec)}
                        edited={spec}
                        onRevert={
                          editable && !busy ? () => setSpec(pretty(detail.draft.spec)) : undefined
                        }
                      />
                    )}
                  </details>
                </>
              )}
              {section === "scenes" && (
                <>
                  <section className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {S.activities.mediaTitle}
                      <InfoPopover label={S.activities.mediaTitle}>
                        <p>{S.activities.mediaHelp}</p>
                        <p>{S.activities.speechHelp}</p>
                        <p>{S.activities.imageHelp}</p>
                        <p>{S.activities.textHelp}</p>
                      </InfoPopover>
                    </h3>
                    {editable && (
                      <Button
                        size="sm"
                        disabled={
                          busy ||
                          running ||
                          dirty ||
                          detail.draft.status !== "valid" ||
                          !detail.draft.spec
                        }
                        onClick={() =>
                          void action(async () => {
                            const draft = await apiFetch<ActivityDraft>(`${endpoint}/plan-media`, {
                              method: "POST",
                              body: { expectedRevision: detail.draft.contentRevision },
                            });
                            if (alive.current) {
                              accept({ ...detail, draft });
                              setNotice(S.activities.saved);
                            }
                          })
                        }
                      >
                        {detail.draft.mediaPlan
                          ? S.activities.rebuildMedia
                          : S.activities.planMedia}
                      </Button>
                    )}
                  </section>
                </>
              )}
              {section === "speech" && editedManifest && (
                <SpeechCoverage
                  assets={editedManifest.assets[language] ?? []}
                  language={language}
                  editable={editable}
                  canGenerate={
                    editable &&
                    available &&
                    !busy &&
                    !running &&
                    !dirty &&
                    !!selectedAgent &&
                    !codingAgentId
                  }
                  onSelect={(key) => {
                    const usage = (editedManifest.assets[language] ?? [])
                      .find((entry) => entry.key === key)
                      ?.usages.map((entry) => entry.sceneId)[0];
                    // A narration is only in the tree while the filter admits audio, and
                    // a filter left on images would drop the selection and open whatever
                    // came first instead.
                    setKind((current) => (current === "all" ? current : "audio"));
                    setSelected({ sceneId: usage ?? "", key });
                    setBoard(false);
                    setSection("scenes");
                  }}
                  onGenerateAll={(keys) =>
                    setSpeechQueue({ language, voice: voices[0] ?? "", keys })
                  }
                  queued={speechQueue?.keys.length ?? 0}
                  onCancelQueue={() => setSpeechQueue(null)}
                />
              )}
              {section === "library" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">{S.activities.libraryTitle}</h3>
                  {uploadsLoading ? (
                    <p role="status" className="text-xs text-gray-500">
                      {S.activities.libraryLoading}
                    </p>
                  ) : !uploads.length ? (
                    <p className="text-xs text-gray-500">{S.activities.librarySectionEmpty}</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">
                        {S.activities.libraryCount(uploads.length)}
                      </p>
                      <ul className="space-y-1">
                        {uploads.map((entry) => (
                          <li
                            key={entry.path}
                            className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-800"
                          >
                            <span className="min-w-0 break-all">{entry.name}</span>
                            <span className="shrink-0 text-gray-500">
                              {S.activities.mediaTypes[entry.kind]} ·{" "}
                              {fileSizeText(entry.byteLength)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}
              {(section === "configuration" || section === "assessment") && (
                <ModuleDocumentView
                  endpoint={endpoint}
                  kind={section}
                  revision={detail.draft.contentRevision}
                />
              )}
              {section === "module" && (
                <>
                  <BuildPanel
                    endpoint={endpoint}
                    revision={detail.draft.contentRevision}
                    wafRoot={wafRoot}
                    runs={runs}
                    unsaved={dirty}
                    proposalOpen={!!proposal.read?.proposal?.changes.length}
                  >
                    {(blocked) =>
                      editable && (
                        <div className="space-y-3">
                          {detail.activityType === "book" && (
                            <>
                              <h3 className="flex items-center gap-2 text-xs font-semibold">
                                {S.activities.readingMode}
                                <InfoPopover label={S.activities.readingMode}>
                                  <p>{S.activities.readingModeHelp}</p>
                                </InfoPopover>
                              </h3>
                              <Select
                                size="sm"
                                aria-label={S.activities.readingMode}
                                hint={S.activities.readingModeHint}
                                value={bookMode}
                                onChange={(e) => setBookMode(e.target.value as typeof bookMode)}
                                disabled={busy || running}
                              >
                                <option value="">{S.activities.chooseReadingMode}</option>
                                <option value="readAlong">{S.activities.readAlong}</option>
                                <option value="decodable">{S.activities.decodable}</option>
                              </Select>
                            </>
                          )}
                          <Input
                            size="sm"
                            label={S.activities.wafRoot}
                            value={wafRoot}
                            onChange={(event) => setWafRoot(event.target.value)}
                            disabled={busy || running}
                            hint={S.activities.wafRootHint}
                          />
                          <Button
                            size="sm"
                            disabled={
                              blocked ||
                              busy ||
                              running ||
                              dirty ||
                              !selectedAgent ||
                              detail.draft.status !== "valid" ||
                              !detail.draft.spec ||
                              (detail.activityType === "book" &&
                                (!bookMode || !detail.draft.mediaPlan))
                            }
                            onClick={() =>
                              void action(async () => {
                                const run = await apiFetch<ActivityRun>(
                                  `${endpoint}/assemble-module`,
                                  {
                                    method: "POST",
                                    body: {
                                      ...runner,
                                      expectedRevision: detail.draft.contentRevision,
                                      wafRoot: wafRoot.trim() || undefined,
                                      ...(detail.activityType === "book" ? { bookMode } : {}),
                                    },
                                  },
                                );
                                if (alive.current) {
                                  setRuns((previous) => [
                                    summarize(run),
                                    ...previous.filter((item) => item.runId !== run.runId),
                                  ]);
                                  setRefreshVersion((value) => value + 1);
                                }
                              })
                            }
                          >
                            {S.activities.assemble}
                          </Button>
                        </div>
                      )
                    }
                  </BuildPanel>
                  <SandboxPanel
                    projectId={projectId}
                    activityId={detail.id}
                    spec={detail.draft.spec}
                    languages={Object.keys(detail.draft.mediaPlan?.manifest.assets ?? {})}
                  />
                  {available && (
                    <ModulePreview
                      runs={runs}
                      spec={detail.draft.spec}
                      languages={Object.keys(detail.draft.mediaPlan?.manifest.assets ?? {})}
                      stale={(() => {
                        const moduleRun = latestModuleRun(runs);
                        return Boolean(
                          moduleRun && moduleRun.inputRevision !== detail.draft.contentRevision,
                        );
                      })()}
                    />
                  )}
                </>
              )}
              {section === "history" && available && (
                <>
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">{S.activities.runs}</h3>
                    {runs.length === 0 && (
                      <p className="text-xs text-gray-500">{S.activities.noRuns}</p>
                    )}
                    {runs.map((run) => (
                      <article
                        key={run.runId}
                        className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs">
                            {run.kind === "module"
                              ? S.activities.moduleRun
                              : run.kind === "audio"
                                ? S.activities.audioRun
                                : run.kind === "image"
                                  ? S.activities.imageRun
                                  : run.kind === "media-text"
                                    ? S.activities.textRun
                                    : run.kind === "assist"
                                      ? S.activities.assistRun
                                      : S.activities.specRun}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${toneSurface[runTone[run.status]]}`}
                          >
                            {run.kind === "module" && run.status === "succeeded"
                              ? S.activities.moduleReady
                              : run.kind === "audio" ||
                                  run.kind === "image" ||
                                  run.kind === "media-text"
                                ? S.activities.speechStatus[run.status]
                                : S.activities.status[run.status]}
                          </span>
                          <time className="text-xs text-gray-500" dateTime={run.createdAt}>
                            {new Date(run.createdAt).toLocaleString()}
                          </time>
                        </div>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.status === "running" && (
                          <p className="text-xs text-gray-500">{S.activities.runningHelp}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                          {run.kind === "module" && run.status === "succeeded" && run.sessionId && (
                            <a
                              className="text-xs underline"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={`/api/sessions/${encodeURIComponent(run.sessionId)}/files/preview-redirect?path=preview%2Findex.html`}
                            >
                              {S.activities.previewModule}
                            </a>
                          )}
                          {run.kind === "module" &&
                            run.inputRevision !== detail.draft.contentRevision && (
                              <span className={`text-xs ${toneInk.attention}`}>
                                {S.activities.olderModule}
                              </span>
                            )}
                          {run.sessionId && (
                            <Link
                              className="text-xs underline"
                              to={`/chat/${encodeURIComponent(run.sessionId)}`}
                            >
                              {S.activities.openSession}
                            </Link>
                          )}
                          {editable && run.status === "running" && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  const result = await apiFetch<ActivityRun>(
                                    `${endpoint}/runs/${run.runId}/cancel`,
                                    { method: "POST", body: {} },
                                  );
                                  if (alive.current)
                                    setRuns((previous) =>
                                      previous.map((item) =>
                                        item.runId === result.runId ? summarize(result) : item,
                                      ),
                                    );
                                })
                              }
                            >
                              {S.activities.cancel}
                            </Button>
                          )}
                        </div>
                        {run.hasCandidate && (
                          <CandidateReview
                            endpoint={`${endpoint}/runs/${encodeURIComponent(run.runId)}/candidate`}
                            editable={editable && run.kind === "spec"}
                            busy={busy}
                            onUse={(candidate) => {
                              if (!dirty || window.confirm(S.activities.discard)) {
                                setSpec(candidate);
                                setSpecOpen(true);
                              }
                            }}
                          />
                        )}
                      </article>
                    ))}
                  </section>
                </>
              )}
              {section === "specification" && editedManifest && detail.draft.mediaPlan && (
                <>
                  <ul className="space-y-1 text-xs">
                    {Object.entries(detail.draft.mediaPlan?.manifest.assets).map(
                      ([language, assets]) => (
                        <li key={language}>
                          {language}:{" "}
                          {S.activities.mediaCounts(
                            assets.length,
                            assets.filter((asset) => !!asset.path).length,
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                  <details
                    className="space-y-2"
                    open={mediaOpen}
                    onToggle={(event) => setMediaOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-xs font-medium">
                      {S.activities.advancedMedia}
                    </summary>
                    <Textarea
                      size="sm"
                      label={S.activities.mediaManifest}
                      rows={12}
                      className="font-mono"
                      value={media}
                      onChange={(event) => setMedia(event.target.value)}
                      spellCheck={false}
                      disabled={available && (!editable || busy)}
                      readOnly={!available}
                      hint={S.activities.mediaPathHint}
                    />
                  </details>
                  {editable && (
                    <Button
                      size="sm"
                      disabled={
                        busy || !media.trim() || media === pretty(detail.draft.mediaPlan?.manifest)
                      }
                      onClick={() => void save("media")}
                    >
                      {S.activities.saveMedia}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </WorkspaceShell>
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function summarize({ candidate, ...run }: ActivityRun): ActivityRunSummary {
  return { ...run, hasCandidate: candidate !== null };
}

function CandidateReview({
  endpoint,
  editable,
  busy,
  onUse,
}: {
  endpoint: string;
  editable: boolean;
  busy: boolean;
  onUse: (candidate: string) => void;
}) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (pending.current || candidate !== null) return;
    pending.current = true;
    setError("");
    try {
      const result = await apiFetch<{ candidate: string | null }>(endpoint);
      if (alive.current) setCandidate(result.candidate ?? "");
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      pending.current = false;
    }
  }
  return (
    <details
      className="text-xs"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="cursor-pointer">{S.activities.candidate}</summary>
      {error ? (
        <div className="my-2 space-y-2">
          <p role="alert" className={toneInk.danger}>
            {error}
          </p>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      ) : (
        <pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 dark:bg-gray-900">
          {candidate ?? S.activities.loading}
        </pre>
      )}
      {editable && (
        <Button size="sm" disabled={busy || candidate === null} onClick={() => onUse(candidate!)}>
          {S.activities.useCandidate}
        </Button>
      )}
    </details>
  );
}
