/**
 * The draft an activity's studio edits: the saved draft as the server last sent it, the
 * author's three texts over it (script, specification, media manifest), what is unsaved, the
 * autosaves, one change at a time, and what may be pressed now.
 *
 * Plain TS so it runs in node: the page reads `state` and calls the operations, and every
 * change the server makes to the draft comes back through `applyDraft`, which says whether the
 * author's unsaved text is kept.
 */
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  AssetManifest,
} from "@prismshadow/penguin-server/api";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import type { ActivityApi, RunAccept, RunStart } from "./activity-api";
import { applyMediaChange, type ProposalChange } from "./proposal";
import { renumberManifestText } from "./ref-number";

/** How long after the last keystroke the script saves itself: long enough not to save mid-word. */
export const SCRIPT_AUTOSAVE_MS = 5000;
/** A provider or voice pick saves almost at once; typing a script waits for a pause. */
export const MEDIA_AUTOSAVE_MS = 1000;

export type DraftPart = "description" | "spec" | "media";

/**
 * What applying a draft from the server does to the author's texts: `unsaved` keeps them (only
 * the saved draft moved, e.g. a pin or a module document), `none` replaces them with the draft.
 */
export type KeepText = "unsaved" | "none";

export interface DraftState {
  detail: ActivityDetail | null;
  description: string;
  spec: string;
  media: string;
  /** Which texts differ from the saved draft. */
  edited: Record<DraftPart, boolean>;
  /** Any text differs from the saved draft. */
  dirty: boolean;
  /** The manifest text when it has the saved shape the structured editors need; else null. */
  manifest: AssetManifest | null;
  /** A change is on its way to the server; another waits. */
  busy: boolean;
  error: string;
  /** The server's draft moved while the author had unsaved text. */
  changed: boolean;
  scriptSave: "saving" | "saved" | "failed" | null;
  mediaSave: "pending" | "saving" | "saved" | "failed" | null;
}

/** What the page knows that decides what may be pressed. */
export interface DraftContext {
  editable: boolean;
  available: boolean;
  /** A run is under way. */
  running: boolean;
  /** The stages are under way. */
  stages: boolean;
  /** An agent is chosen to run stages and agent runs. */
  hasAgent: boolean;
}

/** Why something cannot be pressed now. */
export type DraftBlock =
  | "readonly"
  | "unavailable"
  | "busy"
  | "running"
  | "stages"
  | "unsaved"
  | "invalid"
  | "noSpec"
  | "agent";

/** Each gated action's checks, in the order their reasons are reported. */
const GATES = {
  /** Typing into the draft's editors. */
  edit: ["unavailable", "busy"],
  /** A run an agent makes for one asset: text, a composition. */
  agentRun: ["readonly", "unavailable", "invalid", "busy", "running", "unsaved", "agent"],
  /** A run the Media Agent makes: speech, sound, an image. */
  mediaRun: ["readonly", "unavailable", "invalid", "busy", "running", "unsaved"],
  /** A change to the saved draft: accepting a candidate, refreshing words, bulk speech. */
  draftChange: ["readonly", "unavailable", "busy", "running", "unsaved"],
  /** Previewing a generated image against the saved draft. */
  preview: ["readonly", "unavailable", "busy", "unsaved"],
  planMedia: ["busy", "running", "unsaved", "invalid", "noSpec"],
  /** Running the stages. */
  stages: ["readonly", "unavailable", "unsaved", "running", "stages", "agent"],
  /** Running the stages from the words panel, which also waits on a change. */
  recordWords: ["readonly", "unavailable", "busy", "unsaved", "running", "stages", "agent"],
  /** Asking a model for a book's word sounds. */
  wordsRun: ["readonly", "unavailable", "busy", "running", "unsaved", "agent"],
  assessment: ["running", "stages", "agent"],
  tests: ["readonly", "running", "unsaved", "agent"],
  quality: ["readonly", "running"],
} as const satisfies Record<string, readonly DraftBlock[]>;

export type DraftAction = keyof typeof GATES;

export interface DraftFacts extends DraftContext {
  busy: boolean;
  dirty: boolean;
  valid: boolean;
  hasSpec: boolean;
}

/** The first reason `action` cannot be pressed, or null when it can. */
export function blockedBy(action: DraftAction, facts: DraftFacts): DraftBlock | null {
  const holds: Record<DraftBlock, boolean> = {
    readonly: !facts.editable,
    unavailable: !facts.available,
    busy: facts.busy,
    running: facts.running,
    stages: facts.stages,
    unsaved: facts.dirty,
    invalid: !facts.valid,
    noSpec: !facts.hasSpec,
    agent: !facts.hasAgent,
  };
  return GATES[action].find((reason) => holds[reason]) ?? null;
}

