/**
 * What narration one language still needs, and one way to ask for all of it. The list
 * and the button are driven by the same pure model, so the count an author reads is
 * exactly the work the button starts.
 *
 * A row leads with the words a line says, the key under it for whoever needs the key, and
 * says its state only when the line needs something: a line with audio is the normal case,
 * said once in the summary rather than on every row.
 */
import { useMemo, useState, type ReactNode } from "react";
import type {
  ActivityRunSummary,
  AssetManifest,
  SoundProviderId,
  SpeechProviderId,
  SpeechProviderStatus,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ChipGroup } from "../../components/ui/chip-group";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Select } from "../../components/ui/select";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import {
  inSpeechFilter,
  pendingSpeechKeys,
  speechStatuses,
  speechTally,
  type SpeechFilter,
  type SpeechState,
  type SpeechStatus,
} from "./bulk-speech";
import {
  inInstructionFilter,
  instructionTypes,
  type InstructionFilter,
  type InstructionType,
} from "./instruction-type";
import { soundStatuses, soundTally, type SoundState } from "./bulk-sound";
import { indexRuns } from "./runs-index";
import { providerLabel } from "./sound-model";
import { mixedVoice } from "./voice-catalogue";
import {
  SPEECH_PROVIDERS,
  providerStatus,
  sharedProvider,
  supportsSpeechLanguage,
  voicesFor,
} from "./speech-provider";
import { VoicePicker } from "./voice-picker";

const STATE_TONE: Record<SpeechState, Tone | null> = {
  ready: null,
  generating: "busy",
  failed: "danger",
  missing: "attention",
  scriptMissing: "attention",
  scriptTooLong: "attention",
};

const SOUND_TONE: Record<SoundState, Tone | null> = {
  ready: null,
  generating: "busy",
  failed: "danger",
  missing: "attention",
  noPrompt: "attention",
};

const FILTERS: readonly SpeechFilter[] = [
  "all",
  "needs",
  "translate",
  "failed",
  "ready",
  "blocked",
];

const INSTRUCTION_FILTERS: readonly InstructionFilter[] = ["all", "main", "scaffolding"];

// The app's segmented control (`components/ui/segmented.tsx`), laid out to wrap: these
// choices carry counts and can number more than the control's four columns.

type MediaAsset = AssetManifest["assets"][string][number];

/**
 * What a narration row says about itself, or null for the normal case: a line with audio and
 * nothing to translate carries no mark at all.
 */
function speechRowState(status: SpeechStatus): string | null {
  const words = S.activities;
  if (status.translation === "missing" || status.translation === "translating")
    return words.speechTranslation[status.translation];
  const ready = status.state === "ready";
  if (status.translation === "outdated")
    return ready
      ? words.speechTranslation.outdated
      : `${words.speechState[status.state]} · ${words.speechTranslation.outdated}`;
  return ready ? null : words.speechState[status.state];
}

/** What a row is called: the asset's own words, and its key and scenes underneath. */
function RowName({
  text,
  assetKey,
  scenes,
  badge,
}: {
  text: string | undefined;
  assetKey: string;
  scenes?: readonly string[];
  badge?: ReactNode;
}) {
  const words = text?.trim();
  const where = scenes?.length ? scenes.join(", ") : "";
  return (
    <span className="min-w-0 space-y-0.5">
      <span className="block">
        <span className={words ? "font-medium" : "font-mono font-medium break-all"}>
          {words || assetKey}
        </span>
        {badge && <> {badge}</>}
      </span>
      {(words || where) && (
        <span className="block break-all text-gray-500 dark:text-gray-400">
          {words && <span className="font-mono">{assetKey}</span>}
          {words && where && " · "}
          {where}
        </span>
      )}
    </span>
  );
}

