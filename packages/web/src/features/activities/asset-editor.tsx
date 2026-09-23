/**
 * The detail pane of the activity workspace: everything about the one scene asset the
 * rail has selected. It fills its column, scrolls on its own, and keeps the binding and
 * its save action pinned to the bottom so the primary action is never scrolled away.
 */
import { useState } from "react";
import type {
  AssetManifest,
  ActivityRunSummary,
  UploadedMedia,
} from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import { ImagePreview } from "./image-preview";
import { MediaBinding } from "./media-binding";
import { isUploadPath } from "./media-library";
import { MediaPlayer } from "./media-player";
import { WaveformPlayer } from "./waveform-player";
import { NarrationLanguages } from "./narration-languages";
import { MediaTextReview } from "./media-text-review";
import type { SceneAssetSelection } from "./scene-asset-tree";

export function AssetEditor({
  manifest,
  language,
  selection,
  media,
  mediaLoading,
  runs,
  endpoint,
  editable,
  disabled,
  canGenerate,
  canGenerateMedia = canGenerate,
  canAccept,
  canPreview,
  wafRoot,
  revision,
  voices,
  mediaDirty,
  onChange,
  onSaveMedia,
  onGenerateAudio,
  onGenerateImage,
  onAcceptAudio,
  onAcceptImage,
  onGenerateText,
  onAcceptText,
  onUpload,
  sceneNav,
  onTranslate,
  defaultLanguage = "en-US",
  onLanguage,
}: {
  manifest: AssetManifest;
  /** The language group the rail is showing. */
  language: string;
  /** The scene and key the rail selected, or null when it has nothing to show. */
  selection: SceneAssetSelection | null;
  media: readonly UploadedMedia[];
  mediaLoading: boolean;
  runs: ActivityRunSummary[];
  endpoint: string;
  editable: boolean;
  disabled: boolean;
  canGenerate: boolean;
  /** Speech and image runs, which only a Penguin agent can make; defaults to `canGenerate`. */
  canGenerateMedia?: boolean;
  canAccept: boolean;
  canPreview: boolean;
  wafRoot: string;
  revision: string;
  voices: string[];
  /** Whether the manifest holds edits the server has not seen. */
  mediaDirty: boolean;
  onChange: (manifest: AssetManifest) => void;
  onSaveMedia: () => void;
  onGenerateAudio: (language: string, assetKey: string, voice: string) => void;
  onGenerateImage: (language: string, assetKey: string) => void;
  onAcceptAudio: (runId: string) => void;
  onAcceptImage: (runId: string) => void;
  onGenerateText: (language: string, assetKey: string) => void;
  onAcceptText: (runId: string) => void;
  onUpload: (file: File) => Promise<UploadedMedia>;
  /** Translate a narration from the default language; absent where there is nothing to translate from. */
  onTranslate?: (language: string, assetKey: string) => void;
  defaultLanguage?: string;
  /** Open this asset in another language. */
  onLanguage?: (language: string) => void;
  /**
   * Where this asset's scene sits on the storyboard: its name, the way back to the board,
   * and the scenes either side. Absent for media no scene uses.
   */
  sceneNav?: {
    label: string;
    onBoard: () => void;
    previous: { label: string; open: () => void } | null;
    next: { label: string; open: () => void } | null;
  };
}) {
  const [voiceChoice, setVoice] = useState("");
  const group = manifest.assets[language] ?? [];
  const asset = group.find((entry) => entry.key === selection?.key);
  const voice = voices.includes(voiceChoice) ? voiceChoice : (voices[0] ?? "");
  const imageUrl = `${endpoint}/media-image?${new URLSearchParams({
    language,
    assetKey: asset?.key ?? "",
    expectedRevision: revision,
    ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
  })}`;
  const audioUrl = (runId: string) => `${endpoint}/runs/${encodeURIComponent(runId)}/audio`;
  const generatedImageUrl = (runId: string) =>
    `${endpoint}/runs/${encodeURIComponent(runId)}/image`;
  /**
   * Store a trimmed clip as an upload and bind the asset to it. The file is no longer the
   * one a speech run produced, so the asset stops claiming that run's output.
   */
  async function trimTo(wav: Uint8Array) {
    if (!asset) return;
    const stored = await onUpload(
      new File([wav as BlobPart], `${asset.key}-trimmed.wav`, { type: "audio/wav" }),
    );
    edit((entry) => {
      entry.path = stored.path;
      delete entry.generatedAudio;
      delete entry.wordTimings;
      delete entry.durationMs;
    });
  }
  function edit(change: (entry: NonNullable<typeof asset>) => void) {
    if (!asset || !editable || disabled) return;
    const updated = structuredClone(manifest);
    change(updated.assets[language]!.find((entry) => entry.key === asset.key)!);
    onChange(updated);
  }
  const audioCandidates = runs.filter(
    (run) =>
      run.kind === "audio" &&
      run.audio?.language === language &&
      run.audio?.assetKey === asset?.key,
  );
  const imageCandidates = runs.filter(
    (run) =>
      run.kind === "image" &&
      run.image?.language === language &&
      run.image?.assetKey === asset?.key,
  );
  const textCandidates = runs.filter(
    (run) =>
      run.kind === "media-text" &&
      run.mediaText?.language === language &&
      run.mediaText?.assetKey === asset?.key &&
      run.mediaText?.type === asset?.type,
  );
  const acceptedImage = runs.find((run) => run.runId === asset?.generatedImage?.runId)?.image;
  const acceptedAudio = runs.find((run) => run.runId === asset?.generatedAudio?.runId)?.audio;
  return (
    <section aria-label={S.activities.sceneAssets} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sceneNav && (
        <nav
          aria-label={S.activities.studioBoard.back}
          className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1 text-xs dark:border-gray-800"
        >
          <Button size="sm" variant="ghost" onClick={sceneNav.onBoard}>
            {S.activities.studioBoard.back}
          </Button>
          <span aria-hidden className="text-gray-300 dark:text-gray-700">
            /
          </span>
          <span className="min-w-0 flex-1 truncate px-1 text-gray-600 dark:text-gray-400">
            {sceneNav.label}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sceneNav.previous}
            aria-label={
              sceneNav.previous
                ? S.activities.studioBoard.previousScene(sceneNav.previous.label)
                : S.activities.studioBoard.previous
            }
            onClick={() => sceneNav.previous?.open()}
          >
            {S.activities.studioBoard.previous}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sceneNav.next}
            aria-label={
              sceneNav.next
                ? S.activities.studioBoard.nextScene(sceneNav.next.label)
                : S.activities.studioBoard.next
            }
            onClick={() => sceneNav.next?.open()}
          >
            {S.activities.studioBoard.next}
          </Button>
        </nav>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {asset ? asset.key : S.activities.sceneAssets}
          </h3>
          {asset && (
            <p className="truncate text-xs text-gray-500">
              {selection?.sceneId ? `${selection.sceneId} · ` : ""}
              {S.activities.mediaTypes[asset.type]}
            </p>
          )}
        </div>
        {asset && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${asset.path ? toneSurface.success : toneSurface.attention}`}
          >
            {asset.path ? S.activities.boundMedia : S.activities.unboundMedia}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!asset ? (
          <p className="text-sm text-gray-500">{S.activities.chooseSceneAsset}</p>
        ) : (
          <div className="mx-auto max-w-4xl space-y-3">
            {asset.type === "image" ? (
              <Textarea
                size="sm"
                label={S.activities.imageDescription}
                hint={S.activities.imageDescriptionHint}
                rows={4}
                maxLength={5000}
                value={asset.description}
                disabled={!editable || disabled}
                onChange={(event) =>
                  edit((entry) => {
                    entry.description = event.target.value;
                  })
                }
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">{asset.description}</p>
            )}
            {asset.type === "image" && editable && (
              <Button
                size="sm"
                disabled={!canGenerate}
                onClick={() => onGenerateText(language, asset.key)}
              >
                {S.activities.improveImagePrompt}
              </Button>
            )}
            {asset.type === "image" &&
              editable &&
              !asset.generatedImage &&
              (!asset.path ? (
                <p className="text-xs text-gray-500">{S.activities.imageUnbound}</p>
              ) : !canPreview ? (
                <p className="text-xs text-gray-500">{S.activities.imageSaveFirst}</p>
              ) : (
                <ImagePreview key={imageUrl} src={imageUrl} description={asset.description} />
              ))}
            {asset.type === "image" && asset.generatedImage && (
              <section className="space-y-1" aria-label={S.activities.acceptedImage}>
                <p className="text-xs font-medium">{S.activities.acceptedImage}</p>
                {acceptedImage && acceptedImage.prompt !== asset.description && (
                  <p className={`text-xs ${toneInk.attention}`}>{S.activities.mediaTextChanged}</p>
                )}
                <ImagePreview
                  key={`${endpoint}/${asset.generatedImage.runId}`}
                  src={generatedImageUrl(asset.generatedImage.runId)}
                  description={asset.description}
                />
              </section>
            )}
            <p className="break-words text-xs text-gray-500">
              {S.activities.usedInScenes}:{" "}
              {[...new Set(asset.usages.map((usage) => usage.sceneId))].join(", ") ||
                S.activities.noSceneUsage}
            </p>
            <MediaBinding
              asset={asset}
              siblings={group}
              media={media}
              mediaLoading={mediaLoading}
              endpoint={endpoint}
              editable={editable}
              disabled={disabled}
              onUpload={onUpload}
              onChange={(path) =>
                edit((entry) => {
                  if (path) entry.path = path;
                  else delete entry.path;
                  // Timings describe the recording that was bound, not this one.
                  delete entry.wordTimings;
                  delete entry.durationMs;
                })
              }
            />
            {asset.type === "audio" && !asset.generatedAudio && isUploadPath(asset.path) && (
              <WaveformPlayer
                src={`${endpoint}/media-upload?path=${encodeURIComponent(asset.path!)}`}
                label={asset.key}
                onTrim={editable && !disabled ? trimTo : undefined}
              />
            )}
            {(asset.type === "video" || asset.type === "animation") &&
              (isUploadPath(asset.path) ? (
                <MediaPlayer
                  kind="video"
                  src={`${endpoint}/media-upload?path=${encodeURIComponent(asset.path!)}`}
                  label={asset.key}
                />
              ) : (
                <p className="text-xs text-gray-500">{S.activities.noInAppPreview}</p>
              ))}
            {asset.type === "audio" && (
              <>
                <Textarea
                  size="sm"
                  label={S.activities.speechScript}
                  hint={S.activities.speechScriptHint}
                  rows={4}
                  maxLength={5000}
                  value={asset.script ?? ""}
                  disabled={!editable || disabled}
                  onChange={(event) =>
                    edit((entry) => {
                      entry.script = event.target.value;
                      delete entry.wordTimings;
                    })
                  }
                />
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!canGenerate}
                      onClick={() => onGenerateText(language, asset.key)}
                    >
                      {S.activities.improveNarration}
                    </Button>
                    {onTranslate && (
                      <Button
                        size="sm"
                        disabled={!canGenerate}
                        onClick={() => onTranslate(language, asset.key)}
                      >
                        {S.activities.speechTranslation.translate}
                      </Button>
                    )}
                  </div>
                )}
                {onLanguage && (
                  <NarrationLanguages
                    manifest={manifest}
                    assetKey={asset.key}
                    language={language}
                    defaultLanguage={defaultLanguage}
                    onLanguage={onLanguage}
                  />
                )}
                {asset.generatedAudio && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">{S.activities.acceptedAudio}</p>
                    {acceptedAudio && acceptedAudio.script !== asset.script && (
                      <p className={`text-xs ${toneInk.attention}`}>
                        {S.activities.mediaTextChanged}
                      </p>
                    )}
                    <WaveformPlayer
                      key={asset.generatedAudio.runId}
                      src={audioUrl(asset.generatedAudio.runId)}
                      label={S.activities.acceptedAudio}
                      autoLoad
                      onTrim={editable && !disabled ? trimTo : undefined}
                    />
                  </div>
                )}
                {editable && (
                  <>
                    <Select
                      size="sm"
                      label={S.activities.speechVoice}
                      value={voice}
                      disabled={disabled}
                      onChange={(event) => setVoice(event.target.value)}
                    >
                      {voices.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={
                        !canGenerateMedia ||
                        !voice ||
                        !asset.script?.trim() ||
                        asset.script.length > 5000
                      }
                      onClick={() => onGenerateAudio(language, asset.key, voice)}
                    >
                      {asset.path ? S.activities.regenerateSpeech : S.activities.generateSpeech}
                    </Button>
                  </>
                )}
                {audioCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.speechCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.speechCandidates}</h5>
                    {audioCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {run.audio?.voice} · {new Date(run.createdAt).toLocaleString()} ·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <WaveformPlayer
                              key={run.runId}
                              src={audioUrl(run.runId)}
                              label={S.activities.speechCandidate}
                            />
                          )}
                        {editable &&
                          run.status === "succeeded" &&
                          run.runId !== asset.generatedAudio?.runId && (
                            <Button
                              size="sm"
                              disabled={!canAccept || run.inputRevision !== revision}
                              onClick={() => onAcceptAudio(run.runId)}
                            >
                              {S.activities.acceptSpeech}
                            </Button>
                          )}
                        {run.inputRevision !== revision &&
                          run.runId !== asset.generatedAudio?.runId && (
                            <p className="text-xs text-gray-500">{S.activities.olderSpeech}</p>
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {asset.type === "image" && (
              <>
                {editable && (
                  <Button
                    size="sm"
                    disabled={
                      !canGenerateMedia ||
                      !asset.description.trim() ||
                      asset.description.length > 5000
                    }
                    onClick={() => onGenerateImage(language, asset.key)}
                  >
                    {asset.generatedImage
                      ? S.activities.regenerateImage
                      : S.activities.generateImage}
                  </Button>
                )}
                {imageCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.imageCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.imageCandidates}</h5>
                    {imageCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {new Date(run.createdAt).toLocaleString()} Â·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <ImagePreview
                              key={`${endpoint}/${run.runId}`}
                              src={generatedImageUrl(run.runId)}
                              description={run.image?.prompt ?? asset.description}
                            />
                          )}
                        {editable &&
                          run.status === "succeeded" &&
                          run.runId !== asset.generatedImage?.runId && (
                            <Button
                              size="sm"
                              disabled={!canAccept || run.inputRevision !== revision}
                              onClick={() => onAcceptImage(run.runId)}
                            >
                              {S.activities.acceptImage}
                            </Button>
                          )}
                        {run.inputRevision !== revision &&
                          run.runId !== asset.generatedImage?.runId && (
                            <p className="text-xs text-gray-500">{S.activities.olderImage}</p>
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {(asset.type === "image" || asset.type === "audio") && (
              <>
                {textCandidates.length > 0 && (
                  <section className="space-y-3" aria-label={S.activities.textCandidates}>
                    <h5 className="text-xs font-semibold">{S.activities.textCandidates}</h5>
                    {textCandidates.map((run) => (
                      <div
                        key={run.runId}
                        className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
                      >
                        <p className="text-xs">
                          {new Date(run.createdAt).toLocaleString()} ·{" "}
                          {S.activities.speechStatus[run.status]}
                        </p>
                        {run.error && <p className="break-words text-xs">{run.error}</p>}
                        {run.hasCandidate &&
                          (run.status === "succeeded" || run.status === "conflict") && (
                            <MediaTextReview
                              key={`${endpoint}/${run.runId}`}
                              endpoint={`${endpoint}/runs/${encodeURIComponent(run.runId)}/candidate`}
                              target={run.mediaText!}
                              currentText={
                                asset.type === "image" ? asset.description : (asset.script ?? "")
                              }
                              stale={run.inputRevision !== revision}
                              editable={editable && run.status === "succeeded"}
                              canAccept={canAccept && run.inputRevision === revision}
                              onAccept={() => onAcceptText(run.runId)}
                            />
                          )}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {editable && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5 dark:border-gray-800">
          <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
            {asset?.path ? asset.path : S.activities.unboundMedia}
          </p>
          <Button
            size="sm"
            variant="primary"
            disabled={disabled || !mediaDirty}
            onClick={onSaveMedia}
          >
            {S.activities.saveMedia}
          </Button>
        </div>
      )}
    </section>
  );
}
