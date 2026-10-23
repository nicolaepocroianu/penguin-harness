/**
 * The deploy's log, under both lanes: whichever run is the activity's latest, QA's or PROD's,
 * is followed from its start — every second while it runs, at once while pages come back full.
 * When a run seen running ends, its end is announced and the deploy state is read again.
 */
import { useEffect, useRef, useState } from "react";
import type { DeployLogLine, DeployRun } from "@waterford/waf-harness-server/api";
import { S } from "../../lib/strings";
import { useActivityClient } from "./activity-client";
import { appendLog, runLine } from "./deploy-model";
import type { Announcement } from "./run-toasts";

/** How often the log is asked for while a run goes. */
const POLL_MS = 1000;

/** The run's log lines as they arrive; empty until it has written something. */
export function useDeployLog(
  runId: string | null,
  callbacks: {
    /** The log poll brought a newer state of the run. */
    onRun: (run: DeployRun) => void;
    /** A followed run ended: the stage states and readiness are read again. */
    onSettled: () => void;
    onAnnounce: (announcement: Announcement) => void;
  },
): DeployLogLine[] {
  const { api } = useActivityClient();
  const [lines, setLines] = useState<DeployLogLine[]>([]);
  const latest = useRef(callbacks);
  latest.current = callbacks;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let sawRunning = false;
    setLines([]);
    const tick = async () => {
      try {
        const res = await api.deploy.log(runId, cursor);
        if (cancelled) return;
        cursor = res.log.next;
        setLines((previous) => appendLog(previous, res.log));
        latest.current.onRun(res.run);
        if (res.run.status === "running") sawRunning = true;
        if (res.log.done) {
          if (sawRunning) {
            const line = runLine(res.run);
            if (line)
              latest.current.onAnnounce({
                kind:
                  res.run.status === "succeeded"
                    ? "success"
                    : res.run.status === "failed"
                      ? "error"
                      : "attention",
                text: line.text,
              });
            latest.current.onSettled();
          }
          return;
        }
        timer = setTimeout(() => void tick(), res.log.lines.length >= 500 ? 0 : POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, runId]);
  return lines;
}

/**
 * The log, folded until a run goes or has written something; it opens again for each new run,
 * and within a run the reader may fold it.
 */
export function DeployLog({
  lines,
  running,
  runId,
}: {
  lines: readonly DeployLogLine[];
  running: boolean;
  runId: string | null;
}) {
  const words = S.activities.deploy;
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const follow = useRef(true);
  const logging = running || lines.length > 0;
  useEffect(() => {
    if (logging) setOpen(true);
  }, [logging, runId]);
  useEffect(() => {
    follow.current = true;
  }, [runId]);
  // Keeps the newest line in view unless the reader scrolled up to read an older one.
  useEffect(() => {
    const element = logRef.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [lines]);
  const hasLog = lines.length > 0;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-gray-200 dark:border-gray-800"
    >
      <summary className="flex cursor-pointer items-baseline gap-2 rounded-xl px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span id="activity-deploy-log-title" className="text-xs font-semibold">
          {words.log}
        </span>
        {!hasLog && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{words.logEmpty}</span>
        )}
      </summary>
      <pre
        ref={logRef}
        data-testid="deploy-log"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
        }}
        tabIndex={0}
        aria-labelledby="activity-deploy-log-title"
        className="max-h-[32rem] min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-b-xl border-t border-gray-200 bg-gray-50/50 p-4 font-mono text-xs leading-relaxed dark:border-gray-800 dark:bg-gray-900/40"
      >
        {hasLog ? lines.map((entry) => entry.text).join("\n") : words.logEmpty}
      </pre>
    </details>
  );
}
