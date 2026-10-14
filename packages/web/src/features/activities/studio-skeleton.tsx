/**
 * What the studio shows while an activity loads: the workspace's own frame (header, rail and
 * the opened section) drawn in placeholder blocks, so nothing moves when the real one arrives
 * and the author can already see which section they asked for. Each section gets the shape it
 * will have: an editor's lines, a list's rows, the storyboard's cards, or Deploy's stages.
 */
import type { ReactNode } from "react";
import { Skeleton } from "../../components/ui/skeleton";
import { S } from "../../lib/strings";
import type { WorkspaceSection } from "./workspace-model";

type Shape = "editor" | "list" | "board" | "stages";

const SHAPE_VIEW: Record<Shape, () => ReactNode> = {
  editor: EditorShape,
  list: ListShape,
  board: BoardShape,
  stages: StagesShape,
};

const SHAPE: Record<WorkspaceSection, Shape> = {
  description: "editor",
  specification: "editor",
  configuration: "editor",
  module: "editor",
  features: "list",
  assessment: "list",
  stats: "list",
  speech: "list",
  library: "list",
  history: "list",
  newRef: "list",
  scenes: "board",
  deploy: "stages",
};

/** Line widths that read as prose rather than as a bar chart; repeated down an editor. */
const LINE_WIDTHS = ["w-11/12", "w-3/4", "w-full", "w-2/3", "w-5/6", "w-1/2"];

function EditorShape() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <Skeleton className="h-4 w-28" />
        <span className="flex-1" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: 14 }, (_, index) => (
          <Skeleton key={index} className={`h-3 ${LINE_WIDTHS[index % LINE_WIDTHS.length]}`} />
        ))}
      </div>
    </div>
  );
}

function ListShape() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-56" />
      <div className="flex gap-2">
        {["w-12", "w-24", "w-20", "w-16"].map((width) => (
          <Skeleton key={width} className={`h-6 rounded-full ${width}`} />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-1.5 px-2">
            <Skeleton className={`h-3 ${LINE_WIDTHS[index % LINE_WIDTHS.length]}`} />
            <Skeleton className="h-2.5 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardShape() {
  return (
    <div className="grid w-full content-start gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <Skeleton className="aspect-video h-auto w-full" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function StagesShape() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-3 dark:border-gray-800">
        {Array.from({ length: 3 }, (_, phase) => (
          <div key={phase} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-1 w-full" />
            {Array.from({ length: 3 }, (_, row) => (
              <Skeleton key={row} className="h-3 w-3/4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudioSkeleton({ section }: { section: WorkspaceSection }) {
  const ShapeView = SHAPE_VIEW[SHAPE[section]];
  return (
    <div role="status" className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <span className="sr-only">{S.activities.loading}</span>
      <div
        aria-hidden
        className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800"
      >
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="hidden h-6 w-72 sm:block" />
        <span className="flex-1" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div aria-hidden className="flex min-h-0 flex-1">
        <div className="hidden w-60 shrink-0 space-y-2 border-r border-gray-200 p-3 sm:block dark:border-gray-800">
          {Array.from({ length: 11 }, (_, index) => (
            <Skeleton key={index} className={`h-3 ${index % 4 === 0 ? "w-16" : "w-32"}`} />
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <ShapeView />
        </div>
      </div>
    </div>
  );
}