export function SpeechCoverage({
  assets,
  language,
  editable,
  canGenerate,
  onSelect,
  onGenerateAll,
  queued,
  onCancelQueue,
  runs = [],
  languages = [],
  onLanguage,
  onRetry,
  sources,
  onTranslate,
  onTranslateAll,
  onTranslateAndSpeak,
  addable = [],
  onAddLanguage,
  voices = [],
  voice = "",
  onVoice,
  onApplyVoiceToAll,
  speechProviders = null,
  onApplyProviderToAll,
  voiceDisabled = false,
  soundProvider,
  onGenerateSounds,
}: {
  assets: readonly MediaAsset[];
  language: string;
  /** The activity's runs, which say what is generating and what failed. */
  runs?: readonly ActivityRunSummary[];
  /** Every language's bound and total narration, for switching between them. */
  languages?: readonly { language: string; ready: number; total: number }[];
  onLanguage?: (language: string) => void;
  /** Generate one narration again after it failed. */
  onRetry?: (key: string) => void;
  /** The default language's scripts by key, when this language is a translation. */
  sources?: ReadonlyMap<string, string>;
  onTranslate?: (key: string) => void;
  /** Translate everything that needs it, as the Translate stage does. */
  onTranslateAll?: () => void;
  /**
   * Translate, then speak, what this language lacks: one line, or all of them. Offered where
   * a script is empty, since speech needs a script and the script needs translating first.
   */
  onTranslateAndSpeak?: (key?: string) => void;
  /** Languages the activity could still be translated into. */
  addable?: readonly { code: string; label: string }[];
  onAddLanguage?: (code: string) => void;
  /** The voices a narration can be spoken in. */
  voices?: readonly VoiceOption[];
  /** The voice bulk generation and retries use for a narration naming none of its own. */
  voice?: string;
  onVoice?: (voice: string) => void;
  /** Save one voice on every narration of this language. */
  onApplyVoiceToAll?: (voice: string) => void;
  /** The speech providers the chosen agent can use; null while unknown or without one. */
  speechProviders?: readonly SpeechProviderStatus[] | null;
  /** Save one speech provider on every narration of this language. */
  onApplyProviderToAll?: (provider: SpeechProviderId) => void;
  /** Hold the voice choice while a save or a run could move the draft under it. */
  voiceDisabled?: boolean;
  /** Who the sounds stage asks for music and effects, and whether the agent can use it. */
  soundProvider?: { id: SoundProviderId; available: boolean };
  /** Run the sounds stage for this language. */
  onGenerateSounds?: (provider: SoundProviderId) => void;
  editable: boolean;
  canGenerate: boolean;
  /** Open one narration in the workbench's detail panel. */
  onSelect: (key: string) => void;
  onGenerateAll: (keys: string[]) => void;
  /** How many narrations are still queued; 0 when no bulk run is in flight. */
  queued: number;
  onCancelQueue: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<SpeechFilter>("all");
  const [adding, setAdding] = useState("");
  const [instruction, setInstruction] = useState<InstructionFilter>("all");
  // Derived from each line's words on every change, never stored (see instruction-type.ts).
  const types = useMemo(() => instructionTypes(assets, sources), [assets, sources]);
  const typeOf = (key: string): InstructionType => types.get(key) ?? "other";
  const runIndex = indexRuns(runs);
  const byKey = useMemo(() => new Map(assets.map((asset) => [asset.key, asset])), [assets]);
  const statuses = speechStatuses(assets, runIndex, language, sources);
  const toTranslate = statuses.filter(
    (status) => status.translation === "missing" || status.translation === "outdated",
  ).length;
  const unscripted = statuses.filter((status) => status.translation === "missing").length;
  const tally = speechTally(assets, runIndex, language);
  const pending = pendingSpeechKeys(assets, runIndex, language);
  const inType = (status: (typeof statuses)[number], entry: InstructionFilter) =>
    inInstructionFilter(typeOf(status.key), entry);
  // Each row's counts are taken within the other row's choice, so every count matches the
  // lines its chip would show.
  const typeCounts = Object.fromEntries(
    INSTRUCTION_FILTERS.map((entry) => [
      entry,
      statuses.filter((s) => inSpeechFilter(s, filter) && inType(s, entry)).length,
    ]),
  ) as Record<InstructionFilter, number>;
  // The instruction row appears when a line under the state filter is a main instruction or
  // scaffolding, and stays while a type is chosen, so a choice never narrows the list unseen.
  const sorted = instruction !== "all" || typeCounts.main + typeCounts.scaffolding > 0;
  const counts = Object.fromEntries(
    FILTERS.map((entry) => [
      entry,
      statuses.filter((s) => inSpeechFilter(s, entry) && inType(s, instruction)).length,
    ]),
  ) as Record<SpeechFilter, number>;
  const shown = statuses.filter(
    (status) => inSpeechFilter(status, filter) && inType(status, instruction),
  );
  // The provider the narrations share picks the voices offered; with several, every voice.
  const provider = sharedProvider(assets);
  const bulkVoices =
    provider && provider !== "mixed"
      ? voicesFor(voices, provider, assets).filter(
          (voice) => provider !== "kokoro" || voice.languages.includes(language),
        )
      : voices.filter(
          (voice) => voice.providerId !== "kokoro" || voice.languages.includes(language),
        );
  const sounds = (
    <SoundCoverage
      assets={assets}
      runs={runs}
      language={language}
      editable={editable}
      canGenerate={canGenerate}
      provider={soundProvider}
      onSelect={onSelect}
      onGenerate={onGenerateSounds}
    />
  );
  if (!tally.total)
    return (
      <div className="space-y-6">
        <p className="text-sm text-gray-500">{S.activities.bulkSpeechNone}</p>
        {sounds}
      </div>
    );
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          {S.activities.bulkSpeechTitle}
          <InfoPopover label={S.activities.bulkSpeechTitle}>
            <p>{S.activities.bulkSpeechHelp}</p>
          </InfoPopover>
        </h4>
        <p className="text-xs text-gray-500">
          {tally.ready === tally.total ? (
            <span className={toneInk.success}>{S.activities.bulkSpeechAllReady(tally.total)}</span>
          ) : (
            S.activities.bulkSpeechTally(tally.ready, tally.total)
          )}
          {tally.pending > 0 ? ` · ${S.activities.bulkSpeechPending(tally.pending)}` : ""}
        </p>
        {tally.blocked > 0 && (
          <p className={`text-xs ${toneInk.attention}`}>
            {S.activities.bulkSpeechBlocked(tally.blocked)}
          </p>
        )}
        {languages.length > 1 && onLanguage && (
          <ChipGroup
            label={S.activities.bulkSpeechLanguages}
            value={language}
            onChange={onLanguage}
            options={languages.map((entry) => ({
              value: entry.language,
              label: (
                <span className="tabular-nums">
                  {S.activities.bulkSpeechLanguage(entry.language, entry.ready, entry.total)}
                </span>
              ),
            }))}
          />
        )}
        {editable && (toTranslate > 0 || addable.length > 0 || (voices.length > 0 && onVoice)) && (
          <div className="flex flex-wrap items-center gap-2">
            {onApplyProviderToAll && provider && (
              <div className="w-56">
                <Select
                  size="sm"
                  aria-label={S.activities.speechProvider.applyToAll}
                  value={provider === "mixed" ? "" : provider}
                  disabled={voiceDisabled}
                  onChange={(event) =>
                    event.target.value &&
                    onApplyProviderToAll(event.target.value as SpeechProviderId)
                  }
                >
                  {provider === "mixed" && (
                    <option value="">{S.activities.speechProvider.mixed}</option>
                  )}
                  {SPEECH_PROVIDERS.map((id) => {
                    const supported = supportsSpeechLanguage(voices, id, language);
                    const status = providerStatus(speechProviders, id);
                    const name = S.activities.speechProvider[id];
                    return (
                      <option
                        key={id}
                        value={id}
                        disabled={!supported || (!!status && !status.available && id !== provider)}
                      >
                        {!supported
                          ? `${name} (${S.activities.speechProvider.languageUnsupported})`
                          : status && !status.available
                            ? `${name} (${status.problem === "runtime_missing" ? S.activities.speechProvider.runtimeMissing : S.activities.speechProvider.keyMissing(status.credential)})`
                            : name}
                      </option>
                    );
                  })}
                </Select>
              </div>
            )}
            {voices.length > 0 && onVoice && (
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-xs text-gray-500 dark:text-gray-400">
                  {S.activities.voicePicker.applyToAll}
                </span>
                <div className="w-40">
                  <VoicePicker
                    options={bulkVoices}
                    // The voice the narrations share, or the default where none names one
                    // Penguin can speak (generation falls back to the default for those).
                    value={mixedVoice(assets, bulkVoices) ?? (voice || null)}
                    label={S.activities.voicePicker.applyToAll}
                    showLabel={false}
                    disabled={voiceDisabled}
                    onChange={(id) => {
                      onVoice(id);
                      onApplyVoiceToAll?.(id);
                    }}
                  />
                </div>
              </div>
            )}
            {unscripted > 0 && onTranslateAndSpeak ? (
              <Button size="sm" disabled={!canGenerate} onClick={() => onTranslateAndSpeak()}>
                {S.activities.speechTranslation.translateAndSpeakAll(toTranslate)}
              </Button>
            ) : (
              toTranslate > 0 &&
              onTranslateAll && (
                <Button size="sm" disabled={!canGenerate} onClick={onTranslateAll}>
                  {S.activities.speechTranslation.translateAll(toTranslate)}
                </Button>
              )
            )}
            {addable.length > 0 && onAddLanguage && (
              <>
                <div className="w-44">
                  <Select
                    size="sm"
                    aria-label={S.activities.speechTranslation.addLanguage}
                    value={adding}
                    onChange={(event) => setAdding(event.target.value)}
                  >
                    <option value="">{S.activities.speechTranslation.addLanguage}</option>
                    {addable.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={!adding}
                  onClick={() => {
                    onAddLanguage(adding);
                    setAdding("");
                  }}
                >
                  {S.activities.speechTranslation.add}
                </Button>
              </>
            )}
          </div>
        )}
        <ChipGroup
          label={S.activities.bulkSpeechFilters}
          value={filter}
          onChange={setFilter}
          options={FILTERS.filter(
            (entry) => entry === "all" || entry === filter || counts[entry] > 0,
          ).map((entry) => ({
            value: entry,
            label: (
              <>
                {S.activities.bulkSpeechFilter[entry]}{" "}
                <span className="tabular-nums opacity-70">{counts[entry]}</span>
              </>
            ),
          }))}
        />
        {sorted && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              {S.activities.instructionType.title}
              <InfoPopover label={S.activities.instructionType.title}>
                <p>{S.activities.instructionType.about}</p>
              </InfoPopover>
            </span>
            <ChipGroup
              label={S.activities.instructionType.filterLabel}
              value={instruction}
              onChange={setInstruction}
              options={INSTRUCTION_FILTERS.map((entry) => ({
                value: entry,
                label: (
                  <>
                    {S.activities.instructionType.filter[entry]}{" "}
                    <span className="tabular-nums opacity-70">{typeCounts[entry]}</span>
                  </>
                ),
              }))}
            />
          </div>
        )}
        <ul className="space-y-1">
          {shown.map((status) => {
            const tone = STATE_TONE[status.state];
            const type = typeOf(status.key);
            const stateText = speechRowState(status);
            return (
              <li key={status.key} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(status.key)}
                  title={status.error}
                  className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <RowName
                    text={byKey.get(status.key)?.script}
                    assetKey={status.key}
                    scenes={status.sceneIds}
                    badge={
                      type !== "other" && (
                        <Badge tone="gray">{S.activities.instructionType.badge[type]}</Badge>
                      )
                    }
                  />
                  {stateText && (
                    <span
                      className={`shrink-0 ${
                        status.translation === "translating"
                          ? toneInk.busy
                          : status.translation
                            ? toneInk.attention
                            : tone
                              ? toneInk[tone]
                              : "text-gray-500"
                      }`}
                    >
                      {stateText}
                    </span>
                  )}
                </button>
                {status.translation === "missing" && editable && onTranslateAndSpeak ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canGenerate}
                    onClick={() => onTranslateAndSpeak(status.key)}
                  >
                    {S.activities.speechTranslation.translateAndSpeak}
                  </Button>
                ) : (
                  (status.translation === "missing" || status.translation === "outdated") &&
                  editable &&
                  onTranslate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canGenerate}
                      onClick={() => onTranslate(status.key)}
                    >
                      {S.activities.speechTranslation.translate}
                    </Button>
                  )
                )}
                {status.state === "failed" && editable && onRetry && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canGenerate}
                    onClick={() => onRetry(status.key)}
                  >
                    {S.activities.bulkSpeechRetry}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {editable && queued > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className={`text-xs ${toneInk.busy}`}>
              {S.activities.bulkSpeechQueued(queued)}
            </p>
            <Button size="sm" onClick={onCancelQueue}>
              {S.activities.bulkSpeechStop}
            </Button>
          </div>
        ) : (
          editable &&
          pending.length > 0 && (
            <Button size="sm" disabled={!canGenerate} onClick={() => setConfirming(true)}>
              {S.activities.bulkSpeechGenerate(pending.length)}
            </Button>
          )
        )}
        {confirming && (
          <ConfirmModal
            open
            tone="primary"
            title={S.activities.bulkSpeechTitle}
            confirmLabel={S.activities.bulkSpeechGenerate(pending.length)}
            onClose={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              onGenerateAll(pending);
            }}
          >
            <p>{S.activities.bulkSpeechConfirm(pending.length, language)}</p>
          </ConfirmModal>
        )}
      </section>
      {sounds}
    </div>
  );
}