export interface DraftPorts {
  /** The activity's routes. */
  api: ActivityApi;
  /** The author's own save landed; the activity list is read again. */
  saved(): Promise<void>;
  toast(text: string): void;
}

export const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

function fail(message: string): never {
  throw new Error(message);
}

/** The draft's saved title follows a valid specification's, as the server keeps it. */
function withDraft(detail: ActivityDetail, draft: ActivityDraft): ActivityDetail {
  return {
    ...detail,
    title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
    draft,
  };
}

const ASSET_TYPES = ["audio", "image", "video", "animation"];

/**
 * The manifest text as a manifest, when it has the saved shape the structured editors need.
 * Anything else is left to the JSON editor and checked by the server on save.
 */
export function readManifest(text: string): AssetManifest | null {
  let value: { assets?: unknown };
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const runRef = (ref: unknown, sha = false) => {
    const entry = ref as { runId?: unknown; sha256?: unknown } | undefined;
    return (
      ref === undefined ||
      (!!entry && typeof entry.runId === "string" && (!sha || typeof entry.sha256 === "string"))
    );
  };
  const isAsset = (value: unknown) => {
    const item = value as Record<string, unknown> | null;
    return (
      !!item &&
      typeof item.key === "string" &&
      ASSET_TYPES.includes(item.type as string) &&
      typeof item.description === "string" &&
      Array.isArray(item.usages) &&
      item.usages.every(
        (usage: unknown) =>
          !!usage &&
          typeof usage === "object" &&
          "sceneId" in usage &&
          typeof usage.sceneId === "string",
      ) &&
      (item.script === undefined || typeof item.script === "string") &&
      (item.path === undefined || typeof item.path === "string") &&
      runRef(item.generatedAudio) &&
      runRef(item.generatedImage, true) &&
      runRef(item.generatedVideo, true)
    );
  };
  return value &&
    typeof value.assets === "object" &&
    value.assets &&
    Object.values(value.assets).every((items) => Array.isArray(items) && items.every(isAsset))
    ? (value as AssetManifest)
    : null;
}

/** One request to the activity's routes, naming the draft's revision where the route takes it. */
export type DraftCall<R> = (api: ActivityApi, revision: string) => Promise<R>;

interface CommitOptions<R> {
  keep: KeepText;
  /** Where the response carries the draft; the response is the draft by default. */
  draftOf?: (result: R) => ActivityDraft;
  /** Refuse while the author has unsaved text, which the change would not see. */
  clean?: boolean;
}

