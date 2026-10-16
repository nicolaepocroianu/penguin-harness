import { stageAgent } from "./stage-agent";
import { OpenModuleDialog } from "./open-module-dialog";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useBlocker,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import type {
  ActivityRecord,
  ActivityRunSummary,
  ActivitySummary,
  PipelineSelection,
  PipelineState,
  SoundProviderId,
  SpeechProviderId,
  SpeechProviderStatus,
  ElevenLabsVoicesProblem,
  MediaStat,
  UploadedMedia,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { toastAttention, toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { discoverCodingAgents, listCodingAgents } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatMonthDay, localYmd } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { startedUnlistedRuns, shouldReloadList } from "../../lib/activity-sessions";
import { subscribeActivityListStale } from "../../lib/activity-run-events";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { InfoPopover } from "../../components/ui/info-popover";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { AssetLibraryView } from "./asset-library-view";
import { settledPipeline, settledRuns, type Announcement } from "./run-toasts";
import { CreateActivityDialog } from "./create-activity-dialog";
import { ActivityWorkspace as WorkspaceShell, type StudioPanelEntry } from "./activity-workspace";
import { AssetEditor } from "./asset-editor";
import { SpeechCoverage } from "./speech-coverage";
import { BookWordsPanel } from "./book-words-panel";
import { withoutBookWords, wordsWithoutSounds } from "./book-words";
import { speechTally } from "./bulk-speech";
import { bulkSoundProvider, pendingSoundKinds } from "./bulk-sound";
import { buildSceneTree, filterTree, treeSelections, type SceneAssetType } from "./scene-assets";
import { firstSelection, sameSelection, type SceneAssetSelection } from "./scene-asset-tree";
import {
  resolveSection,
  workspaceSections,
  type StudioPanel,
  sectionFromParam,
  type WorkspaceSection,
} from "./workspace-model";
import { assetForPick, buildStudioTree, sectionTrails } from "./studio-tree";
import { sceneRanges } from "./script-model";
import { buildScriptMedia, clipSelection } from "./script-media";
import { SpecScenesView, readSpecView, writeSpecView, type SpecView } from "./spec-scenes-view";
import { Segmented } from "../../components/ui/segmented";
import type { SavedReview, ScriptReview } from "./script-editor";
import { ConversationPanel } from "./conversation-panel";
import { conversationThreads, focusFor } from "./conversation";
import type { ProposalChange } from "./proposal";
import { ScriptEditor } from "./script-editor";
import { PipelineControls, PipelinePanel } from "./pipeline-panel";
import { placeholderAssets, storyboardFrames, type StoryboardFrame } from "./storyboard";
import { mediaPreview } from "./media-preview";
import { Storyboard } from "./storyboard-view";
import { ChecksPanel } from "./checks-panel";
import { ModuleDocumentView } from "./module-document-view";
import { ActivityStatsView } from "./activity-stats-view";
import { RefSwitcher } from "./ref-switcher";
import { CreateRefView } from "./create-ref-view";
import { ImplementationFeaturesView } from "./implementation-features-view";
import { GenerationHistory } from "./history-section";
import { DeployPanel } from "./deploy-panel";
import { useAssistProposal, type ProposalRead } from "./use-assist-proposal";
import { StudioTreeView } from "./studio-tree-view";
import { ProposalWaiting, RunningChip, runFollow } from "./studio-status";
import { JourneySteps, NextStepButton } from "./journey-header";
import {
  deployFacts,
  journeySteps,
  moduleFacts,
  nextStep,
  readinessItems,
  stepOf,
  type JourneyFacts,
  type JourneyTarget,
} from "./journey-model";
import { SandboxPanel } from "./sandbox-panel";
import { sandboxHasModule } from "./sandbox";
import { JsonEditor } from "./json-editor";
import { playingModuleRunId } from "./preview";
import { indexRuns } from "./runs-index";
import { activityApi, projectActivitiesApi, type RunStart } from "./activity-api";
import { ActivityClientContext, runStarted, summarize } from "./activity-client";
import { ResourceCache } from "./resource-cache";
import { useResource } from "./use-resource";
import { NO_PLACEHOLDERS, bindingOf, type PlaceholderPaths } from "./placeholder-media";
import { StudioSkeleton } from "./studio-skeleton";
import { ConflictNotice } from "./conflict-notice";
import { pretty, type DraftBlock } from "./studio-draft";
import { sameValue } from "./draft-merge";
import { pollWhileVisible } from "./visible-poll";
import { stagesHistoryReader } from "./stages-history";
import { useStudioDraft } from "./use-studio-draft";
import { ActivityList } from "./activity-list";
import { ProjectMediaView } from "./project-media-view";
import type { GroupSort } from "./activity-groups";
import { UnsavedWorkProvider, useUnsavedWork, useUnsavedWorkGuard } from "./unsaved-work-context";
import type { ShownAsset } from "./unsaved-work";
import { playerCheckVersion, useChecks } from "./use-checks";
import { videosToCheck } from "./scene-video";
import { applyVoice, optionsFromVoices } from "./voice-catalogue";
import {
  applyProvider,
  isElevenLabsVoiceId,
  sharedProvider,
  speechChoice,
  wordCatalogue,
} from "./speech-provider";

/** No run read yet: one array, so the runs index is built once for it. */
const NO_RUNS: ActivityRunSummary[] = [];
/** The language table before it is read, or when what came back is not one. */
const NO_LANGUAGES = {
  defaultLanguage: "en-US",
  languages: [] as { code: string; label: string }[],
};
/** Speech, sound and image runs belong to the builtin Media Agent, whoever runs the stages. */
const MEDIA_RUNNER = { agentId: "media_agent" };
/** How long the list waits after a run finishes for others finishing with it, before one reload. */
const RUN_FINISHED_SETTLE_MS = 300;
/** The phone header's way back to the list, an arrow pointing left. */
const BACK_ICON = "M15 18l-6-6 6-6M9 12h12";

/** A stage sequence the panels can draw, or null for an answer that is not one. */
function pipelineOrNull(value: unknown): PipelineState | null {
  const state = value as PipelineState | null;
  return state && Array.isArray(state.steps) && typeof state.status === "string" ? state : null;
}

/** `next`, or the value held when it is the same, which React then leaves unrendered. */
function unlessSame<T>(next: T): (held: T) => T {
  return (held) => (sameValue(held, next) ? held : next);
}

function announce({ kind, text }: Announcement) {
  if (kind === "success") toastSuccess(text);
  else if (kind === "error") toastError(text);
  else if (kind === "attention") toastAttention(text);
  else toastInfo(text);
}

export function ActivitiesPage() {
  useLocale();
  useDocumentTitle(S.activities.title);
  const { currentProject, unavailableProjectId } = useProject();
  const previousProject = useRef(currentProject);
  if (currentProject) previousProject.current = currentProject;
  const project =
    currentProject ??
    (previousProject.current?.projectId === unavailableProjectId ? previousProject.current : null);
  if (!project) return <EmptyState title={S.activities.noProject} />;
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const media = useMatch("/activities/media") !== null;
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ActivitySummary>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Kept here rather than in the list, so opening an activity and coming back keeps them.
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<GroupSort>("recent");
  const [openModules, setOpenModules] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // The studio's unsaved work, and the one dialog that asks before any of it is thrown away.
  const { guard, modal } = useUnsavedWorkGuard();
  const leavingLoses = useCallback(() => guard.work.lost({ kind: "activity" }).length > 0, [guard]);
  const mounted = useRef(true);
  const accessible = useRef(available);
  accessible.current = available;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Read through a ref so `reload` keeps one identity across opening and leaving an activity.
  const openActivityId = useRef(activityId);
  openActivityId.current = activityId;
  // Reloads can overlap (a live-status reload while the first load is in flight) and finish
  // out of order. Each request takes a number, and a response applies only when it is newer
  // than the last one applied, so an older response never overwrites fresher records or status.
  const requested = useRef(0);
  const appliedItems = useRef(0);
  const appliedSummaries = useRef(0);
  const reload = useCallback(async () => {
    if (!accessible.current) return;
    // Inside an activity (a studio save, say) only the records are needed: the summaries
    // fan out over every activity, and the return-to-list reload fetches them fresh.
    const withSummaries = openActivityId.current === undefined;
    const request = ++requested.current;
    try {
      const result = await projectActivitiesApi(projectId).list(withSummaries);
      if (mounted.current) {
        if (request > appliedItems.current) {
          appliedItems.current = request;
          setItems(result.activities);
          setError("");
        }
        if (withSummaries && request > appliedSummaries.current) {
          appliedSummaries.current = request;
          setSummaries(result.summaries ?? {});
        }
      }
    } catch (e) {
      if (mounted.current && request === requested.current) setError(apiErrorText(e));
    } finally {
      if (mounted.current && request === requested.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // Live refresh: the server says when one of this Project's activity runs finishes, and the
  // list re-reads its cards then, only while it is shown (not inside an activity); so it does
  // when the event stream lost events it cannot replay, since a finish may be among them. A
  // pipeline can finish several runs at once, so the signals in a short window share one reload.
  useEffect(() => {
    if (activityId) return;
    let timer: number | undefined;
    const unsubscribe = subscribeActivityListStale((staleProjectId) => {
      if (staleProjectId !== null && staleProjectId !== projectId) return;
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void reload();
      }, RUN_FINISHED_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [activityId, projectId, reload]);
  // A run started elsewhere after the store loaded has no row, only a live status: reload on
  // its start, so its card says it is running until the server says it finished.
  const { sessions, liveStatuses } = useSessions();
  const seenLive = useRef<ReadonlyMap<string, string>>(liveStatuses);
  useEffect(() => {
    if (!activityId && startedUnlistedRuns(seenLive.current, liveStatuses, sessions)) void reload();
    seenLive.current = liveStatuses;
  }, [liveStatuses, sessions, activityId, reload]);
  // A run can finish while the user is still inside that activity's own workspace — the list
  // does not listen then, since it only listens while `!activityId`, so that finish is
  // missed there. Coming back to the list is itself a reason to check again:
  // `prevActivityId` starts undefined, so the list's own first mount does not double-reload.
  const prevActivityId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldReloadList(prevActivityId.current, activityId)) void reload();
    prevActivityId.current = activityId;
  }, [activityId, reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (leavingLoses()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [leavingLoses]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && leavingLoses(),
  );
  // Ask once per blocked *attempt*, not merely once per "unblocked -> blocked" edge: a
  // Cancel's `blocker.reset()` and the very next navigation's own block can land in the same
  // React batch (e.g. a browser-back thrown right after dismissing the previous dialog), and
  // React is then free to skip rendering the intermediate "unblocked" state entirely — this
  // effect would never see it and would wrongly treat the new attempt as already answered.
  // Each blocked attempt is a new blocker object, so its identity survives that skip.
  const askedFor = useRef<typeof blocker | null>(null);
  useEffect(() => {
    if (blocker.state !== "blocked") {
      askedFor.current = null;
      return;
    }
    if (askedFor.current === blocker) return;
    askedFor.current = blocker;
    guard.confirm(
      { kind: "activity" },
      () => blocker.proceed(),
      () => blocker.reset(),
    );
  }, [blocker, guard]);
  // Switching or deleting a Project while dirty asks through the same dialog. The caller
  // (setCurrentProjectId / deleteProject / the removed-selection reload) awaits this, so its
  // own success/error handling runs on whichever answer actually happened — declining
  // resolves false right away, discarding drops the unsaved work and resolves true.
  const projectChangeGuard = useCallback(() => {
    if (!leavingLoses()) return true;
    return new Promise<boolean>((resolve) => {
      guard.confirm(
        { kind: "activity" },
        () => resolve(true),
        () => resolve(false),
      );
    });
  }, [guard, leavingLoses]);
  useLayoutEffect(
    () => registerProjectChangeGuard(projectChangeGuard),
    [registerProjectChangeGuard, projectChangeGuard],
  );
  if (!activityId && searchParams.get("view") === "media")
    return <Navigate to="/activities/media" replace />;
  if (media) return <ProjectMediaView projectId={projectId} available={available} />;
  if (activityId) {
    // The workspace fills this pane and scrolls inside itself, so nothing may wrap it
    // in a scroller or a max-width column.
    return (
      <div className="h-full min-h-0">
        <UnsavedWorkProvider value={guard}>
          <ActivityEditor
            key={activityId}
            projectId={projectId}
            activityId={activityId}
            editable={editable}
            available={available}
            onSaved={reload}
            onDeleted={(title) => {
              // Nothing unsaved is worth keeping in an activity that is gone.
              guard.work.discard(guard.work.held());
              announce({ kind: "success", text: S.activities.deleteActivity.deleted(title) });
              void reload();
              navigate("/activities");
            }}
          />
        </UnsavedWorkProvider>
        {modal}
      </div>
    );
  }
  return (
    <>
      <ActivityList
        items={items}
        loading={loading}
        error={error}
        editable={editable}
        available={available}
        createDisabled={leavingLoses()}
        projectId={projectId}
        summaries={summaries}
        sort={sort}
        onSort={setSort}
        search={search}
        onSearch={setSearch}
        tag={tag}
        onTag={setTag}
        onRefresh={() => void reload()}
        onOpenFromModules={() => setOpenModules(true)}
        onCreate={() => setCreateOpen(true)}
        onMedia={() => navigate("/activities/media")}
      />
      {openModules && (
        <OpenModuleDialog
          projectId={projectId}
          onClose={() => setOpenModules(false)}
          onOpened={() => void reload()}
        />
      )}
      {createOpen && (
        <CreateActivityDialog
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            guard.work.discard(guard.work.held());
            navigate(`/activities/${created}`);
          }}
        />
      )}
      {modal}
    </>
  );
}

function ActivityEditor({
  projectId,
  activityId,
  editable,
  available,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  activityId: string;
  editable: boolean;
  available: boolean;
  onSaved: () => Promise<void>;
  onDeleted: (title: string) => void;
}) {
  const { agents, currentAgent } = useProject();
  const navigate = useNavigate();
  // The spec reads as scenes once there is a saved spec to read, unless this viewer chose.
  const [specViewChoice, setSpecViewChoice] = useState<SpecView | null>(readSpecView);
  const [specViewDefault, setSpecViewDefault] = useState<SpecView | null>(null);
  const chooseSpecView = useCallback((view: SpecView) => {
    setSpecViewChoice(view);
    writeSpecView(view);
  }, []);
  // The open section is mirrored into ?section= so a link can land on it; an unknown or
  // not-yet-available one falls back like any other choice.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sectionChoice, setSectionChoice] = useState<WorkspaceSection | null>(() =>
    sectionFromParam(searchParams.get("section")),
  );
  // Opening another section closes the one open: an editor there holding unsaved work (a
  // module document, a scene's timeline) asks first, through the unsaved-work guard.
  const unsaved = useUnsavedWork();
  const shownSection = useRef<WorkspaceSection>("description");
  const setSection = useCallback(
    (next: WorkspaceSection) =>
      unsaved.confirm({ kind: "section", from: shownSection.current, to: next }, () => {
        setSectionChoice(next);
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            params.set("section", next);
            return params;
          },
          { replace: true },
        );
      }),
    [setSearchParams, unsaved.confirm],
  );
  const [languageChoice, setLanguage] = useState("");
  const [kind, setKind] = useState<SceneAssetType | "all">("all");
  const [selected, setSelected] = useState<SceneAssetSelection | null>(null);
  // Controlled, so moving between sections does not close it.
  const [mediaOpen, setMediaOpen] = useState(false);
  const client = useMemo(
    () => ({
      api: activityApi(projectId, activityId),
      project: projectActivitiesApi(projectId),
      cache: new ResourceCache(),
    }),
    [projectId, activityId],
  );
  const { api, cache, project } = client;
  const runs = useResource(cache, api.runs.list).data ?? NO_RUNS;
  const [sandboxModule, setSandboxModule] = useState(false);
  const runIndex = indexRuns(runs);
  // An assembly with a Session to preview, or a module only the sandbox knows is there.
  const hasModule =
    sandboxModule ||
    runIndex.of("module").some((run) => run.status === "succeeded" && !!run.sessionId);
  const [refreshVersion, setRefreshVersion] = useState(0);
  // Whoever says the history changed (a view that started a run) has the poll read it now.
  useEffect(
    () => cache.watch(api.runs.list, () => setRefreshVersion((value) => value + 1)),
    [cache, api],
  );
  // The activity's run of its stages, as the server last reported it (pipeline-run.ts).
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  /** Every sequence the activity has run, newest first, for the Stages panel's history. */
  const [pipelineHistory, setPipelineHistory] = useState<PipelineState[]>([]);
  const [pipelineChoice, setPipelineChoice] = useState<PipelineSelection>("all");
  // The languages the product supports: what the activity may be translated into.
  // A table is kept only when it is one; anything else offers no language to add.
  const languageTable = useResource(cache, project.languages, "").data;
  const languageSetup =
    Array.isArray(languageTable?.languages) && typeof languageTable.defaultLanguage === "string"
      ? languageTable
      : NO_LANGUAGES;
  // The Scenes section opens on the storyboard; opening an asset leaves it for the editor.
  const [board, setBoard] = useState(true);
  /** A scene the rail asked the script to show; `at` tells a second ask from the first. */
  const [revealScene, setRevealScene] = useState<{ scene: number; at: number } | null>(null);
  /** A request to review the agent's proposed script, from the header or the chat. */
  const [reviewRequest, setReviewRequest] = useState<{ scene?: number; at: number } | null>(null);
  /** A request to compare the script with the saved one, from the conflict notice. */
  const [compareScript, setCompareScript] = useState<{ at: number } | null>(null);
  /** Where the script editor's review of a proposal stands, for the chat to say. */
  const [scriptReview, setScriptReview] = useState<ScriptReview | null>(null);
  /** A review of the proposed script set aside, kept while the author is elsewhere. */
  const savedReview = useRef<SavedReview | null>(null);
  /**
   * A proposed script the author has finished with, though its proposal stays open for its
   * other changes: once applied in part, it no longer waits on the author.
   */
  const [settledScript, setSettledScript] = useState<string | null>(null);
  const [boardScene, setBoardScene] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState<{ key: StudioPanel; at: number } | null>(null);
  // A run History should show with its transcript open, as when the running chip follows it.
  const [historyFocus, setHistoryFocus] = useState<{ runId: string; at: number } | null>(null);
  const { locale } = useLocale();
  // An excerpt on its way to the conversation's composer, from another panel.
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const takeExcerpt = useCallback(() => setExcerpt(null), []);
  const [loadError, setLoadError] = useState("");
  /** A Penguin agent id, or `coding:<id>` for an external coding agent. */
  const [agentId, setAgentId] = useState("");
  const selectedAgent = stageAgent(agentId, agents, currentAgent?.agentId);
  const { endpoint } = api;
  const running = runIndex.busy;
  const pipelineRunning = pipeline?.status === "running";
  const draft = useStudioDraft(
    {
      api,
      saved: onSaved,
      toast: toastSuccess,
    },
    { editable, available, running, stages: pipelineRunning, hasAgent: !!selectedAgent },
  );
  const { detail, description, spec, media, busy, error, changed, dirty, edited } = draft.state;
  const editedManifest = draft.state.manifest;
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
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const voices = voiceOptions.map((option) => option.id);
  // The voice bulk speech, retries and the stage sequence speak with where a narration names
  // none of its own; one per session.
  const [bulkVoiceChoice, setBulkVoice] = useState("");
  const bulkVoice = voices.includes(bulkVoiceChoice) ? bulkVoiceChoice : (voices[0] ?? "");
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
  // The queue moves on only when a poll reads that the last run finished, so while narrations
  // wait the poll goes on reading in a hidden tab.
  const speechQueued = useRef(false);
  speechQueued.current = !!speechQueue?.keys.length;
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const alive = useRef(true);
  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const value = await api.media.uploads();
      if (alive.current) setUploads(value.media);
    } catch (e) {
      if (alive.current) draft.fail(apiErrorText(e));
    } finally {
      if (alive.current) setUploadsLoading(false);
    }
  }, [api]);
  /** Read the file the author chose, store it, and hand back its binding reference. */
  const upload = useCallback(
    async (file: File) => {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000)
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      const stored = await api.media.upload({ name: file.name, dataBase64: btoa(binary) });
      await loadUploads();
      return stored;
    },
    [api, loadUploads],
  );
  useEffect(() => {
    if (!available || !editable) return;
    void loadUploads();
  }, [projectId, available, editable]);
  // The header's QA step reads the same deploy state the Deploy section does, through the
  // same cache entry: once when the activity opens, and again each time the author leaves
  // that section, where a deploy may have run. While the section is open its reads show here.
  const inDeploy = sectionChoice === "deploy";
  const deployRead = useResource(cache, api.deploy.state, available && !inDeploy ? "page" : null);
  // An answer without stages says nothing about QA, and the step stays unchecked; nor does a
  // read that failed, which the Deploy section reports itself.
  const deployState =
    !deployRead.error && Array.isArray(deployRead.data?.stages) ? deployRead.data : null;
  // The conversation the panel has open, whose proposal the studio shows; until the panel
  // says otherwise, the newest.
  const [threadRunId, setThreadRunId] = useState<string | null | undefined>(undefined);
  const proposal = useAssistProposal(
    api,
    threadRunId === undefined ? (conversationThreads(runIndex)[0]?.runId ?? null) : threadRunId,
  );
  // The proposed script, while it still differs from the saved one.
  const proposedScript = proposal.read?.proposal?.changes.find(
    (change) => change.target === "description",
  );
  // A script the author reviewed and applied in part is done with: the card shows only the
  // proposal's other changes.
  const scriptSettled = !!proposedScript && proposedScript.text === settledScript;
  const cardProposal: ProposalRead | null =
    scriptSettled && proposal.read?.proposal
      ? {
          ...proposal.read,
          proposal: {
            ...proposal.read.proposal,
            changes: proposal.read.proposal.changes.filter(
              (change) => change.target !== "description",
            ),
          },
        }
      : proposal.read;
  const scriptProposal =
    proposedScript &&
    detail &&
    proposedScript.text !== detail.draft.description &&
    proposedScript.text !== settledScript
      ? proposedScript.text
      : null;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []); // The editor is keyed by activity and the workspace by project.
  // A hidden tab reads nothing while no narration waits in the queue; it reads once on coming
  // back, then at the usual pace.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const stagesHistory = stagesHistoryReader(api.pipeline.history);
    async function refresh(): Promise<number> {
      const revisionAtStart = draft.revision;
      let active = false;
      try {
        // Following a run is a courtesy over the history, which stands without it. So is the
        // stages' history, read only when it can have changed.
        const current = api.pipeline.current().catch(() => null);
        const [value, history, sandbox, stages, sequences] = await Promise.all([
          api.detail(),
          api.runs.list.load(),
          // A module this project never assembled -- one Loom generated -- still has a
          // Module section; only the sandbox knows it is there.
          api.sandbox.status().catch(() => null),
          current,
          stagesHistory(current),
        ]);
        // The poll has stopped, so no next read waits on the delay.
        if (cancelled) return 0;
        setLoadError("");
        // An answer the same as the one held changes nothing on screen, so it is not set. That
        // also keeps a read of the runs in flight, which a put drops: it lands, with an answer
        // at least as new as this one.
        const held = cache.peek(api.runs.list);
        if (held.error !== null || !sameValue(held.data, history))
          cache.put(api.runs.list, history);
        setSandboxModule(sandboxHasModule(sandbox));
        if (stages) setPipeline(unlessSame(pipelineOrNull(stages.pipeline)));
        if (sequences) setPipelineHistory(unlessSame(sequences));
        active = indexRuns(history).busy || stages?.pipeline?.status === "running";
        draft.receive(value, revisionAtStart);
      } catch (e) {
        if (!cancelled) setLoadError(apiErrorText(e));
      }
      return active ? 2000 : 30_000;
    }
    const stop = pollWhileVisible(refresh, document, () => speechQueued.current);
    return () => {
      cancelled = true;
      stop();
    };
  }, [api, cache, refreshVersion, available]);
  // Background work announces itself when it settles, wherever the author has gone in
  // the workspace. While the stages run, their runs settle one after another, so only the
  // stages' own outcome is announced.
  const seenRuns = useRef<{
    endpoint: string;
    statuses: Map<string, ActivityRunSummary["status"]>;
  }>({ endpoint: "", statuses: new Map() });
  const seenPipeline = useRef<{ endpoint: string; status: PipelineState["status"] | null }>({
    endpoint: "",
    status: null,
  });
  useEffect(() => {
    const before = seenRuns.current.endpoint === endpoint ? seenRuns.current.statuses : new Map();
    if (pipeline?.status !== "running")
      for (const announcement of settledRuns(before, runs)) announce(announcement);
    seenRuns.current = {
      endpoint,
      statuses: new Map(runs.map((run) => [run.runId, run.status])),
    };
  }, [runs, endpoint, pipeline?.status]);
  useEffect(() => {
    const before = seenPipeline.current.endpoint === endpoint ? seenPipeline.current.status : null;
    const announcement = settledPipeline(before, pipeline);
    if (announcement) announce(announcement);
    seenPipeline.current = { endpoint, status: pipeline?.status ?? null };
  }, [pipeline, endpoint]);
  const codingAgentId = selectedAgent.startsWith("coding:") ? selectedAgent.slice(7) : null;
  /** Who runs a stage, as the stage routes take it. */
  // A coding agent's run is a Session too, owned by the Penguin agent the Project would use.
  const penguinAgent = currentAgent?.agentId ?? agents[0]?.agentId;
  const runner = codingAgentId
    ? { codingAgentId, ...(penguinAgent !== undefined ? { agentId: penguinAgent } : {}) }
    : { agentId: selectedAgent };
  // Which sound providers the Media Agent can use: it makes every sound, whoever runs the
  // other stages.
  const setupVersion = available && editable ? "" : null;
  const soundProviders = useResource(cache, project.sound, setupVersion).data?.providers ?? null;
  // Whether the scene-video experiment is on; the studio shows nothing of it until it is.
  const videoSetup = useResource(cache, project.video, setupVersion).data ?? null;
  // The voices, and which speech providers the Media Agent's Vault has keys for; then the
  // Media Agent's ElevenLabs library, which replaces the bare ElevenLabs default once it loads.
  const [speechProviders, setSpeechProviders] = useState<SpeechProviderStatus[] | null>(null);
  const [voiceLibrary, setVoiceLibrary] = useState<{
    problem: ElevenLabsVoicesProblem | null;
    loading: boolean;
  }>({ problem: null, loading: false });
  // Bumped by "Reload voices": the next read skips the server's ten-minute list.
  const [voiceLibraryReload, setVoiceLibraryReload] = useState(0);
  useEffect(() => {
    if (!available || !editable) return;
    let cancelled = false;
    void project
      .speech()
      .then(async (value) => {
        if (cancelled) return;
        // An older server sends the bare names only.
        const catalogue = Array.isArray(value.catalogue)
          ? wordCatalogue(value.catalogue)
          : optionsFromVoices(value.voices, value.model);
        setVoiceOptions(catalogue);
        setSpeechProviders(value.providers ?? null);
        if (!Array.isArray(value.catalogue)) return;
        setVoiceLibrary((state) => ({ ...state, loading: true }));
        try {
          const library = await project.elevenLabsVoices(voiceLibraryReload > 0);
          if (cancelled) return;
          setVoiceOptions([
            ...catalogue.filter((option) => option.providerId !== "elevenlabs"),
            ...wordCatalogue(library.voices),
          ]);
          setVoiceLibrary({ problem: library.problem ?? null, loading: false });
        } catch {
          // An older server has no list: the bare default stays.
          if (!cancelled) setVoiceLibrary({ problem: null, loading: false });
        }
      })
      .catch((e) => {
        if (!cancelled) draft.fail(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project, available, editable, voiceLibraryReload]);
  // Where the script's autosave stands, as the editor's status line says it.
  const scriptSave = draft.state.scriptSave;
  const scriptDirty = edited.description;
  const autosaveHeld = running || pipelineRunning;
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
  // Why Run cannot start the stages now. The server refuses the same cases; saying so
  // here saves the round trip, and says it in the author's terms.
  const pipelineBlocked = runBlockText(draft.can("stages"));
  const agentLabel = codingAgentId
    ? (codingAgents.find((agent) => agent.id === codingAgentId)?.title ?? codingAgentId)
    : (agents.find((agent) => agent.agentId === selectedAgent)?.name ?? selectedAgent);
  function runStages(
    stage: PipelineSelection = pipelineChoice,
    scope?: { language: string; assetKey?: string },
    soundProvider?: SoundProviderId,
  ) {
    void draft.act(async () => {
      if (!detail) return;
      const started = await api.pipeline.start({
        ...runner,
        stage,
        ...scope,
        ...(soundProvider ? { soundProvider } : {}),
        ...(bulkVoice ? { voice: bulkVoice } : {}),
      });
      if (!alive.current) return;
      setPipeline(pipelineOrNull(started));
      setShowPanel({ key: "run", at: Date.now() });
      cache.invalidate(api.runs.list);
    });
  }
  function stopStages() {
    void draft.act(async () => {
      const stopped = await api.pipeline.stop();
      if (alive.current) setPipeline(pipelineOrNull(stopped.pipeline));
    });
  }
  useEffect(() => {
    const next = speechQueue?.keys[0];
    if (!next || running || busy || dirty || !detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const run = await draft.send((api, revision) =>
          api.runs.start(
            "generate-audio",
            {
              ...MEDIA_RUNNER,
              language: speechQueue!.language,
              assetKey: next,
              // A narration speaks with its own provider and saved voice; the queue's voice
              // fills the rest where that provider speaks with it.
              ...speechChoice(
                detail.draft.mediaPlan?.manifest.assets[speechQueue!.language]?.find(
                  (asset) => asset.key === next,
                ),
                voiceOptions,
                speechQueue!.voice,
                speechQueue!.language,
              ),
            },
            revision,
          ),
        );
        if (cancelled || !alive.current) return;
        runStarted(client, run);
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
        draft.fail(apiErrorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [speechQueue, running, busy, dirty, detail, endpoint, voiceOptions]);
  /**
   * Start one generation run and show it at the top of the history immediately. Speech,
   * sound and image runs name the Media Agent, which makes them whoever runs the stages.
   */
  function startRun(
    path: RunStart,
    body: Record<string, unknown>,
    by: Record<string, string> = runner,
  ) {
    void draft.start(path, { ...by, ...body }, (run) => runStarted(client, run));
  }
  /**
   * Accept one change an agent proposed, through the route the author's own save uses, so
   * it is checked and recorded the same way. The author's unsaved edits are never
   * overwritten: the card will not offer Accept while there are any.
   */
  async function acceptProposal(change: ProposalChange): Promise<void> {
    await draft.act(() => draft.land(change));
  }
  /**
   * Apply the conversation's whole proposal as one draft change, read fresh from its run
   * by the server, so it lands whole or not at all.
   */
  async function applyWholeProposal(runId: string): Promise<void> {
    await draft.change((api, revision) => api.runs.applyProposal(runId, revision), {
      keep: "none",
      clean: true,
      then: () => toastSuccess(S.activities.saved),
    });
  }
  /**
   * Apply the proposed script as the author's review left it. A proposal that changed only
   * the script is then done with and set aside; one with other changes stays open for them.
   */
  async function applyReviewedScript(text: string): Promise<void> {
    const read = proposal.read;
    if (!proposedScript || !read) return;
    const onlyScript = changesOnlyScript(read);
    // One action, so the proposal is set aside only once the script has landed.
    const done = await draft.act(async () => {
      await draft.land({ target: "description", text });
      if (onlyScript) await discardRun(read.runId);
    });
    if (!done) return;
    if (onlyScript) proposal.reload();
    else setSettledScript(proposedScript.text);
  }
  /** The proposed script needs nothing more from the author. */
  function settleScriptProposal() {
    const read = proposal.read;
    if (!proposedScript || !read) return;
    if (changesOnlyScript(read)) void discardProposal(read.runId);
    else setSettledScript(proposedScript.text);
  }
  async function discardProposal(runId: string): Promise<void> {
    await draft.act(async () => {
      await discardRun(runId);
      proposal.reload();
    });
  }
  function discardRun(runId: string) {
    return api.runs.discardProposal(runId);
  }
  // The rail and the detail pane read one derivation, so they cannot disagree about
  // which language, which scene, or which asset is being shown.
  // A saved specification that asks an assessment can have one generated before any module.
  const usesAssessment =
    detail?.draft.status === "valid" &&
    (detail.draft.spec?.runtime as { usesAssessment?: unknown } | undefined)?.usesAssessment ===
      true;
  const sections = workspaceSections({
    hasSpec: !!detail?.draft.spec,
    hasPlan: !!detail?.draft.mediaPlan,
    hasModule,
    usesAssessment,
  });
  const section = resolveSection(
    sectionChoice,
    {
      hasSpec: !!detail?.draft.spec,
      hasPlan: !!detail?.draft.mediaPlan,
      hasModule,
      usesAssessment,
    },
    sectionChoice !== null && unsaved.work.holds(sectionChoice),
  );
  shownSection.current = section;
  // The saved draft's media stats, read once per revision while the scenes are open, for
  // the file details of a bound clip. Null when they could not be read.
  const statsRevision = detail?.draft.contentRevision ?? "";
  const wantMediaStats = section === "scenes" && !!detail?.draft.mediaPlan;
  const stats = useResource(cache, api.media.stats, wantMediaStats ? statsRevision : null);
  // Undefined while this revision's stats are on their way; null when they could not be read.
  let currentMediaStats: MediaStat[] | null | undefined;
  if (stats.version === statsRevision && stats.error) currentMediaStats = null;
  else if (stats.version === statsRevision && stats.data) currentMediaStats = stats.data.media;
  // The paths the server binds this ref's videos and animations to until real files replace
  // them; read again when the ref is renumbered, since each path carries the ref's number.
  const placeholderRead = useResource(
    cache,
    api.media.placeholders,
    detail ? String(detail.refNum) : null,
  );
  const placeholders = useMemo<PlaceholderPaths>(
    () => (placeholderRead.data ? new Set(placeholderRead.data.paths) : NO_PLACEHOLDERS),
    [placeholderRead.data],
  );
  const language = editedManifest?.assets[languageChoice]
    ? languageChoice
    : (Object.keys(editedManifest?.assets ?? {})[0] ?? "en-US");
  const tree = filterTree(
    buildSceneTree(
      detail?.draft.spec ?? null,
      editedManifest?.assets[language] ?? [],
      placeholders,
    ),
    kind,
  );
  // A selection the filter or a rebuilt plan removed falls back to the first leaf, so
  // the detail pane never points at an asset the tree no longer draws.
  const fullTree = buildSceneTree(
    detail?.draft.spec ?? null,
    editedManifest?.assets[language] ?? [],
    placeholders,
  );
  // What the media plan says about each line and scene of the script, for the editor's chips.
  // Keyed on the texts the manifest and tree are read from, so a render that changes neither
  // keeps the same object and the editor's review state is left alone.
  const scriptMedia = useMemo(
    () =>
      detail?.draft.mediaPlan
        ? buildScriptMedia(
            editedManifest?.assets[language] ?? [],
            fullTree,
            sceneRanges(description),
            placeholders,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail?.draft.mediaPlan, detail?.draft.spec, media, language, description, placeholders],
  );
  // What each clip of the shown language is bound to, for the spec read as scenes.
  const mediaBindings = useMemo(
    () =>
      detail?.draft.mediaPlan
        ? new Map(
            (editedManifest?.assets[language] ?? []).map((asset) => [
              asset.key,
              bindingOf(placeholders, asset.path),
            ]),
          )
        : null,
    [detail?.draft.mediaPlan, editedManifest, language, placeholders],
  );
  // Decided as the section opens: a spec arriving from a run while the JSON is open must
  // not swap the view under the author.
  const hasSpec = useRef(false);
  hasSpec.current = !!detail?.draft.spec;
  const detailLoaded = detail !== null;
  useEffect(() => {
    setSpecViewDefault(
      section === "specification" && detailLoaded ? (hasSpec.current ? "scenes" : "json") : null,
    );
  }, [section, detailLoaded]);
  const specView: SpecView = specViewChoice ?? specViewDefault ?? "json";
  const latestTree = useRef(fullTree);
  latestTree.current = fullTree;
  const openClip = useCallback(
    (key: string) => {
      const found = clipSelection(latestTree.current, key);
      if (!found) return;
      setSelected(found);
      setBoard(false);
      setSection("scenes");
    },
    [setSection],
  );
  const scriptScenes = sceneRanges(description);
  const frames = storyboardFrames(
    fullTree,
    runIndex,
    proposal.read?.proposal?.changes ?? [],
    language,
    {
      text: description,
      scenes: scriptScenes,
      ...(scriptMedia ? { clipFor: scriptMedia.clipFor } : {}),
    },
  );
  // What each asset of the shown language looks like where it is listed, read from the file
  // it plays from. The saved plan's binding, so a path being typed is not fetched per key.
  const savedAssets = detail?.draft.mediaPlan?.manifest.assets[language];
  const previewOf = (assetKey: string) =>
    mediaPreview(
      savedAssets?.find((asset) => asset.key === assetKey),
      endpoint,
      placeholders,
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
  /**
   * Show another asset in Scenes, or the storyboard in its place (`to` null): the asset
   * editor's unsaved work (a timeline, a file not saved yet) asks first.
   */
  const showAsset = (to: ShownAsset | null, then: () => void) =>
    unsaved.confirm({ kind: "asset", to }, then);
  const openFrame = (frame: StoryboardFrame | undefined) =>
    frame?.firstAssetKey
      ? {
          label: frameLabel(frame),
          open: () =>
            showAsset({ key: frame.firstAssetKey!, language }, () => {
              setKind("all");
              setSelected({ sceneId: frame.sceneId, key: frame.firstAssetKey! });
              setBoardScene(frame.sceneId);
            }),
        }
      : null;
  const openable = frames.filter((frame) => frame.firstAssetKey);
  const here = openable.findIndex((frame) => frame.sceneId === selection?.sceneId);
  const sceneNav =
    here >= 0
      ? {
          label: frameLabel(openable[here]!),
          onBoard: () =>
            showAsset(null, () => {
              setBoardScene(openable[here]!.sceneId);
              setBoard(true);
            }),
          previous: openFrame(openable[here - 1]),
          next: openFrame(openable[here + 1]),
        }
      : undefined;
  const languages = Object.keys(detail?.draft.mediaPlan?.manifest.assets ?? {});
  const playingRunId = playingModuleRunId(runIndex, detail?.draft.pinnedModuleRunId);
  const checks = useChecks(
    client,
    runs,
    detail?.draft.contentRevision ?? "",
    playingRunId,
    !!detail && available,
  );
  const panels: StudioPanelEntry[] = detail
    ? [
        {
          key: "player",
          label: S.activities.studioPanels.names.player,
          icon: "M8 5v14l11-7z",
          render: () => (
            <div className="space-y-6 p-3">
              <SandboxPanel
                projectId={projectId}
                activityId={detail.id}
                revision={detail.draft.contentRevision}
                moduleRunId={playingRunId}
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
                  showAsset({ key: found.key, language }, () => {
                    setSelected(found);
                    setBoard(false);
                    setSection("scenes");
                  });
                  return found.key;
                }}
              />
            </div>
          ),
        },
        {
          key: "run",
          label: S.activities.studioPanels.names.run,
          icon: "M5 6h10M5 12h14M5 18h7",
          render: () => (
            <div className="flex h-full min-h-0 flex-col">
              {editable && available && (
                <>
                  {/* While stages run, the controls below fold to one line naming the agent. */}
                  <div className={pipelineRunning ? "hidden" : "space-y-3 p-3"}>
                    <Select
                      size="sm"
                      label={S.activities.agent}
                      value={selectedAgent}
                      onChange={(e) => setAgentId(e.target.value)}
                      disabled={busy || running || pipelineRunning}
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
                  </div>
                  <PipelineControls
                    choice={pipelineChoice}
                    pipeline={pipeline}
                    agentLabel={agentLabel}
                    blocked={pipelineBlocked}
                    onChoose={setPipelineChoice}
                    onRun={() => runStages()}
                    onStop={stopStages}
                  />
                </>
              )}
              <div className="min-h-0 flex-1">
                <PipelinePanel
                  pipeline={pipeline}
                  history={pipelineHistory}
                  runs={runs}
                  agentLabel={agentLabel}
                  onAddExcerpt={(text) => {
                    setExcerpt(text);
                    setShowPanel({ key: "conversation", at: Date.now() });
                  }}
                />
              </div>
            </div>
          ),
        },
        ...(available
          ? [
              {
                key: "checks" as const,
                label: S.activities.studioPanels.names.checks,
                badge: checks.badge,
                icon: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9 12l2 2 4-4",
                render: () => (
                  <ChecksPanel
                    runs={runs}
                    editable={editable}
                    runner={selectedAgent ? runner : null}
                    revision={detail.draft.contentRevision}
                    playerCheckVersion={playerCheckVersion(playingRunId)}
                    testsBlocked={draft.can("tests")}
                    qualityBlocked={draft.can("quality")}
                  />
                ),
              },
            ]
          : []),
        {
          key: "conversation",
          label: S.activities.studioPanels.names.conversation,
          icon: "M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z",
          render: () => (
            <ConversationPanel
              runs={runs}
              runner={selectedAgent ? runner : null}
              revision={detail.draft.contentRevision}
              focus={
                section === "scenes" && board
                  ? { section, ...(boardScene ? { sceneId: boardScene, language } : {}) }
                  : focusFor(section, selection, language)
              }
              editable={editable}
              base={{
                description: detail.draft.description,
                spec: detail.draft.spec,
                manifest: detail.draft.mediaPlan?.manifest ?? null,
              }}
              dirty={dirty}
              onAccept={acceptProposal}
              proposal={cardProposal}
              onReplyEnded={proposal.reload}
              seed={excerpt}
              onSeedTaken={takeExcerpt}
              // Applying the whole proposal would bring back a reviewed script's rejected
              // changes, so once the script is settled the rest are accepted one by one.
              onApplyAll={
                proposal.read && !scriptSettled
                  ? () => applyWholeProposal(proposal.read!.runId)
                  : undefined
              }
              onDiscard={proposal.read ? () => discardProposal(proposal.read!.runId) : undefined}
              review={scriptReview}
              onReviewScript={(scene) => {
                setSection("description");
                setReviewRequest({ ...(scene !== undefined ? { scene } : {}), at: Date.now() });
              }}
              onThread={setThreadRunId}
            />
          ),
        },
      ]
    : [];
  if (!detail)
    return error || loadError ? (
      <div className="p-4">
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {error || loadError}
        </p>
      </div>
    ) : (
      // The section asked for, not the one it may fall back to once the draft says what exists.
      <StudioSkeleton section={sectionChoice ?? section} />
    );
  const runningRun = runIndex.running[0];
  // The journey: where each step stands, and what stands between the activity and QA.
  const journeyFacts: JourneyFacts = {
    status: detail.draft.status,
    hasSpec: !!detail.draft.spec,
    scriptDirty: edited.description,
    specDirty: edited.spec,
    media: scriptMedia?.totals ?? null,
    videosToCheck: videosToCheck(detail.draft.mediaPlan?.manifest.assets, runs),
    module: moduleFacts({
      builds: runIndex.of("module").filter((run) => run.status === "succeeded"),
      sandboxModule: hasModule,
      building: runIndex.isRunning("module"),
      revision: detail.draft.contentRevision,
    }),
    checks: checks.facts,
    deploy: deployState ? deployFacts(deployState) : null,
  };
  // A build's date as the viewer's own calendar day.
  const steps = journeySteps(journeyFacts, (iso) =>
    formatMonthDay(localYmd(new Date(iso)), locale),
  );
  const readiness = readinessItems(journeyFacts);
  const next = nextStep(journeyFacts, readiness);
  const canGo = (target: JourneyTarget) =>
    target.kind === "section"
      ? sections.some((entry) => entry.key === target.section && entry.enabled)
      : panels.some((entry) => entry.key === target.tool);
  const goTo = (target: JourneyTarget) => {
    if (target.kind === "section") setSection(target.section);
    else setShowPanel({ key: target.tool, at: Date.now() });
  };
  /** Opens where a run is followed: its tool, or its transcript in History. */
  const follow = (run: ActivityRunSummary) => {
    const where = runFollow(run, pipelineRunning);
    if (where.kind === "tool") {
      setShowPanel({ key: where.tool, at: Date.now() });
      return;
    }
    setSection("history");
    setHistoryFocus({ runId: where.runId, at: Date.now() });
  };
  // What the rail says beside each section: edits not yet saved, and how much there is.
  const railTrails = sectionTrails({
    descriptionDirty: edited.description,
    specDirty: edited.spec,
    mediaDirty: edited.media,
    draftStatus: detail.draft.status,
    scenes: fullTree,
  });
  return (
    <ActivityClientContext.Provider value={client}>
      <WorkspaceShell
        panels={panels}
        showPanel={showPanel}
        layout={{ section, onSection: setSection }}
        header={
          <>
            {/* The way back, the title and the ref stay together and give way first: the
                title truncates, and on a phone the product code steps aside. */}
            <nav
              aria-label={S.activities.breadcrumb}
              className="flex max-w-[40%] min-w-0 shrink items-center gap-1.5 text-sm"
            >
              <Link
                to="/activities"
                title={S.activities.backToActivities}
                className="-ml-1 shrink-0 rounded p-1 text-gray-500 hover:text-gray-800 sm:ml-0 sm:p-0 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <GlyphIcon d={BACK_ICON} size={ICON_SIZE.rowLead} className="sm:hidden" />
                <span className="sr-only sm:not-sr-only">{S.activities.backToActivities}</span>
              </Link>
              <span
                aria-hidden
                className="hidden shrink-0 text-gray-300 sm:inline dark:text-gray-600"
              >
                /
              </span>
              {/* The product code earns its place only when the title does not already say it. */}
              {detail.productCode !== detail.title && (
                <>
                  <span
                    className="hidden shrink-0 font-mono text-xs text-gray-500 sm:inline dark:text-gray-400"
                    title={`${S.activities.collection}: ${detail.collectionId}`}
                  >
                    {detail.productCode}
                  </span>
                  <span
                    aria-hidden
                    className="hidden shrink-0 text-gray-300 sm:inline dark:text-gray-600"
                  >
                    /
                  </span>
                </>
              )}
              <h2
                className="min-w-0 flex-1 truncate font-semibold sm:flex-initial"
                title={detail.title}
              >
                {detail.title}
              </h2>
              <RefSwitcher
                activity={detail}
                editable={editable && available}
                onIdentity={(record) => {
                  draft.updateRecord(record);
                  // A name or tags change shows on the list's cards, for every ref of the
                  // product; the list is kept while an activity is open, so refresh it now.
                  void onSaved();
                }}
                revision={detail.draft.contentRevision}
                onRenumbered={(value, from) => {
                  draft.renumbered(value, from);
                  announce({
                    kind: "success",
                    text: S.activities.studioRefs.renumbered(from, value.refNum),
                  });
                  // An assembled module keeps the old number in its file names.
                  if (hasModule)
                    announce({ kind: "attention", text: S.activities.studioRefs.reassemble });
                  void onSaved();
                }}
                onDeleted={() => onDeleted(detail.title)}
                // The new-ref table walks the media plan, so the way in waits for one.
                onNewRef={detail.draft.mediaPlan ? () => setSection("newRef") : undefined}
                // Reloading can throw edits away, so it sits in the ref's menu behind the
                // discard confirmation rather than in the header's busiest row.
                onReload={
                  busy || !available
                    ? undefined
                    : () => unsaved.confirm({ kind: "draftText" }, () => void draft.reload())
                }
              />
            </nav>
            <span aria-hidden className="h-6 w-px shrink-0 bg-gray-200 dark:bg-gray-800" />
            <JourneySteps steps={steps} current={stepOf(section)} canGo={canGo} onGo={goTo} />
            {scriptProposal !== null && editable && (
              <ProposalWaiting
                onReview={() => {
                  setSection("description");
                  setReviewRequest({ at: Date.now() });
                }}
              />
            )}
            {runningRun && <RunningChip run={runningRun} onFollow={() => follow(runningRun)} />}
            <NextStepButton next={next} items={readiness} onGo={goTo} />
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
            {changed && (
              <ConflictNotice
                conflicts={draft.state.conflicts}
                saved={detail.draft}
                timelines={draft.state.timelines}
                editable={editable && available}
                onResolve={(fields, choice) => draft.resolve(fields, choice)}
                onCompareScript={() => {
                  setSection("description");
                  setCompareScript({ at: Date.now() });
                }}
              />
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
                  onChange={(event) => {
                    const next = event.target.value;
                    showAsset(selection && { key: selection.key, language: next }, () =>
                      setLanguage(next),
                    );
                  }}
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
              nodes={buildStudioTree(sections, tree, railTrails, scriptScenes)}
              previewOf={previewOf}
              section={section}
              selection={section === "scenes" && !board ? selection : null}
              onChoose={(target) => {
                if (target.kind === "section" && target.section === "scenes")
                  showAsset(null, () => {
                    setSection("scenes");
                    setBoard(true);
                  });
                else if (target.kind === "section") setSection(target.section);
                else if (target.kind === "asset")
                  showAsset({ key: target.selection.key, language }, () => {
                    setSelected(target.selection);
                    setBoard(false);
                    setSection("scenes");
                  });
                else {
                  // A scene lives in the script; its row opens the script at its heading.
                  setSection("description");
                  setRevealScene({ scene: target.sceneNumber, at: Date.now() });
                }
                dismiss();
              }}
            />
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
            previewOf={previewOf}
            placeholders={placeholderAssets(fullTree)}
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
            onMediaCopied={() => void loadUploads()}
            runs={runs}
            endpoint={endpoint}
            editable={editable}
            draft={draft}
            mediaStats={currentMediaStats}
            placeholders={placeholders}
            voices={voiceOptions}
            defaultVoice={bulkVoice}
            onGenerateAudio={(lang, assetKey, voice, provider) =>
              startRun(
                "generate-audio",
                { language: lang, assetKey, voice, provider },
                MEDIA_RUNNER,
              )
            }
            soundProviders={soundProviders}
            speechProviders={speechProviders}
            voiceLibrary={voiceLibrary}
            onReloadVoices={() => setVoiceLibraryReload((value) => value + 1)}
            onGenerateSound={(lang, assetKey, provider, model) =>
              startRun(
                "generate-sound",
                {
                  language: lang,
                  assetKey,
                  provider,
                  ...(model !== undefined ? { model } : {}),
                },
                MEDIA_RUNNER,
              )
            }
            onGenerateImage={(lang, assetKey) =>
              startRun("generate-image", { language: lang, assetKey }, MEDIA_RUNNER)
            }
            onGenerateText={(lang, assetKey) =>
              startRun("generate-media-text", { language: lang, assetKey })
            }
            defaultLanguage={languageSetup.defaultLanguage}
            languageName={(code) =>
              languageSetup.languages.find((entry) => entry.code === code)?.label ?? code
            }
            onTranslate={(lang, assetKey) =>
              startRun("generate-media-text", { language: lang, assetKey, translate: true })
            }
            sceneNav={sceneNav}
            spec={detail?.draft.spec}
            onCompose={
              videoSetup?.enabled
                ? (lang, assetKey, look) =>
                    startRun("compose-video", {
                      language: lang,
                      assetKey,
                      ...(look ? { look } : {}),
                      // Scene images bound to checkout media are read from the chosen checkout.
                    })
                : undefined
            }
            onRecordVideo={
              videoSetup?.enabled
                ? (compositionRunId) => startRun("render-video", { compositionRunId })
                : undefined
            }
            onRenderTimeline={
              videoSetup?.enabled
                ? (lang, assetKey) => startRun("render-timeline", { language: lang, assetKey })
                : undefined
            }
            onRefineTimeline={
              videoSetup?.enabled
                ? (lang, assetKey) => startRun("refine-timeline", { language: lang, assetKey })
                : undefined
            }
            onCritique={
              videoSetup?.enabled
                ? (lang, assetKey) => startRun("critique-video", { language: lang, assetKey })
                : undefined
            }
            onImprove={
              videoSetup?.enabled
                ? (lang, assetKey, look) =>
                    startRun("improve-scene", {
                      language: lang,
                      assetKey,
                      ...(look ? { look } : {}),
                    })
                : undefined
            }
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
              saveDisabled={busy || !edited.description}
              acceptBlocked={dirty ? S.activities.studioProposal.saveFirst : null}
              reveal={revealScene}
              review={reviewRequest}
              compare={compareScript}
              media={scriptMedia}
              onOpenClip={openClip}
              onReview={setScriptReview}
              memory={savedReview}
              onApplyReviewed={
                editable && available ? (text) => void applyReviewedScript(text) : undefined
              }
              onDiscardProposal={editable && available ? settleScriptProposal : undefined}
              onChange={(text) => draft.edit("description", text)}
              onSave={() => void draft.save("description")}
              onAcceptProposal={
                editable && available && scriptProposal !== null
                  ? () => void acceptProposal({ target: "description", text: scriptProposal })
                  : undefined
              }
            />
          </section>
        ) : section === "specification" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <JsonEditor
              title={S.activities.specEditor.title}
              editorLabel={S.activities.specEditor.editor}
              savedLabel={S.activities.specEditor.savedSide}
              saveLabel={S.activities.specEditor.save}
              value={spec}
              saved={pretty(detail.draft.spec)}
              editable={editable && available}
              readOnly={!available}
              busy={busy}
              leading={
                <div role="group" aria-label={S.activities.specScenes.view}>
                  <Segmented
                    cols={2}
                    value={specView}
                    onChange={chooseSpecView}
                    options={[
                      { value: "scenes", label: S.activities.specScenes.scenes },
                      { value: "json", label: S.activities.specScenes.json },
                    ]}
                  />
                </div>
              }
              alternate={{
                shown: specView === "scenes",
                leave: () => chooseSpecView("json"),
                node: (
                  <SpecScenesView
                    text={spec}
                    script={description}
                    bindings={mediaBindings}
                    editable={editable && available}
                    onChange={(text) => draft.edit("spec", text)}
                    onOpenJson={() => chooseSpecView("json")}
                  />
                ),
              }}
              onChange={(text) => draft.edit("spec", text)}
              onSave={() => void draft.save("spec")}
            />
          </section>
        ) : section === "configuration" || section === "assessment" || section === "module" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ModuleDocumentView
              // One editor per document, so unsaved text never carries to the other kind.
              key={section}
              kind={section === "module" ? "definition" : section}
              revision={detail.draft.contentRevision}
              editable={editable && available}
              onOpenSection={(target) =>
                sections.some((entry) => entry.key === target && entry.enabled)
                  ? () => setSection(target)
                  : undefined
              }
              onSaved={(saved, text) => {
                // Only the draft changed; unsaved script or specification text stays.
                draft.applyDraft(saved, "unsaved");
                announce({ kind: "success", text });
              }}
              generation={
                section === "assessment"
                  ? {
                      refNum: detail.refNum,
                      usesAssessment,
                      runs,
                      blocked: runBlockText(draft.can("assessment")),
                      onGenerate: () => startRun("generate-assessment", {}),
                      onAccept: (runId) =>
                        // Only the draft changed; unsaved script or specification text stays.
                        void draft.change(
                          (api, revision) => api.runs.accept(runId, "accept-assessment", revision),
                          {
                            keep: "unsaved",
                            then: () =>
                              announce({ kind: "success", text: S.activities.assessment.accepted }),
                          },
                        ),
                    }
                  : undefined
              }
            />
          </section>
        ) : (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div
                className={`mx-auto space-y-5 ${section === "deploy" ? "max-w-6xl" : "max-w-4xl"}`}
              >
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
                          disabled={draft.can("planMedia") !== null}
                          onClick={() =>
                            void draft.change((api, revision) => api.draft.planMedia(revision), {
                              keep: "none",
                              then: () => toastSuccess(S.activities.saved),
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
                {section === "speech" && editedManifest && detail.activityType === "book" && (
                  <BookWordsPanel
                    language={language}
                    group={editedManifest.assets[language] ?? []}
                    runs={runs}
                    revision={detail.draft.contentRevision}
                    editable={editable}
                    canChange={draft.can("draftChange") === null}
                    canGenerate={draft.can("wordsRun") === null}
                    onRefresh={(mode) =>
                      void draft.change(
                        (api, revision) =>
                          api.draft.refreshBookWords(revision, {
                            language,
                            ...(mode ? { bookMode: mode } : {}),
                          }),
                        {
                          keep: "none",
                          draftOf: (result) => result.draft,
                          then: (result) => {
                            const group = result.draft.mediaPlan?.manifest.assets[language] ?? [];
                            announce({
                              kind: "success",
                              text: S.activities.bookWords.refreshed(
                                group.length - withoutBookWords(group).length,
                              ),
                            });
                          },
                        },
                      )
                    }
                    onAskModel={(words) => startRun("generate-phonemes", { language, words })}
                    canRecord={draft.can("recordWords") === null}
                    onRecord={() => runStages("words", { language })}
                    onUseSounds={(runId) => {
                      const before = wordsWithoutSounds(
                        detail.draft.mediaPlan?.manifest.assets[language] ?? [],
                      ).length;
                      void draft.change(
                        (api, revision) => api.runs.accept(runId, "accept-phonemes", revision),
                        {
                          keep: "none",
                          then: (saved) => {
                            const after = wordsWithoutSounds(
                              saved.mediaPlan?.manifest.assets[language] ?? [],
                            ).length;
                            announce({
                              kind: "success",
                              text: S.activities.bookWords.accepted(before - after),
                            });
                          },
                        },
                      );
                    }}
                  />
                )}
                {section === "speech" && editedManifest && (
                  <SpeechCoverage
                    assets={withoutBookWords(editedManifest.assets[language] ?? [])}
                    language={language}
                    endpoint={endpoint}
                    scenes={fullTree}
                    script={{ text: description, scenes: scriptScenes }}
                    editable={editable}
                    canGenerate={draft.can("draftChange") === null}
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
                    onGenerateAll={(keys) => setSpeechQueue({ language, voice: bulkVoice, keys })}
                    queued={speechQueue?.keys.length ?? 0}
                    onCancelQueue={() => setSpeechQueue(null)}
                    runs={runs}
                    languages={Object.entries(editedManifest.assets).map(([code, group]) => {
                      const tally = speechTally(withoutBookWords(group), runIndex, code);
                      return { language: code, ready: tally.ready, total: tally.total };
                    })}
                    onLanguage={setLanguage}
                    voices={voiceOptions}
                    voice={bulkVoice}
                    onVoice={setBulkVoice}
                    voiceDisabled={busy || !available || running || pipelineRunning}
                    speechProviders={speechProviders}
                    onApplyProviderToAll={(provider: SpeechProviderId) => {
                      const updated = structuredClone(editedManifest);
                      const count = applyProvider(
                        updated.assets[language] ?? [],
                        provider,
                        voiceOptions,
                        language,
                      );
                      if (!count) return;
                      draft.edit("media", pretty(updated));
                      void draft.save("media", true).then((ok) => {
                        if (ok && alive.current)
                          announce({
                            kind: "success",
                            text: S.activities.speechProvider.applied(count),
                          });
                      });
                    }}
                    onApplyVoiceToAll={(voice) => {
                      const updated = structuredClone(editedManifest);
                      const group = updated.assets[language] ?? [];
                      // A voice belongs to one provider, which comes with it.
                      const owner =
                        voiceOptions.find((option) => option.id === voice)?.providerId ??
                        (isElevenLabsVoiceId(voice) ? "elevenlabs" : "gemini");
                      if (sharedProvider(group) !== owner)
                        applyProvider(group, owner, voiceOptions, language);
                      const count = applyVoice(group, voice);
                      if (!count) return;
                      // The choice shows at once and stays in the editor if the save fails.
                      draft.edit("media", pretty(updated));
                      void draft.save("media", true).then((ok) => {
                        if (ok && alive.current)
                          announce({
                            kind: "success",
                            text: S.activities.voicePicker.applied(count),
                          });
                      });
                    }}
                    sources={
                      language === languageSetup.defaultLanguage
                        ? undefined
                        : new Map(
                            (editedManifest.assets[languageSetup.defaultLanguage] ?? [])
                              .filter((asset) => asset.type === "audio" && asset.script)
                              .map((asset) => [asset.key, asset.script!]),
                          )
                    }
                    onTranslate={(key) =>
                      startRun("generate-media-text", { language, assetKey: key, translate: true })
                    }
                    onTranslateAll={() => runStages("translations", { language })}
                    soundProvider={
                      soundProviders
                        ? bulkSoundProvider(
                            soundProviders,
                            pendingSoundKinds(
                              editedManifest.assets[language] ?? [],
                              runIndex,
                              language,
                            ),
                          )
                        : undefined
                    }
                    onGenerateSounds={(provider) => runStages("sounds", { language }, provider)}
                    onTranslateAndSpeak={(key) =>
                      runStages("narration", { language, ...(key ? { assetKey: key } : {}) })
                    }
                    addable={languageSetup.languages
                      .filter(
                        (entry) =>
                          entry.code !== languageSetup.defaultLanguage &&
                          !(entry.code in editedManifest.assets),
                      )
                      .map((entry) => ({ code: entry.code, label: entry.label }))}
                    onAddLanguage={(code) =>
                      void draft.change((api, revision) => api.draft.addLanguage(revision, code), {
                        keep: "none",
                        then: () => setLanguage(code),
                      })
                    }
                    onRetry={(key) =>
                      startRun(
                        "generate-audio",
                        {
                          language,
                          assetKey: key,
                          ...speechChoice(
                            editedManifest.assets[language]?.find((asset) => asset.key === key),
                            voiceOptions,
                            bulkVoice,
                            language,
                          ),
                        },
                        MEDIA_RUNNER,
                      )
                    }
                  />
                )}
                {section === "library" && (
                  <AssetLibraryView
                    assets={editedManifest?.assets[language] ?? []}
                    uploads={uploads}
                    uploadsLoading={uploadsLoading}
                    endpoint={endpoint}
                    placeholders={placeholders}
                    previewOf={previewOf}
                    onOpen={(key) => {
                      const usage = (editedManifest?.assets[language] ?? []).find(
                        (entry) => entry.key === key,
                      )?.usages[0]?.sceneId;
                      setKind("all");
                      setSelected({ sceneId: usage ?? "", key });
                      setBoard(false);
                      setSection("scenes");
                    }}
                  />
                )}
                {section === "features" && (
                  <ImplementationFeaturesView editable={editable && available} />
                )}
                {section === "stats" && (
                  <ActivityStatsView revision={detail.draft.contentRevision} />
                )}
                {section === "newRef" && available && (
                  <CreateRefView
                    key={detail.id}
                    template={detail}
                    editable={editable}
                    voices={voiceOptions}
                    uploads={uploads}
                    uploadsLoading={uploadsLoading}
                    onIdentity={(record) => {
                      draft.updateRecord(record);
                      void onSaved();
                    }}
                    onOpenAssessment={() => setSection("assessment")}
                    onCreated={(made, problem) => {
                      announce(
                        problem
                          ? {
                              kind: "attention",
                              text: S.activities.createRef.createdWithProblem(made.refNum, problem),
                            }
                          : { kind: "success", text: S.activities.createRef.created(made.refNum) },
                      );
                      void onSaved();
                      navigate(`/activities/${encodeURIComponent(made.id)}?section=scenes`);
                    }}
                  />
                )}
                {section === "deploy" && available && (
                  <DeployPanel
                    key={detail.id}
                    productCode={detail.productCode}
                    editable={editable}
                    pinnedBuild={Boolean(detail.draft.pinnedModuleRunId)}
                    onAnnounce={announce}
                  />
                )}
                {section === "history" && available && (
                  <GenerationHistory
                    runs={runs}
                    draftRevision={detail.draft.contentRevision}
                    editable={editable}
                    busy={busy}
                    onCancel={(runId) =>
                      void draft.act(async () => {
                        const result = await api.runs.cancel(runId);
                        if (alive.current)
                          cache.update(api.runs.list, (previous = []) =>
                            previous.map((item) =>
                              item.runId === result.runId ? summarize(result) : item,
                            ),
                          );
                      })
                    }
                    onAnnounce={announce}
                    unsaved={dirty}
                    onRestored={(restored) => draft.applyDraft(restored, "none")}
                    pinnedModuleRunId={detail.draft.pinnedModuleRunId}
                    focusRun={historyFocus}
                    onDraft={(pinned) =>
                      // A pin changes only which build the preview plays; unsaved text stays.
                      draft.applyDraft(pinned, "unsaved")
                    }
                    onUseCandidate={(candidate) =>
                      unsaved.confirm({ kind: "draftText" }, () => {
                        draft.edit("spec", candidate);
                        setSection("specification");
                      })
                    }
                  />
                )}
                {section === "library" && editedManifest && detail.draft.mediaPlan && (
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
                        onChange={(event) => draft.edit("media", event.target.value)}
                        spellCheck={false}
                        disabled={available && (!editable || busy)}
                        readOnly={!available}
                        hint={S.activities.mediaPathHint}
                      />
                    </details>
                    {editable && (
                      <Button
                        size="sm"
                        disabled={busy || !media.trim() || !edited.media}
                        onClick={() => void draft.save("media")}
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
    </ActivityClientContext.Provider>
  );
}

/** A proposal whose only change is the script, which is done with once the script is. */
function changesOnlyScript(read: ProposalRead): boolean {
  return !!read.proposal?.changes.every((change) => change.target === "description");
}

/** Why a run cannot start now, in the author's terms; null when nothing need be said. */
function runBlockText(reason: DraftBlock | null): string | null {
  const words = S.activities.studioRun;
  if (reason === "unsaved") return words.saveFirst;
  if (reason === "running" || reason === "stages") return words.otherRun;
  if (reason === "agent") return words.noAgent;
  return null;
}
