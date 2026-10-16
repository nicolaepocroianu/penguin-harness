/**
 * The stages' history as the studio's poll reads it. A sequence's record changes only while it
 * is the current one, so the history moves only when a sequence starts or settles: it is read
 * on the poll's first read, then again only once the current sequence's id or status is not
 * what it was beside the last history the page took in.
 *
 * Plain TS so it runs in node.
 */
import type { PipelineState } from "@prismshadow/penguin-server/api";

/** The current sequence as the server answered it; null when it could not be read. */
type CurrentRead = { pipeline: PipelineState | null } | null;

/** A history the reader read, which counts as read only once the page says it landed. */
export interface StagesHistoryAnswer {
  pipelines: PipelineState[];
  /** The page holds this history; it is not read again until the current sequence moves. */
  landed(): void;
}

/** The current sequence by id and status; null when unknown. */
function markOf(current: CurrentRead): string | null {
  if (!current) return null;
  return current.pipeline ? `${current.pipeline.pipelineId} ${current.pipeline.status}` : "none";
}

/**
 * One poll's reader of the history. Each tick hands it the read of the current sequence; it
 * resolves with the history when it read it, or null when it did not need to or the read
 * failed. A failed or unusable read is tried again on the next tick, and so is one the page
 * never said landed, as when another read of the same tick failed. Without the current
 * sequence the history stands as it was.
 */
export function stagesHistoryReader(
  load: () => Promise<{ pipelines: PipelineState[] }>,
): (current: Promise<CurrentRead>) => Promise<StagesHistoryAnswer | null> {
  // The current sequence beside the last history that landed; null until one lands, and ""
  // when it landed without one, which no current sequence matches.
  let landedBeside: string | null = null;
  const history = () =>
    load().then(
      (answer) => (Array.isArray(answer?.pipelines) ? answer.pipelines : null),
      () => null,
    );
  function answer(pipelines: PipelineState[] | null, beside: string): StagesHistoryAnswer | null {
    if (!pipelines) return null;
    return {
      pipelines,
      landed: () => {
        landedBeside = beside;
      },
    };
  }
  return async (current) => {
    if (landedBeside === null) {
      // The first read does not wait on the current sequence's.
      const [pipelines, now] = await Promise.all([history(), current]);
      return answer(pipelines, markOf(now) ?? "");
    }
    const now = markOf(await current);
    if (now === null || now === landedBeside) return null;
    return answer(await history(), now);
  };
}
