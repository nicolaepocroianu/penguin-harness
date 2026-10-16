/**
 * The stages' history as the studio's poll reads it. A sequence's record changes only while it
 * is the current one, so the history moves only when a sequence starts or settles: it is read
 * on the poll's first read, then again only once the current sequence's id or status is not
 * what it was beside the last history read.
 *
 * Plain TS so it runs in node.
 */
import type { PipelineState } from "@prismshadow/penguin-server/api";

/** The current sequence as the server answered it; null when it could not be read. */
type CurrentRead = { pipeline: PipelineState | null } | null;

/** The current sequence by id and status; null when unknown. */
function markOf(current: CurrentRead): string | null {
  if (!current) return null;
  return current.pipeline ? `${current.pipeline.pipelineId} ${current.pipeline.status}` : "none";
}

/**
 * One poll's reader of the history. Each tick hands it the read of the current sequence; it
 * resolves with the history when it read it, or null when it did not need to or the read
 * failed. A failed or unusable read is tried again on the next tick, and without the current
 * sequence the history stands as it was.
 */
export function stagesHistoryReader(
  load: () => Promise<{ pipelines: PipelineState[] }>,
): (current: Promise<CurrentRead>) => Promise<PipelineState[] | null> {
  // The current sequence beside the last history read; null until a read lands, and "" when
  // it landed without one, which no current sequence matches.
  let readBeside: string | null = null;
  const history = () =>
    load().then(
      (answer) => (Array.isArray(answer?.pipelines) ? answer.pipelines : null),
      () => null,
    );
  return async (current) => {
    if (readBeside === null) {
      // The first read does not wait on the current sequence's.
      const [pipelines, now] = await Promise.all([history(), current]);
      if (pipelines) readBeside = markOf(now) ?? "";
      return pipelines;
    }
    const now = markOf(await current);
    if (now === null || now === readBeside) return null;
    const pipelines = await history();
    if (pipelines) readBeside = now;
    return pipelines;
  };
}
