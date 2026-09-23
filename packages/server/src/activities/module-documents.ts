/**
 * The module's own documents for a ref, as Loom showed them beside the script: its
 * configuration and its assessment, read from whichever module the preview would play.
 *
 * Its own module so the App can import the shape without pulling the sandbox in.
 */
export interface ModuleDocuments {
  /** Where they were read from: an assembly run's module, the checkout, or nowhere yet. */
  source: "run" | "checkout" | null;
  configuration: { file: string; value: unknown } | null;
  assessment: { file: string; value: unknown } | null;
}
