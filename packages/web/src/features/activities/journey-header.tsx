/**
 * The journey in the activity header: six steps from the script to a deploy, each saying where
 * it stands in a mark, and in words while it still has work left (a finished step keeps its
 * words for a reader and its hint), and beside them the one next-step button, which opens the
 * readiness list — what stands between the activity and QA, blockers first, each with the press
 * that goes where it is fixed.
 *
 * The header keeps to one row. The steps sit in a container that drops the state words when it
 * is narrow and the step names when it is narrower, so on a phone the journey is six marks; a
 * reader hears every step's name and state either way, and a step's title shows them on hover.
 */
import { useState } from "react";
import {
  Button,
  Dropdown,
  GlyphIcon,
  ChevronDown,
  ICON_SIZE,
  Spinner,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import type {
  JourneyStep,
  JourneyStepKey,
  JourneyTarget,
  NextStep,
  ReadinessItem,
  StepMark,
} from "./journey-model";

const RING = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z";

/** Each mark's shape: the state reads without its colour. */
export const MARK_PATH: Record<Exclude<StepMark, "busy">, string> = {
  done: `${RING} M8.5 12.5l2.5 2.5 4.5-5`,
  attention: `${RING} M12 7.5v5.5 M12 16.5h.01`,
  blocked: "M6.5 11h11v9h-11z M9 11V8.5a3 3 0 0 1 6 0V11",
  failed: `${RING} M9.5 9.5l5 5 M14.5 9.5l-5 5`,
  todo: RING,
};

function inkOf(tone: Tone): string {
  return tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[tone];
}

/** A step's mark; a busy one is the shared spinner, announced as `label` (what is running). */
export function StepMarkIcon({ mark, tone, label }: { mark: StepMark; tone: Tone; label: string }) {
  if (mark === "busy") return <Spinner size="md" label={label} className={toneInk[tone]} />;
  return <GlyphIcon d={MARK_PATH[mark]} size={ICON_SIZE.rowLead} className={toneInk[tone]} />;
}

/**
 * The six steps. `current` is the step of the section open now, which wears the rail's
 * selection; `canGo` says whether a step's place can be opened yet.
 */
export function JourneySteps({
  steps,
  current,
  canGo,
  onGo,
}: {
  steps: readonly JourneyStep[];
  current: JourneyStepKey | null;
  canGo: (target: JourneyTarget) => boolean;
  onGo: (target: JourneyTarget) => void;
}) {
  return (
    // The container the step words answer to: only the room the header leaves the journey.
    <div className="@container min-w-0 flex-1">
      <ol
        aria-label={S.activities.journey.label}
        aria-live="polite"
        className="flex min-w-0 items-center"
      >
        {steps.map((step, index) => {
          const on = step.key === current;
          // A finished step says so with its tick; only the steps with work left speak.
          const settled = step.mark === "done";
          return (
            <li key={step.key} className="flex min-w-0 items-center">
              {index > 0 && (
                <span
                  aria-hidden
                  className="mx-0.5 h-px w-2 shrink-0 bg-gray-300 @max-lg:hidden @5xl:w-3 dark:bg-gray-700"
                />
              )}
              <button
                type="button"
                disabled={!canGo(step.go)}
                aria-current={on ? "step" : undefined}
                data-tooltip={`${step.label}: ${step.state}`}
                // A finished step's state is never on screen, so its hint says something new.
                data-tooltip-extra={settled}
                onClick={() => onGo(step.go)}
                className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left disabled:cursor-default @max-lg:px-0.5 ${
                  on
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                    : "text-gray-800 enabled:hover:bg-gray-100 dark:text-gray-100 dark:enabled:hover:bg-gray-900"
                }`}
              >
                <StepMarkIcon mark={step.mark} tone={step.tone} label={step.label} />
                <span className="grid min-w-0 text-xs leading-tight">
                  <span className="truncate font-medium @max-xl:sr-only">{step.label}</span>
                  <span
                    className={
                      settled ? "sr-only" : `truncate @max-3xl:sr-only ${inkOf(step.tone)}`
                    }
                  >
                    {step.state}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The next-step button and the readiness list it opens. The button never deploys: every press
 * in the list goes where its item is fixed, and Deploy asks before anything is pushed.
 */
export function NextStepButton({
  next,
  items,
  onGo,
}: {
  next: NextStep;
  items: readonly ReadinessItem[];
  onGo: (target: JourneyTarget) => void;
}) {
  const words = S.activities.journey;
  const [open, setOpen] = useState(false);
  const go = (target: JourneyTarget) => {
    setOpen(false);
    onGo(target);
  };
  const blockers = items.filter((item) => item.kind === "blocker");
  const recommended = items.filter((item) => item.kind === "recommendation");
  const note = readinessNote(next, items.length);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      className="shrink-0"
      menuClass="w-[26rem] max-w-[calc(100vw-1.5rem)]"
      button={
        <Button
          size="sm"
          variant="primary"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={next.label}
          onClick={() => setOpen(!open)}
          className="gap-1.5"
        >
          {/* The header row is the container: on a phone the label keeps only its count. */}
          <span className="@max-xl:hidden">{next.label}</span>
          <span aria-hidden className="@xl:hidden">
            {next.short}
          </span>
          <ChevronDown />
        </Button>
      }
    >
      <section role="dialog" aria-label={words.readiness.title} className="px-1.5 pb-1">
        <h2 className="px-2.5 pt-1.5 pb-1 text-xs font-semibold">{words.readiness.title}</h2>
        {note && <p className="px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-300">{note}</p>}
        <ReadinessGroup title={words.readiness.blocker} items={blockers} first onGo={go} />
        <ReadinessGroup
          title={words.readiness.recommendation}
          items={recommended}
          first={!blockers.length && next.state === "steps"}
          onGo={go}
        />
        {(next.state === "ready" || next.state === "onQa" || next.state === "deploying") && (
          <div className="flex justify-end px-2.5 pt-1 pb-1.5">
            <Button
              size="sm"
              variant={next.state === "ready" ? "primary" : "secondary"}
              onClick={() => go({ kind: "section", section: "deploy" })}
            >
              {words.readiness.openDeploy}
            </Button>
          </div>
        )}
      </section>
    </Dropdown>
  );
}

/** What the list says above its items, when its state says more than they do. */
function readinessNote(next: NextStep, count: number): string | null {
  const words = S.activities.journey.readiness;
  switch (next.state) {
    case "deploying":
      return words.deploying;
    case "onQa":
      return words.onQa;
    case "unknown":
      return words.unknown;
    default:
      return count ? null : words.none;
  }
}

/**
 * One kind of item under its heading, which names the kind, so an item carries no mark of its
 * own. The first item of the list's first group carries the primary press: it is the one to do
 * first.
 */
function ReadinessGroup({
  title,
  items,
  first,
  onGo,
}: {
  title: string;
  items: readonly ReadinessItem[];
  first: boolean;
  onGo: (target: JourneyTarget) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-1">
      <h3 className="px-2.5 pt-1 text-xs text-gray-500 dark:text-gray-400">{title}</h3>
      <ul aria-label={title}>
        {items.map((item, index) => (
          <li key={item.id} className="flex gap-3 rounded-md px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{item.title}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
            </div>
            <span className="self-center">
              <Button
                size="sm"
                variant={first && index === 0 ? "primary" : "secondary"}
                onClick={() => onGo(item.fix.go)}
              >
                {item.fix.label}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
