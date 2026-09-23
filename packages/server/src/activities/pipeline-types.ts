/**
 * The shapes of "Run all stages", on their own so the App can import them without
 * pulling in the service that runs the stages (see `pipeline-run.ts`).
 */
export const PIPELINE_STEPS = ["spec", "media", "speech", "images", "module"] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type PipelineSelection = "all" | PipelineStep;

export type PipelineStepStatus =
  "pending" | "running" | "succeeded" | "skipped" | "failed" | "cancelled";

export interface PipelineStepState {
  step: PipelineStep;
  status: PipelineStepStatus;
  /** Why a step was skipped or failed, or what it is doing. */
  detail: string | null;
  /** Items a media step works through; 0 for single-run steps. */
  done: number;
  total: number;
  runIds: string[];
}

export interface PipelineState {
  pipelineId: string;
  projectId: string;
  activityId: string;
  selection: PipelineSelection;
  status: "running" | "succeeded" | "failed" | "cancelled";
  steps: PipelineStepState[];
  /** The run and Session the sequence is waiting on, for following it live. */
  currentRunId: string | null;
  currentSessionId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PipelineInput {
  selection: PipelineSelection;
  /** The Penguin agent that runs agent steps, or owns the coding agent's Session. */
  agentId: string;
  codingAgentId?: string;
  voice?: string;
  wafRoot?: string;
  bookMode?: "readAlong" | "decodable";
}