/**
 * Music and sound effects in one language: how many are bound, each one's state, and one
 * press that runs the sounds stage for the language. Absent when the language has none.
 */
function SoundCoverage({
  assets,
  runs,
  language,
  editable,
  canGenerate,
  provider,
  onSelect,
  onGenerate,
}: {
  assets: readonly MediaAsset[];
  runs: readonly ActivityRunSummary[];
  language: string;
  editable: boolean;
  canGenerate: boolean;
  provider?: { id: SoundProviderId; available: boolean };
  onSelect: (key: string) => void;
  onGenerate?: (provider: SoundProviderId) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const words = S.activities.sound;
  const runIndex = indexRuns(runs);
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const statuses = soundStatuses(assets, runIndex, language);
  const tally = soundTally(assets, runIndex, language);
  if (!statuses.length) return null;
  const name = provider ? providerLabel(provider.id) : "";
  return (
    <section aria-label={words.bulkTitle} className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {words.bulkTitle}
        <InfoPopover label={words.bulkTitle}>
          <p>{words.bulkHelp}</p>
        </InfoPopover>
      </h4>
      <p className="text-xs text-gray-500">
        {tally.ready === tally.total ? (
          <span className={toneInk.success}>{words.bulkAllReady(tally.total)}</span>
        ) : (
          words.bulkTally(tally.ready, tally.total)
        )}
      </p>
      <ul className="space-y-1">
        {statuses.map((status) => {
          const tone = SOUND_TONE[status.state];
          return (
            <li key={status.key}>
              <button
                type="button"
                onClick={() => onSelect(status.key)}
                title={status.error}
                className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <RowName text={byKey.get(status.key)?.description} assetKey={status.key} />
                {status.state !== "ready" && (
                  <span className={`shrink-0 ${tone ? toneInk[tone] : "text-gray-500"}`}>
                    {words.statuses[status.state]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {editable && provider && !provider.available && tally.pending > 0 && (
        <p className={`text-xs ${toneInk.attention}`}>{words.bulkUnavailable(name)}</p>
      )}
      {editable && onGenerate && provider && tally.pending > 0 && (
        <Button
          size="sm"
          disabled={!canGenerate || !provider.available}
          onClick={() => setConfirming(true)}
        >
          {words.bulk(tally.pending)}
        </Button>
      )}
      {confirming && provider && onGenerate && (
        <ConfirmModal
          open
          tone="primary"
          title={words.bulkTitle}
          confirmLabel={words.bulk(tally.pending)}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onGenerate(provider.id);
          }}
        >
          <p>{words.bulkConfirm(tally.pending, name, language)}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
