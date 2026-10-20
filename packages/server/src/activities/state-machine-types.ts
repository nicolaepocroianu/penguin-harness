/**
 * A ref's state machine as the Studio reads it: Loom's `StateMachineDocument`, with what
 * Penguin's draft adds. Its own module so the App can import the shape without the server.
 */

/** One problem with a machine, named by where in the file it is. */
export interface StateMachineIssue {
  code: string;
  /** A dotted path into the file, e.g. `states.intro.on.SCENE.COMPLETED.0.target`; empty for the whole file. */
  path: string;
  message: string;
  /** A warning (an implementation the module's code never mentions), which refuses nothing. */
  warning?: boolean;
}

export interface StateMachineValidation {
  /** No problems but warnings. */
  valid: boolean;
  issues: StateMachineIssue[];
}

export interface StateMachineDocument {
  productCode: string;
  refNum: number;
  /** The machine in effect, or null when there is none or its file is not a JSON object. */
  definition: Record<string, unknown> | null;
  validation: StateMachineValidation;
  /**
   * Where the machine was read from: the product's file, where Loom keeps the one machine every
   * ref shares, a ref's own copy, or the author's edit kept in the canonical ref's draft; null
   * when there is none.
   */
  source: "ref" | "product" | "draft" | null;
  /** Its path inside the module. */
  file: string;
  /** An author's edit, used in place of the module's own machine until it is discarded. */
  edited: boolean;
  /** The specification's scenes changed after the edit, and it must name each of them. */
  stale: boolean;
  /** Whether this viewer may edit it here: a project owner, on the canonical ref, not a book. */
  editable: boolean;
  /**
   * Why it cannot be edited here, when the reason is the activity rather than the viewer: a
   * book plays its reader's own machine, and every other ref shares the canonical ref's.
   */
  locked: "book" | "shared" | null;
  /** The product's canonical ref, which edits the machine; null when there is none. */
  canonicalRefNum: number | null;
}

/** What a check of an unsaved machine finds. */
export interface StateMachineCheck {
  valid: boolean;
  /** Whether a save would be taken: every problem is a warning or one the machine in effect already had. */
  savable: boolean;
  issues: (StateMachineIssue & { inherited: boolean })[];
}
