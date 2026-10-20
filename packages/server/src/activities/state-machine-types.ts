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
}

export interface StateMachineValidation {
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
   * Where the machine was read from: the ref's own file, the product's (Loom's place for one
   * machine every ref shares), or the author's edit kept in the draft; null when there is none.
   */
  source: "ref" | "product" | "draft" | null;
  /** Its path inside the module. */
  file: string;
  /** An author's edit, used in place of the module's own machine until it is discarded. */
  edited: boolean;
  /** The edit predates the current specification, whose scenes it must name. */
  stale: boolean;
  /** Whether this viewer may edit it here: a project owner, on a ref that is not a book. */
  editable: boolean;
  /** Why it cannot be edited here, when the reason is the activity rather than the viewer. */
  locked: "book" | null;
}

/** What a check of an unsaved machine finds. */
export interface StateMachineCheck {
  valid: boolean;
  /** Whether a save would be taken: every problem is one the machine in effect already had. */
  savable: boolean;
  issues: (StateMachineIssue & { inherited: boolean })[];
}
