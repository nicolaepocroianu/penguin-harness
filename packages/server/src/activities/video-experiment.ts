import { HttpError } from "../http/errors.js";

/**
 * The scene-video experiment's server switch (see composition.ts): off until an admin turns it
 * on, and read per request, so flipping it needs no restart.
 */

/** Key of the switch in `server_settings`; absent means off. */
export const VIDEO_EXPERIMENT_SETTING = "activityVideoExperiment";

/** The switch as stored: on only when it was set to true. */
export function readVideoExperiment(raw: string | null): boolean {
  return raw === "true";
}

/** 403 while an admin has not turned the scene-video experiment on. */
export function experimentOff(): HttpError {
  return new HttpError(
    403,
    "experiment_off",
    "Scene videos are an experiment an admin has not turned on.",
  );
}
