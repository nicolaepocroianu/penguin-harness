/**
 * A scene video's timeline (experimental), in the Scene video section: how its finished video is
 * put together from the recording, narration, music, effects and captions. The author changes
 * it here, saves it on the video, and renders the finished video, which then appears among the
 * recordings to compare and keep.
 *
 * The timeline is read from the server: the one saved on the video, or else one started from
 * its newest recording. What it would get wrong is the server's to say, and is shown as it
 * says it after each save.
 */
import { useEffect, useId, useState } from "react";
import type {
  AssetManifest,
  TimelineTransition,
  VideoTimeline,
  VideoTimelineView,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  blocksRender,
  effectChoices,
  fromSeconds,
  issueText,
  musicChoices,
  narrationChoices,
  timelineLength,
  timelineUrl,
  toSeconds,
  withCut,
} from "./scene-timeline";

type Asset = AssetManifest["assets"][string][number];

const words = S.activities.video.timeline;

export function SceneTimelineView({
  asset,
  group,
  language,
  endpoint,
  revision,
  newestRecording,
  editable,
  canChange,
  rendering,
  onSave,
  onRender,
}: {
  asset: Asset;
  /** The assets of the language shown, which the timeline's audio is chosen from. */
  group: readonly Asset[];
  language: string;
  endpoint: string;
  revision: string;
  /** The newest recording's run, so a new recording starts a new default timeline. */
  newestRecording: string | null;
  editable: boolean;
  /** Whether the timeline may be saved or rendered now (no unsaved edits, no run). */
  canChange: boolean;
  /** Whether a finished video is being rendered now. */
  rendering: boolean;
  /** Save the timeline on the video, or with null drop it. */
  onSave: (timeline: VideoTimeline | null) => Promise<void>;
  onRender: () => void;
}) {
  const [view, setView] = useState<VideoTimelineView | null>(null);
  const [edited, setEdited] = useState<VideoTimeline | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    setFailure(null);
    apiFetch<VideoTimelineView>(timelineUrl(endpoint, language, asset.key))
      .then((next) => {
        if (!live) return;
        setView(next);
        setEdited(null);
      })
      .catch((error: unknown) => {
        if (live) setFailure(words.loadFailed((error as Error).message));
      });
    return () => {
      live = false;
    };
  }, [endpoint, language, asset.key, revision, newestRecording]);

  if (failure) return <p className={`text-xs ${toneInk.danger}`}>{failure}</p>;
  if (!view) return null;
  const timeline = edited ?? view.timeline;
  const dirty = edited !== null;
  const change = (next: VideoTimeline) => setEdited(next);
  const locked = !editable || saving;
  const blocked = view.issues.some(blocksRender);
  const save = async (next: VideoTimeline | null) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-3" aria-label={words.title}>
      <h5 className="flex items-center gap-2 text-xs font-semibold">
        {words.title}
        <InfoPopover label={words.title}>{words.info}</InfoPopover>
        <Badge tone={view.saved ? "green" : "gray"}>
          {view.saved ? words.saved : words.unsaved}
        </Badge>
      </h5>
      <p className="text-xs text-gray-500">{words.length(toSeconds(timelineLength(timeline)))}</p>

      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-semibold">{words.cuts}</legend>
        {timeline.cuts.map((cut, index) => (
          <div key={cut.id} className="flex flex-wrap items-end gap-2 text-xs">
            <span className="w-14 pb-1.5 font-medium">{words.cut(index + 1)}</span>
            <SecondsField
              label={words.from}
              ms={cut.inMs}
              onChange={(inMs) => change(withCut(timeline, index, { inMs }))}
            />
            <SecondsField
              label={words.to}
              ms={cut.outMs}
              onChange={(outMs) => change(withCut(timeline, index, { outMs }))}
            />
            {index > 0 && (
              <>
                <div className="w-44">
                  <Select
                    label={words.into}
                    value={cut.transition}
                    onChange={(event) =>
                      change(
                        withCut(timeline, index, {
                          transition: event.target.value as TimelineTransition,
                        }),
                      )
                    }
                  >
                    <option value="cut">{words.transitions.cut}</option>
                    <option value="fade">{words.transitions.fade}</option>
                    <option value="fadeblack">{words.transitions.fadeblack}</option>
                  </Select>
                </div>
                {cut.transition !== "cut" && (
                  <SecondsField
                    label={words.fade}
                    ms={cut.transitionMs}
                    onChange={(transitionMs) => change(withCut(timeline, index, { transitionMs }))}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-semibold">{words.narration}</legend>
        {timeline.narration.length === 0 && (
          <p className="text-xs text-gray-500">{words.noNarration}</p>
        )}
        {timeline.narration.map((entry, index) => (
          <div key={`${entry.asset}-${index}`} className="flex flex-wrap items-end gap-2 text-xs">
            <span className="min-w-32 pb-1.5 font-medium">{entry.asset}</span>
            <SecondsField
              label={words.startsAt}
              ms={entry.startMs}
              onChange={(startMs) =>
                change({
                  ...timeline,
                  narration: timeline.narration.map((item, at) =>
                    at === index ? { ...item, startMs } : item,
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={words.remove(entry.asset)}
              onClick={() =>
                change({
                  ...timeline,
                  narration: timeline.narration.filter((_, at) => at !== index),
                })
              }
            >
              {words.removeButton}
            </Button>
          </div>
        ))}
        <AddAudio
          label={words.addNarration}
          choices={narrationChoices(group, timeline)}
          onAdd={(key) =>
            change({
              ...timeline,
              narration: [...timeline.narration, { asset: key, startMs: 0 }],
            })
          }
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-semibold">{words.music}</legend>
        <div className="w-64">
          <Select
            aria-label={words.music}
            value={timeline.music?.asset ?? ""}
            onChange={(event) => {
              const key = event.target.value;
              change({
                ...timeline,
                music: key
                  ? {
                      volume: 0.3,
                      fadeInMs: 1000,
                      fadeOutMs: 1000,
                      duck: true,
                      ...timeline.music,
                      asset: key,
                    }
                  : null,
              });
            }}
          >
            <option value="">{words.noMusic}</option>
            {musicChoices(group).map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.key}
              </option>
            ))}
          </Select>
        </div>
        {timeline.music && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Volume
              value={timeline.music.volume}
              onChange={(volume) => change({ ...timeline, music: { ...timeline.music!, volume } })}
            />
            <Toggle
              label={words.duck}
              checked={timeline.music.duck}
              disabled={locked}
              onChange={(duck) => change({ ...timeline, music: { ...timeline.music!, duck } })}
            />
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-semibold">{words.effects}</legend>
        {timeline.effects.length === 0 && (
          <p className="text-xs text-gray-500">{words.noEffects}</p>
        )}
        {timeline.effects.map((effect, index) => {
          const set = (next: Partial<typeof effect>) =>
            change({
              ...timeline,
              effects: timeline.effects.map((item, at) =>
                at === index ? { ...item, ...next } : item,
              ),
            });
          return (
            <div
              key={`${effect.asset}-${index}`}
              className="flex flex-wrap items-end gap-2 text-xs"
            >
              <span className="min-w-32 pb-1.5 font-medium">{effect.asset}</span>
              <SecondsField
                label={words.startsAt}
                ms={effect.startMs}
                onChange={(startMs) => set({ startMs })}
              />
              <Volume value={effect.volume} onChange={(volume) => set({ volume })} />
              <Button
                size="sm"
                variant="ghost"
                aria-label={words.remove(effect.asset)}
                onClick={() =>
                  change({
                    ...timeline,
                    effects: timeline.effects.filter((_, at) => at !== index),
                  })
                }
              >
                {words.removeButton}
              </Button>
            </div>
          );
        })}
        <AddAudio
          label={words.addEffect}
          choices={effectChoices(group)}
          onAdd={(key) =>
            change({
              ...timeline,
              effects: [...timeline.effects, { asset: key, startMs: 0, volume: 1 }],
            })
          }
        />
      </fieldset>

      <Toggle
        label={words.captions}
        checked={timeline.captions.enabled}
        disabled={locked}
        onChange={(enabled) => change({ ...timeline, captions: { ...timeline.captions, enabled } })}
      />

      {view.issues.length > 0 && (
        <ul className={`space-y-1 text-xs ${toneInk.attention}`}>
          {view.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.asset}-${index}`}>{issueText(issue)}</li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!dirty || !canChange || saving}
              onClick={() => void save(timeline)}
            >
              {words.save}
            </Button>
            {view.saved && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canChange || saving}
                onClick={() => void save(null)}
              >
                {words.reset}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={dirty || blocked || !canChange || rendering}
              onClick={onRender}
            >
              {rendering ? words.rendering : words.render}
            </Button>
          </div>
          {dirty && <p className="text-xs text-gray-500">{words.saveFirst}</p>}
        </div>
      )}
    </section>
  );
}

/** A time in seconds, kept as typed until it reads as a number of seconds. */
function SecondsField({
  label,
  ms,
  onChange,
}: {
  label: string;
  ms: number;
  onChange: (ms: number) => void;
}) {
  const [text, setText] = useState(toSeconds(ms));
  useEffect(() => setText(toSeconds(ms)), [ms]);
  const value = fromSeconds(text);
  return (
    <div className="w-24">
      <Input
        label={label}
        inputMode="decimal"
        value={text}
        error={value === null ? words.invalid : undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = fromSeconds(event.target.value);
          if (next !== null && next !== ms) onChange(next);
        }}
      />
    </div>
  );
}

/** A volume from 0 to 1, as a slider read out in percent. */
function Volume({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="flex min-w-48 items-center gap-2">
      <FieldLabel htmlFor={id} block={false}>
        {words.volume}
      </FieldLabel>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-brand-600"
      />
      <output htmlFor={id} className="w-10 text-right text-xs tabular-nums">
        {words.percent(Math.round(value * 100))}
      </output>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <FieldLabel htmlFor={id} block={false}>
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** A picker that adds one of `choices` to the timeline; nothing when there are none. */
function AddAudio({
  label,
  choices,
  onAdd,
}: {
  label: string;
  choices: Asset[];
  onAdd: (key: string) => void;
}) {
  if (!choices.length) return null;
  return (
    <div className="w-64">
      <Select
        aria-label={label}
        value=""
        onChange={(event) => {
          if (event.target.value) onAdd(event.target.value);
        }}
      >
        <option value="">{label}</option>
        {choices.map((choice) => (
          <option key={choice.key} value={choice.key}>
            {choice.key}
          </option>
        ))}
      </Select>
    </div>
  );
}