export class StudioDraft {
  state: DraftState;
  private context: DraftContext;
  private readonly listeners = new Set<() => void>();
  private live = true;
  private savedText = { spec: "", media: "" };
  private manifestOf = { text: "", manifest: null as AssetManifest | null };
  private mediaArmed = false;
  private scriptTimer: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private mediaTimer: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly ports: DraftPorts,
    context: DraftContext,
  ) {
    this.context = context;
    this.state = {
      detail: null,
      description: "",
      spec: "",
      media: "",
      edited: { description: false, spec: false, media: false },
      dirty: false,
      manifest: null,
      busy: false,
      error: "",
      changed: false,
      scriptSave: null,
      mediaSave: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): DraftState => this.state;

  /** The saved draft's revision, which every change names so a stale one is refused. */
  get revision(): string {
    return this.state.detail?.draft.contentRevision ?? "";
  }

  /** What `can` reads; set while rendering, so it never announces a change. */
  observe(context: DraftContext): void {
    this.context = context;
  }

  /** Take the page's context and start, restart or stop the autosaves to match it. */
  setContext(context: DraftContext): void {
    this.context = context;
    this.schedule();
  }

  /** The first reason `action` cannot be pressed now, or null when it can. */
  can(action: DraftAction): DraftBlock | null {
    const draft = this.state.detail?.draft;
    return blockedBy(action, {
      ...this.context,
      busy: this.state.busy,
      dirty: this.state.dirty,
      valid: draft?.status === "valid",
      hasSpec: !!draft?.spec,
    });
  }

  /** The editor is showing; a page left behind stops its timers and drops late answers. */
  attach(): void {
    this.live = true;
    this.schedule();
  }

  detach(): void {
    this.live = false;
    this.clearScript();
    this.clearMedia();
  }

  edit(part: DraftPart, text: string): void {
    const patch: Partial<Record<DraftPart, string>> = { [part]: text };
    this.set(patch);
  }

  /** A structured edit of the manifest, which saves itself a moment after the last one. */
  editManifest(manifest: AssetManifest): void {
    this.mediaArmed = true;
    this.set({ media: pretty(manifest) });
  }

  fail(text: string): void {
    this.set({ error: text });
  }

  /** Replace the draft and every text with the server's: a load, a reload. */
  replace(detail: ActivityDetail): void {
    this.set({
      detail,
      description: detail.draft.description,
      spec: pretty(detail.draft.spec),
      media: pretty(detail.draft.mediaPlan?.manifest),
      changed: false,
    });
  }

  /**
   * The draft the poll read. Taken only when nothing was sent since the poll started; over
   * unsaved text it is never applied, and a moved draft is only reported.
   */
  receive(detail: ActivityDetail, revisionAtStart: string): void {
    if (this.state.busy || this.revision !== revisionAtStart) return;
    if (!this.state.dirty) this.replace(detail);
    else if (detail.draft.contentRevision !== this.revision) this.set({ changed: true });
  }

  /** A draft the server made, applied with an explicit choice about the author's texts. */
  applyDraft(draft: ActivityDraft, keep: KeepText): void {
    const current = this.state.detail;
    if (!current) return;
    const detail = withDraft(current, draft);
    if (keep === "none") this.replace(detail);
    else this.set({ detail });
  }

  /** The activity's name or tags changed; the draft did not. */
  updateRecord(record: ActivityRecord): void {
    const current = this.state.detail;
    if (current) this.set({ detail: { ...current, ...record } });
  }

  /**
   * The ref took a new number. Only the number and the manifest's address changed: unsaved
   * script or specification text stays, and unsaved manifest edits move to the new number.
   */
  renumbered(detail: ActivityDetail, from: number): void {
    const media =
      this.state.media === this.savedText.media
        ? pretty(detail.draft.mediaPlan?.manifest)
        : renumberManifestText(this.state.media, from, detail.refNum);
    this.set({ detail, media });
  }

  /** Run one change at a time; resolves true only when it went through. */
  async act(operation: () => Promise<void>): Promise<boolean> {
    if (this.state.busy || !this.context.available) return false;
    this.set({ busy: true, error: "" });
    try {
      await operation();
      return true;
    } catch (e) {
      if (this.live) this.set({ error: apiErrorText(e) });
      return false;
    } finally {
      if (this.live) this.set({ busy: false });
    }
  }

  /**
   * Send one change of the saved draft, naming its revision, and apply the draft it made.
   * Resolves with the server's answer, or null when the editor closed meanwhile. Callers run
   * it inside `act`.
   */
  async commit<R = ActivityDraft>(
    call: DraftCall<R>,
    options: CommitOptions<R>,
  ): Promise<R | null> {
    if (!this.state.detail || (options.clean && this.state.dirty))
      throw new Error(S.activities.studioProposal.saveFirst);
    const result = await this.send(call);
    if (!this.live) return null;
    const draftOf = options.draftOf ?? ((value: R) => value as unknown as ActivityDraft);
    this.applyDraft(draftOf(result), options.keep);
    return result;
  }

  /** One change on its own: `commit` inside `act`, then `then` with the answer. */
  change<R = ActivityDraft>(
    call: DraftCall<R>,
    options: CommitOptions<R> & { then?: (result: R) => void },
  ): Promise<boolean> {
    return this.act(async () => {
      const result = await this.commit(call, options);
      if (result !== null) options.then?.(result);
    });
  }

  /** A request against the draft as it stands, without applying anything it answers. */
  send<R>(call: DraftCall<R>): Promise<R> {
    return call(this.ports.api, this.revision);
  }

  /** Start one run against this draft; `then` gets it while the editor is still open. */
  start(path: RunStart, body: Record<string, unknown>, then: (run: ActivityRun) => void) {
    return this.act(async () => {
      const run = await this.send((api, revision) => api.runs.start(path, body, revision));
      if (this.live) then(run);
    });
  }

  /** Accept a run's candidate into the draft; settles once the draft has it. */
  acceptRun(runId: string, path: RunAccept): Promise<boolean> {
    return this.change((api, revision) => api.runs.accept(runId, path, revision), {
      keep: "none",
      then: () => this.ports.toast(S.activities.saved),
    });
  }

  /** Read the draft again, replacing every text. */
  reload(): Promise<boolean> {
    return this.act(async () => {
      const detail = await this.ports.api.detail();
      if (this.live) this.replace(detail);
    });
  }

  /**
   * Save one text. `quiet` leaves out the toast, for an autosave. Text typed into the script
   * while it saves stays: the saved script is never written back over the editor.
   */
  async save(part: DraftPart, quiet = false): Promise<boolean> {
    if (!this.state.detail) return false;
    return this.act(async () => {
      const { description, spec, media } = this.state;
      const call: DraftCall<ActivityDraft> =
        part === "description"
          ? (api, revision) => api.draft.description(revision, description)
          : part === "media"
            ? (api, revision) => api.draft.media(revision, JSON.parse(media))
            : (api, revision) => api.draft.spec(revision, JSON.parse(spec));
      const draft = await this.commit(call, { keep: "unsaved" });
      if (!draft) return;
      if (part === "spec") this.edit("spec", pretty(draft.spec));
      if (part === "media") this.edit("media", pretty(draft.mediaPlan?.manifest));
      if (!quiet) this.ports.toast(S.activities.saved);
      await this.ports.saved();
    });
  }

  /**
   * Put one change an agent proposed into the draft, through the route the author's own save
   * uses. Refused while there is unsaved text, which it would overwrite. Callers run it inside
   * `act`.
   */
  async land(change: ProposalChange): Promise<void> {
    const detail = this.state.detail;
    if (!detail || this.state.dirty) throw new Error(S.activities.studioProposal.saveFirst);
    let call: DraftCall<ActivityDraft>;
    if (change.target === "description")
      call = (api, revision) => api.draft.description(revision, change.text);
    else if (change.target === "spec")
      call = (api, revision) => api.draft.spec(revision, change.spec);
    else {
      const manifest = applyMediaChange(
        detail.draft.mediaPlan?.manifest ??
          fail(S.activities.studioProposal.missingAsset(change.assetKey)),
        change,
      );
      call = (api, revision) => api.draft.media(revision, manifest);
    }
    const draft = await this.commit(call, { keep: "none" });
    if (draft) this.ports.toast(S.activities.saved);
  }

  private set(patch: Partial<DraftState>): void {
    const next = { ...this.state, ...patch };
    const detail = next.detail;
    if (detail !== this.state.detail)
      this.savedText = {
        spec: pretty(detail?.draft.spec),
        media: pretty(detail?.draft.mediaPlan?.manifest),
      };
    if (next.media !== this.manifestOf.text)
      this.manifestOf = { text: next.media, manifest: readManifest(next.media) };
    next.edited = {
      description: !!detail && next.description !== detail.draft.description,
      spec: !!detail && next.spec !== this.savedText.spec,
      media: !!detail && next.media !== this.savedText.media,
    };
    next.dirty = next.edited.description || next.edited.spec || next.edited.media;
    next.manifest = this.manifestOf.manifest;
    this.state = next;
    this.schedule();
    for (const listener of this.listeners) listener();
  }

  /**
   * The autosaves. Each waits for a pause, and holds while the page cannot take a change or a
   * run or the stages are under way, so a save never moves the draft under them; any edit
   * restarts the wait.
   */
  private schedule(): void {
    if (!this.live) return;
    const { editable, available, running, stages } = this.context;
    const open = editable && available && !this.state.busy && !running && !stages;
    const scriptKey = open && this.state.edited.description ? this.state.description : null;
    if (scriptKey !== (this.scriptTimer?.key ?? null)) {
      this.clearScript();
      if (scriptKey !== null)
        this.scriptTimer = {
          key: scriptKey,
          timer: setTimeout(() => {
            this.set({ scriptSave: "saving" });
            void this.save("description", true).then((ok) => {
              if (this.live) this.set({ scriptSave: ok ? "saved" : "failed" });
            });
          }, SCRIPT_AUTOSAVE_MS),
        };
    }
    if (this.mediaArmed && !this.state.edited.media) this.mediaArmed = false;
    const mediaKey = this.mediaArmed && open ? this.state.media : null;
    if (mediaKey !== (this.mediaTimer?.key ?? null)) {
      this.clearMedia();
      if (mediaKey !== null) {
        this.mediaTimer = {
          key: mediaKey,
          timer: setTimeout(() => {
            this.mediaTimer = null;
            this.mediaArmed = false;
            this.set({ mediaSave: "saving" });
            void this.save("media", true).then((ok) => {
              if (this.live) this.set({ mediaSave: ok ? "saved" : "failed" });
            });
          }, MEDIA_AUTOSAVE_MS),
        };
        if (this.state.mediaSave !== "pending") this.set({ mediaSave: "pending" });
      }
    }
  }

  private clearScript(): void {
    if (this.scriptTimer) clearTimeout(this.scriptTimer.timer);
    this.scriptTimer = null;
  }

  private clearMedia(): void {
    if (this.mediaTimer) clearTimeout(this.mediaTimer.timer);
    this.mediaTimer = null;
  }
}
