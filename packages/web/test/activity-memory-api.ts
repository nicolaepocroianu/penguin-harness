/**
 * The in-memory adapter of the activity client (activity-api.ts) for node tests: every request
 * is recorded with its path relative to the activity, and waits for the test to answer it.
 */
import type { ApiFetchOptions } from "../src/api/client";
import { activityApi, type ApiSend } from "../src/features/activities/activity-api";

export interface MemoryCall {
  /** The path relative to the activity; "" for the activity itself. */
  path: string;
  method: string;
  body: Record<string, unknown> | undefined;
  answer: (value: unknown) => void;
  refuse: (error: unknown) => void;
}

export function memoryActivity(projectId = "p", activityId = "a1") {
  const calls: MemoryCall[] = [];
  const prefix = `/api/projects/${projectId}/activities/${activityId}`;
  const send: ApiSend = <T>(path: string, options: ApiFetchOptions = {}) =>
    new Promise<T>((resolve, reject) =>
      calls.push({
        path: path.startsWith(`${prefix}/`)
          ? path.slice(prefix.length + 1)
          : path === prefix
            ? ""
            : path,
        method: options.method ?? "GET",
        body: options.body as Record<string, unknown> | undefined,
        answer: (value) => resolve(value as T),
        refuse: reject,
      }),
    );
  return { api: activityApi(projectId, activityId, send), calls };
}

/** Let answered requests' promises run on. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
