/**
 * The routes of one activity, in one place: each URL is built here and each answer typed, as
 * `src/api/endpoints.ts` does for the rest of the App. Routes that change the draft take the
 * draft's revision, which the server checks; the studio draft (studio-draft.ts) supplies it.
 *
 * DTO types come from @prismshadow/penguin-server/api (type imports only).
 */
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRun,
  ActivityRunSummary,
  AssetManifest,
  BookWordsRefresh,
  BookWordsState,
  DeployContextResponse,
  DeployStateResponse,
  ElevenLabsVoices,
  MediaStat,
  PipelineState,
  SandboxBuildReport,
  SandboxStatus,
  SoundSetup,
  SpeechSetup,
  UploadedMedia,
  VideoSetup,
  VideoTimeline,
} from "@prismshadow/penguin-server/api";
import { apiFetch, type ApiFetchOptions } from "../../api/client";
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

/** The project's activity setup: what languages, voices and providers its activities can use. */
export function activitySetupApi(projectId: string, send: ApiSend = apiFetch) {
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
  };
}

/** One activity's routes. */
export function activityApi(projectId: string, activityId: string, send: ApiSend = apiFetch) {
  const endpoint = `${activitiesPath(projectId)}/${encodeURIComponent(activityId)}`;
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
    tests: {
      /** The latest test report, read raw; `readTestState` reads it. */
      report: resource("test-report", () => get<unknown>("test-report")),
    },
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
    },
    sandbox: {
      status: () => get<SandboxStatus>("sandbox/status"),
      build: (force: boolean) => call<SandboxBuildReport>("POST", "sandbox/build", { force }),
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
      /** The saved draft's media stats, for a bound clip's file details. */
      stats: resource("media-stats", () => get<{ media: MediaStat[] }>("media-stats")),
    },
  };
}

export type ActivityApi = ReturnType<typeof activityApi>;
