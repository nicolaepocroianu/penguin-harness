/** Every kind of run a start may make, by the kind of request that asks for it. */
import { DETERMINISTIC_RUN_KINDS, type ActivityRunKind } from "../domain.js";
import type { RunRequestKind } from "../run-request.js";
import { assessmentKind } from "./assessment.js";
import { assistKind } from "./assist.js";
import { soundKind, speechKind } from "./audio.js";
import { compositionKind } from "./composition.js";
import type { AnyRunKind } from "./contract.js";
import { critiqueKind } from "./critique.js";
import { imageKind } from "./image.js";
import { mediaTextKind } from "./media-text.js";
import { moduleKind } from "./module.js";
import { phonemesKind } from "./phonemes.js";
import { mediaSpecKind, specKind } from "./spec.js";
import { testKind } from "./test.js";
import { timelineKind } from "./timeline.js";

export const RUN_KINDS: { readonly [Kind in RunRequestKind]: AnyRunKind } = {
  spec: specKind,
  "media-spec": mediaSpecKind,
  module: moduleKind,
  speech: speechKind,
  sound: soundKind,
  image: imageKind,
  "media-text": mediaTextKind,
  assist: assistKind,
  assessment: assessmentKind,
  test: testKind,
  phonemes: phonemesKind,
  composition: compositionKind,
  timeline: timelineKind,
  critique: critiqueKind,
};

/** The kind of run a request of this kind records. */
export function runKindOf(request: { kind: RunRequestKind }): ActivityRunKind {
  return RUN_KINDS[request.kind].run;
}

/** Every kind a run records: those a start makes, and those the server records itself. */
export const RECORDED_RUN_KINDS: ReadonlySet<ActivityRunKind> = new Set<ActivityRunKind>([
  ...Object.values(RUN_KINDS).map((kind) => kind.run),
  ...DETERMINISTIC_RUN_KINDS,
]);
