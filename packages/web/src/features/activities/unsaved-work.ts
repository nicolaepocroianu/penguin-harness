/**
 * The unsaved work of the activity studio, in one place. An editor holding work the server has
 * not seen says so here, and whatever is about to throw work away (switching section or the
 * asset shown in Scenes, leaving the activity's route, unloading the page, changing Project,
 * reloading the draft) asks what it would lose first. Plain TS so it runs in node; `unsaved-work-context.tsx` is its React side.
 */
import type { WorkspaceSection } from "./workspace-model";

/** What holds the work; it also says what the dialog that asks about losing it says. */
export type HeldWorkLabel =
  "draft" | "module document" | "scene timeline" | "unsaved file" | "new ref plan";

/** The asset an editor in Scenes shows, by its key and, where that matters, its language. */
export interface ShownAsset {
  key: string;
  language?: string;
}

/** Work some editor holds unsaved. */
export interface HeldWork {
  label: HeldWorkLabel;
  /**
   * The section whose editor holds the work itself, so it goes when that section closes.
   * Absent for work the page holds (the draft's texts), which survives a section switch.
   */
  section?: WorkspaceSection;
  /**
   * Work the asset editor in Scenes holds: for one asset, which goes when another is shown
   * (a language too when the work is that language's), or for whichever asset is shown
   * ("editor"), which goes only when the editor closes for the storyboard.
   */
  asset?: ShownAsset | "editor";
}

/** Something that would throw unsaved work away. */
export type Leave =
  /** Opening another section closes the one open, and any editor in it. */
  | { kind: "section"; from: WorkspaceSection; to: WorkspaceSection }
  /** Leaving the activity: another route, unloading the page, another Project. */
  | { kind: "activity" }
  /** Replacing the draft's texts with the server's: a reload, a candidate specification. */
  | { kind: "draftText" }
  /** Showing another asset in Scenes, or the storyboard in its place (`to` null). */
  | { kind: "asset"; to: ShownAsset | null }
  /** An editor starting its own work over, which loses what that editor holds. */
  | { kind: "restart"; label: HeldWorkLabel };

/** Which words the dialog asks with, by what a leave would throw away. */
export type DiscardWording = "draft" | "document" | "timeline" | "file" | "refPlan";

/**
 * What the dialog says before `lost` goes. Leaving the activity, or the draft's texts, keeps
 * the words it always had; inside the workspace the words name the work at stake.
 */
export function discardWording(leave: Leave, lost: readonly HeldWork[]): DiscardWording {
  if (leave.kind === "activity" || leave.kind === "draftText") return "draft";
  if (lost.some((work) => work.label === "scene timeline")) return "timeline";
  if (lost.some((work) => work.label === "unsaved file")) return "file";
  if (lost.some((work) => work.label === "new ref plan")) return "refPlan";
  return "document";
}

function sameWork(left: HeldWork, right: HeldWork): boolean {
  const asset = (work: HeldWork) =>
    work.asset === undefined || work.asset === "editor"
      ? work.asset
      : `${work.asset.language ?? ""}/${work.asset.key}`;
  return (
    left.label === right.label && left.section === right.section && asset(left) === asset(right)
  );
}

/** Whether showing `to` (null: the storyboard) throws `work` away. */
function goesWith(work: HeldWork, to: ShownAsset | null): boolean {
  if (work.asset === undefined) return false;
  if (to === null) return true;
  if (work.asset === "editor") return false;
  return (
    work.asset.key !== to.key ||
    (work.asset.language !== undefined && work.asset.language !== to.language)
  );
}

export class UnsavedWork {
  private readonly works = new Map<number, HeldWork>();
  private readonly listeners = new Set<() => void>();
  private ids = 0;
  private version = 0;

  /** A new holder's id, for `set`. */
  holder(): number {
    return ++this.ids;
  }

  /** What the holder `id` holds now; null when it holds nothing. */
  set(id: number, work: HeldWork | null): void {
    const before = this.works.get(id);
    if (work === null ? !before : !!before && sameWork(before, work)) return;
    if (work === null) this.works.delete(id);
    else this.works.set(id, work);
    this.changed();
  }

  /** Every piece of unsaved work held now. */
  held(): HeldWork[] {
    return [...this.works.values()];
  }

  /** The work `leave` would throw away. */
  lost(leave: Leave): HeldWork[] {
    return this.held().filter((work) => {
      if (leave.kind === "activity") return true;
      if (leave.kind === "draftText") return work.section === undefined;
      if (leave.kind === "asset") return goesWith(work, leave.to);
      if (leave.kind === "restart") return work.label === leave.label;
      return leave.to !== leave.from && work.section === leave.from;
    });
  }

  /** Whether `section`'s own editor holds unsaved work, so the section must stay open. */
  holds(section: WorkspaceSection): boolean {
    return this.held().some((work) => work.section === section);
  }

  /**
   * The author chose to throw `works` away. They stop counting until their holders say again
   * that they hold something, as each does whenever it renders.
   */
  discard(works: readonly HeldWork[]): void {
    let dropped = false;
    for (const [id, work] of this.works)
      if (works.includes(work)) {
        this.works.delete(id);
        dropped = true;
      }
    if (dropped) this.changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever what is held does, for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
