/**
 * The routes of one activity, in one place: each URL is built here and each answer typed, as
 * `src/api/endpoints.ts` does for the rest of the App. Routes that change the draft take the
 * draft's revision, which the server checks; the studio draft (studio-draft.ts) supplies it.
 *
 * DTO types come from @waterford/waf-harness-server/api (type imports only).
 */
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  ActivitySummary,
  AssetManifest,
  BookWordsRefresh,
  BookWordsState,
  DeployContextResponse,
  DeployLogResponse,
  DeployRunResponse,
  DeployStateResponse,
  ElevenLabsVoices,
  ImplementationFeature,
  MediaStat,
  ModuleBuildDiff,
  ModuleBuildList,
  ModuleDocuments,
  StateMachineCheck,
  StateMachineDocument,
  ProductRefNumber,
  PipelineState,
  ProjectMediaListing,
  RefNumberSuggestion,
  SandboxBuildReport,
  SandboxStatus,
  SceneLookSummary,
  SoundSetup,
  SpeechSetup,
  TrimmedAudio,
  TrimRange,
  TrimSource,
  TrimTarget,
  UploadedMedia,
  VersionDiff,
  VersionSaveResult,
  VersionSummary,
  VideoSetup,
  VideoTimeline,
  VideoTimelineView,
} from "@waterford/waf-harness-server/api";
import { apiFetch, type ApiFetchOptions } from "../../api/client";
import type { ModuleDocumentKind } from "./module-document";
import type { AssistProposal } from "./proposal";
import type { Resource } from "./resource-cache";

/** How a request reaches the server: `apiFetch` in the App, an in-memory table in tests. */
export type ApiSend = <T>(path: string, options?: ApiFetchOptions) => Promise<T>;

/** The routes that start a run against the draft. */
export type RunStart =
  | "generate-audio"
  | "generate-sound"
  | "generate-image"
  | "generate-media-text"
  | "generate-assessment"
  | "generate-phonemes"
  | "compose-video"
  | "render-video"
  | "render-timeline"
  | "refine-timeline"
  | "critique-video"
  | "improve-scene"
  | "assist"
  | "test";

/** The routes that take a run's candidate into the draft. */
export type RunAccept =
  | "accept-audio"
  | "accept-image"
  | "accept-media-text"
  | "accept-video"
  | "accept-assessment"
  | "accept-phonemes";

const activitiesPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/activities`;

/** Where one activity's routes are served, its files among them. */
export const activityEndpoint = (projectId: string, activityId: string) =>
  `${activitiesPath(projectId)}/${encodeURIComponent(activityId)}`;

/**
 * The project's activities as a whole: the list, making one, the module products, the media
 * library, and the setup every activity uses (languages, voices, providers, scene looks).
 */
export function projectActivitiesApi(projectId: string, send: ApiSend = apiFetch) {
  const base = activitiesPath(projectId);
  const resource = <T>(path: string): Resource<T> => ({
    key: `${base}/${path}`,
    load: () => send<T>(`${base}/${path}`),
  });
  return {
    /** The languages an activity may be translated into, and the default one. */
    languages: resource<{ defaultLanguage: string; languages: { code: string; label: string }[] }>(
      "language-setup",
    ),
    sound: resource<SoundSetup>("sound-setup"),
    video: resource<VideoSetup>("video-setup"),
    speech: () => send<Partial<SpeechSetup> & { voices: string[] }>(`${base}/speech-setup`),
    /** The ElevenLabs library; `refresh` skips the server's ten-minute list. */
    elevenLabsVoices: (refresh: boolean) =>
      send<ElevenLabsVoices>(`${base}/elevenlabs-voices${refresh ? "?refresh=1" : ""}`),
    sceneLooks: () => send<{ looks: SceneLookSummary[] }>(`${base}/scene-looks`),
    /** The activities; `summaries` adds each one's card summary, which fans out over them all. */
    list: (summaries: boolean) =>
      send<{ activities: ActivityRecord[]; summaries?: Record<string, ActivitySummary> }>(
        summaries ? `${base}?summary=1` : base,
      ),
    /** The refs of one product, by its collection. */
    refs: (collectionId: string) =>
      send<{ activities: ActivityRecord[] }>(`${base}?${new URLSearchParams({ collectionId })}`),
    create: (body: Record<string, unknown>) => send<ActivityDetail>(base, { method: "POST", body }),
    /** The number a new activity of this product code would take, deleted refs counted. */
    refNumber: (productCode: string) =>
      send<ProductRefNumber>(`${base}/ref-number?${new URLSearchParams({ productCode })}`),
    /** The project's media, by activity. */
    mediaLibrary: () => send<ProjectMediaListing>(`${base}/media-library`),
    /** Another activity of the project: a ref just made from this one, say. */
    activity: (activityId: string) => activityApi(projectId, activityId, send),
  };
}

export type ProjectActivitiesApi = ReturnType<typeof projectActivitiesApi>;

/** The implementation features an activity can ask for, and which it does. */
export interface ImplementationFeatures {
  features: ImplementationFeature[];
  selectedIds: string[];
}

/** One activity's routes. */
export function activityApi(projectId: string, activityId: string, send: ApiSend = apiFetch) {
  const endpoint = activityEndpoint(projectId, activityId);
  const get = <T>(path: string) => send<T>(path ? `${endpoint}/${path}` : endpoint);
  const call = <T>(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body?: Record<string, unknown>,
  ) => send<T>(`${endpoint}/${path}`, { method, ...(body !== undefined ? { body } : {}) });
  const run = (runId: string) => `runs/${encodeURIComponent(runId)}`;
  const resource = <T>(key: string, load: () => Promise<T>): Resource<T> => ({
    key: `${endpoint}#${key}`,
    load,
  });
  return {
    projectId,
    activityId,
    endpoint,
    detail: () => get<ActivityDetail>(""),
    runs: {
      /** The run history the page polls; views that start a run add it here at once. */
      list: resource("runs", () => get<{ runs: ActivityRunSummary[] }>("runs").then((r) => r.runs)),
      start: (path: RunStart, body: Record<string, unknown>, expectedRevision: string) =>
        call<ActivityRun>("POST", path, { ...body, expectedRevision }),
      accept: (runId: string, path: RunAccept, expectedRevision: string) =>
        call<ActivityDraft>("POST", `${run(runId)}/${path}`, { expectedRevision }),
      cancel: (runId: string) => call<ActivityRun>("POST", `${run(runId)}/cancel`, {}),
      candidate: (runId: string) => get<{ candidate: string | null }>(`${run(runId)}/candidate`),
      proposal: (runId: string) =>
        get<{ proposal: AssistProposal | null; error: string | null }>(`${run(runId)}/proposal`),
      /** Apply an assist run's whole proposal as one draft change. */
      applyProposal: (runId: string, expectedRevision: string) =>
        call<ActivityDraft>("POST", `${run(runId)}/proposal/apply`, { expectedRevision }),
      discardProposal: (runId: string) =>
        call<unknown>("POST", `${run(runId)}/proposal/discard`, {}),
    },
    draft: {
      description: (expectedRevision: string, description: string) =>
        call<ActivityDraft>("PATCH", "description", { expectedRevision, description }),
      spec: (expectedRevision: string, spec: unknown) =>
        call<ActivityDraft>("POST", "apply-generated-spec", { expectedRevision, spec }),
      media: (expectedRevision: string, manifest: AssetManifest) =>
        call<ActivityDraft>("PUT", "media", { expectedRevision, manifest }),
      planMedia: (expectedRevision: string) =>
        call<ActivityDraft>("POST", "plan-media", { expectedRevision }),
      /** Save a trim preview of an asset's bound clip over that clip, in place. */
      trimAudio: (expectedRevision: string, body: TrimTarget & { previewToken: string }) =>
        call<ActivityDraft>("POST", "audio-trim", { ...body, expectedRevision }),
      addLanguage: (expectedRevision: string, language: string) =>
        call<ActivityDraft>("POST", "languages", { language, expectedRevision }),
      videoTimeline: (
        expectedRevision: string,
        body: { language: string; assetKey: string; timeline: VideoTimeline | null },
      ) => call<ActivityDraft>("PUT", "video-timeline", { ...body, expectedRevision }),
      refreshBookWords: (expectedRevision: string, body: { language: string; bookMode?: string }) =>
        call<BookWordsRefresh>("POST", "book-words/refresh", { ...body, expectedRevision }),
      wordSounds: (
        expectedRevision: string,
        assetKey: string,
        body: { language: string; phonemes: string[] },
      ) =>
        call<ActivityDraft>("PUT", `book-words/${encodeURIComponent(assetKey)}/phonemes`, {
          ...body,
          expectedRevision,
        }),
    },
    bookWords: () => get<BookWordsState>("book-words"),
    /** A video's timeline as the studio reads it. */
    videoTimeline: (language: string, assetKey: string) =>
      get<VideoTimelineView>(
        `video-timeline?language=${encodeURIComponent(language)}&assetKey=${encodeURIComponent(assetKey)}`,
      ),
    ref: {
      /** Whether this ref is the product's canonical one, and the number a new ref would take. */
      nextNumber: () => get<RefNumberSuggestion>("refs/next-number"),
      renumber: (refNum: number, expectedRevision: string) =>
        call<ActivityDetail>("POST", "ref-number", { refNum, expectedRevision }),
      identity: (body: { displayName?: string; stable?: boolean }) =>
        call<ActivityRecord>("PATCH", "identity", body),
      tags: (tags: string[]) => call<{ tags: string[] }>("PUT", "tags", { tags }),
      /** A new ref of this product, made from this one. */
      create: (body: Record<string, unknown>) => call<ActivityDetail>("POST", "refs", body),
      remove: () => send<unknown>(endpoint, { method: "DELETE" }),
    },
    versions: {
      status: () => get<unknown>("versions/status"),
      list: () => get<{ versions?: VersionSummary[] }>("versions"),
      diff: (versionId: string) =>
        get<VersionDiff>(`versions/${encodeURIComponent(versionId)}/diff?against=current`),
      restore: (versionId: string, expectedRevision: string) =>
        call<ActivityDraft>("POST", `versions/${encodeURIComponent(versionId)}/restore`, {
          expectedRevision,
        }),
      /** Save the draft as a version; a null label leaves it unnamed. */
      save: (label: string | null) => call<VersionSaveResult>("POST", "versions", { label }),
    },
    moduleDocuments: {
      read: () => get<ModuleDocuments>("module-documents"),
      save: (kind: ModuleDocumentKind, value: unknown, expectedRevision: string) =>
        call<ActivityDraft>("PUT", `module-documents/${kind}`, { value, expectedRevision }),
      discard: (kind: ModuleDocumentKind, expectedRevision: string) =>
        call<ActivityDraft>("POST", `module-documents/${kind}/discard`, { expectedRevision }),
    },
    /** The ref's `spec/state-machine.json`: read with its problems, checked as typed, saved, discarded. */
    stateMachine: {
      read: () => get<StateMachineDocument>("state-machine"),
      check: (definition: Record<string, unknown>) =>
        call<StateMachineCheck>("POST", "state-machine/check", { definition }),
      save: (definition: Record<string, unknown>, expectedRevision: string) =>
        call<ActivityDraft>("PUT", "state-machine", { definition, expectedRevision }),
      discard: (expectedRevision: string) =>
        call<ActivityDraft>("POST", "state-machine/discard", { expectedRevision }),
    },
    moduleBuilds: {
      list: () => get<Partial<ModuleBuildList>>("module-builds"),
      diff: (from: string, to: string) =>
        get<ModuleBuildDiff>(
          `module-builds/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      /** Play `runId`'s build in place of the newest; null plays the newest again. */
      pin: (runId: string | null, expectedRevision: string) =>
        call<ActivityDraft>(
          "POST",
          runId === null ? "module-builds/unpin" : `module-builds/${encodeURIComponent(runId)}/pin`,
          { expectedRevision },
        ),
    },
    implementationFeatures: {
      read: resource("implementation-features", () =>
        get<ImplementationFeatures>("implementation-features"),
      ),
      save: (selectedIds: string[]) =>
        call<ImplementationFeatures>("PUT", "implementation-features", { selectedIds }),
    },
    tests: {
      /** The latest test report, read raw; `readTestState` reads it. */
      report: resource("test-report", () => get<unknown>("test-report")),
    },
    /** The player check of the build the preview plays, read raw; `readPlayerCheck` reads it. */
    playerCheck: resource("player-check", () => get<unknown>("player-check")),
    quality: {
      /** The latest quality reports, read raw; `readQualityState` reads them. */
      report: resource("quality", () => get<unknown>("quality")),
      start: () => send<ActivityRun>(`${endpoint}/quality`, { method: "POST" }),
    },
    deploy: {
      state: resource("deploy", () => get<DeployStateResponse>("deploy")),
      /** The deploy clones; `checkRemote` also asks each remote whether it is reachable. */
      context: (checkRemote = false) =>
        get<DeployContextResponse>(`deploy/context${checkRemote ? "?checkRemote=1" : ""}`),
      prepareClones: () =>
        send<DeployContextResponse>(`${endpoint}/deploy/clones`, { method: "POST" }),
      start: (body: Record<string, unknown>) => call<DeployRunResponse>("POST", "deploy", body),
      stop: () => send<DeployRunResponse>(`${endpoint}/deploy/stop`, { method: "POST" }),
      /** A deploy run's log from `after` on. */
      log: (runId: string, after: number) =>
        get<DeployLogResponse>(`deploy/runs/${runId}/log?after=${after}`),
    },
    sandbox: {
      status: () => get<SandboxStatus>("sandbox/status"),
      build: (force: boolean) => call<SandboxBuildReport>("POST", "sandbox/build", { force }),
      /** The sandbox's payload; `query` is the search string, "" or starting with "?". */
      payload: (query: string) => get<{ configuration: unknown }>(`sandbox/payload${query}`),
    },
    pipeline: {
      current: () => get<{ pipeline: PipelineState | null }>("pipeline"),
      history: () => get<{ pipelines: PipelineState[] }>("pipelines"),
      start: (body: Record<string, unknown>) => call<PipelineState>("POST", "pipeline", body),
      stop: () => call<{ pipeline: PipelineState | null }>("POST", "pipeline/stop", {}),
    },
    media: {
      uploads: () => get<{ media: UploadedMedia[] }>("media-uploads"),
      upload: (body: { name: string; dataBase64: string }) =>
        call<UploadedMedia>("POST", "media-uploads", body),
      /** A clip with a stretch cut out, kept as the card's preview until it is saved. */
      trimPreview: (target: TrimTarget, { kind, ...source }: TrimSource, range: TrimRange) =>
        call<TrimmedAudio>("POST", "audio-trim-preview", {
          ...target,
          source: kind,
          ...source,
          ...range,
        }),
      /** Store a trim preview as an upload of the ref, to bind. */
      attachTrim: (token: string) =>
        call<UploadedMedia>("POST", `audio-trim-previews/${encodeURIComponent(token)}/attach`, {}),
      /** The saved draft's media stats, for a bound clip's file details. */
      stats: resource("media-stats", () => get<{ media: MediaStat[] }>("media-stats")),
      /** The paths this ref's videos and animations are bound to until real files replace them. */
      placeholders: resource("media-placeholders", () =>
        get<{ paths: string[] }>("media-placeholders"),
      ),
      /** Copy a file another activity of the project uploaded into this one's uploads. */
      copy: (body: { fromActivityId: string; path: string }) =>
        call<UploadedMedia>("POST", "media-uploads/copy", body),
    },
  };
}

export type ActivityApi = ReturnType<typeof activityApi>;
