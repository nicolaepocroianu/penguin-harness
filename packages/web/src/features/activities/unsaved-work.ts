/**
 * The unsaved work of the activity studio, in one place. An editor holding work the server has
 * not seen says so here, and whatever is about to throw work away (switching section, leaving
 * the activity's route, unloading the page, changing Project, reloading the draft) asks what it
 * would lose first. Plain TS so it runs in node; `unsaved-work-context.tsx` is its React side.
 */
import type { WorkspaceSection } from "./workspace-model";

/** Work some editor holds unsaved. */
export interface HeldWork {
  /** What holds it, as a developer reads it: "draft", "module document", "scene timeline". */
  label: string;
  /**
   * The section whose editor holds the work itself, so it goes when that section closes.
   * Absent for work the page holds (the draft's texts), which survives a section switch.
   */
  section?: WorkspaceSection;
}

/** Something that would throw unsaved work away. */
export type Leave =
  /** Opening another section closes the one open, and any editor in it. */
  | { kind: "section"; from: WorkspaceSection; to: WorkspaceSection }
  /** Leaving the activity: another route, unloading the page, another Project. */
  | { kind: "activity" }
  /** Replacing the draft's texts with the server's: a reload, a candidate specification. */
  | { kind: "draftText" };

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
    if (work === null ? !before : before?.label === work.label && before.section === work.section)
      return;
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
