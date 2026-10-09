import type { Tone } from "../../lib/tone";
import { toneSurface } from "../../lib/tone";

/** A short state beside a deploy target's name; its words carry the state, the tint only echoes it. */
export function DeployStatePill({
  tone,
  text,
  testId,
}: {
  tone: Tone;
  text: string;
  testId?: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneSurface[tone]}`}
      data-testid={testId}
    >
      {text}
    </span>
  );
}
