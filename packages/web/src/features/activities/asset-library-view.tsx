/**
 * The Asset Library: every asset the media plan asks for, and every file uploaded for the
 * activity, in one place. It answers the questions the scene tree cannot at a glance: what
 * is still unbound across all scenes, which are only a placeholder, which uploads nothing
 * uses, and which assets share a file. An asset is named by what it shows, its description,
 * with its key underneath for whoever needs the key, and led by its picture: an image, a
 * video's first frame, or a play button for sound. An asset opens in the editor from here.
 */
import { useState } from "react";
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { ChipGroup } from "../../components/ui/chip-group";
import { Input } from "../../components/ui/input";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import { S } from "../../lib/strings";
import {
  filterPlanned,
  filterUploads,
  plannedEntries,
  uploadEntries,
  type LibraryBinding,
  type LibraryKind,
  type PlannedEntry,
} from "./asset-library";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { ClipButton, useClipPlayer, type ClipPlayer } from "./clip-player";
import { fileSizeText } from "./media-library";
import type { MediaPreview } from "./media-preview";
import { MediaThumb } from "./media-thumb";
import { NO_PLACEHOLDERS, type PlaceholderPaths } from "./placeholder-media";
import { boundSource } from "./ref-plan";

type MediaAsset = AssetManifest["assets"][string][number];

const NO_PREVIEW = (): MediaPreview => ({ kind: "none" });

/** The box an asset's picture fills at the head of its row. */
const PICTURE =
  "h-9 w-12 shrink-0 overflow-hidden rounded border border-gray-200 dark:border-gray-800";

/** What leads an asset's row: its sound's play button when it has a file, else its picture. */
function AssetPicture({
  asset,
  preview,
  endpoint,
  player,
}: {
  asset: MediaAsset;
  preview: MediaPreview;
  endpoint: string;
  player: ClipPlayer;
}) {
  const src = asset.type === "audio" ? boundSource(asset, endpoint) : null;
  if (src)
    return (
      <span className="flex h-9 w-12 shrink-0 items-center justify-center">
        <ClipButton
          clip={{ key: asset.key, src }}
          words={asset.script || asset.description}
          player={player}
        />
      </span>
    );
  return (
    <span className={PICTURE}>
      <MediaThumb preview={preview} type={asset.type} compact />
    </span>
  );
}

const KINDS: readonly LibraryKind[] = ["all", "audio", "image", "video", "animation"];
const BINDINGS: readonly LibraryBinding[] = ["any", "unbound", "bound"];
const SOURCE_TONE: Record<NonNullable<PlannedEntry["source"]>, BadgeTone> = {
  generated: "brand",
  upload: "gray",
  checkout: "gray",
  placeholder: "amber",
};

const LINK = "text-left font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300";
/** An asset's name in its row: its words, which open it, in the ink of the text around it. */
const ASSET_NAME =
  "line-clamp-2 text-left font-medium text-gray-900 hover:text-brand-700 hover:underline dark:text-gray-100 dark:hover:text-brand-300";

export function AssetLibraryView({
  assets,
  uploads,
  uploadsLoading,
  endpoint,
  placeholders = NO_PLACEHOLDERS,
  previewOf = NO_PREVIEW,
  onOpen,
}: {
  /** The open language's group of the media plan; empty before media is planned. */
  assets: readonly MediaAsset[];
  /** The paths the server binds an asset to until a real file replaces it. */
  placeholders?: PlaceholderPaths;
  /** What an asset looks like: its picture, its video's first frame, or a placeholder. */
  previewOf?: (assetKey: string) => MediaPreview;
  uploads: readonly UploadedMedia[];
  uploadsLoading: boolean;
  endpoint: string;
  onOpen: (key: string) => void;
}) {
  const words = S.activities.assetLibrary;
  const [kind, setKind] = useState<LibraryKind>("all");
  const [binding, setBinding] = useState<LibraryBinding>("any");
  const [query, setQuery] = useState("");
  const player = useClipPlayer();
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const planned = plannedEntries(assets, placeholders);
  const files = uploadEntries(uploads, assets);
  const shownPlanned = filterPlanned(planned, kind, binding, query);
  const shownFiles = filterUploads(files, kind, binding, query);
  const uploadUrl = (path: string) => `${endpoint}/media-upload?path=${encodeURIComponent(path)}`;

  return (
    <section className="space-y-4">
      {player.element}
      <h3 className="text-sm font-semibold">{S.activities.libraryTitle}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          label={words.kind}
          value={kind}
          onChange={setKind}
          options={KINDS.map((value) => ({ value, label: S.activities.mediaTypes[value] }))}
        />
        <ChipGroup
          label={words.binding}
          value={binding}
          onChange={setBinding}
          options={BINDINGS.map((value) => ({ value, label: words.bindings[value] }))}
        />
        <div className="w-56">
          <Input
            size="sm"
            type="search"
            aria-label={words.search}
            placeholder={words.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <section aria-label={words.planned} className="space-y-2">
        <h4 className="text-xs font-semibold">
          {words.planned}{" "}
          <span className="font-normal text-gray-500">
            {words.count(shownPlanned.length, planned.length)}
          </span>
        </h4>
        {!planned.length ? (
          <p className="text-xs text-gray-500">{words.noPlan}</p>
        ) : !shownPlanned.length ? (
          <p className="text-xs text-gray-500">{words.noMatch}</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>{words.columns.asset}</th>
                  <th className={TH}>{words.columns.type}</th>
                  <th className={TH}>{words.columns.binding}</th>
                  <th className={TH}>{words.columns.scenes}</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {shownPlanned.map((entry) => (
                  <tr key={entry.key}>
                    <td className={TD}>
                      <div className={`flex items-center ${ICON_GAP.card}`}>
                        {byKey.has(entry.key) && (
                          <AssetPicture
                            asset={byKey.get(entry.key)!}
                            preview={previewOf(entry.key)}
                            endpoint={endpoint}
                            player={player}
                          />
                        )}
                        <div className="min-w-0">
                          <button
                            type="button"
                            className={ASSET_NAME}
                            onClick={() => onOpen(entry.key)}
                          >
                            {entry.description.trim() || entry.key}
                          </button>
                          {entry.description.trim() && (
                            <p className="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
                              {entry.key}
                            </p>
                          )}
                          {player.failed === entry.key && (
                            <p className={`text-xs ${toneInk.danger}`}>
                              {S.activities.clipPlayback.failed}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {S.activities.mediaTypes[entry.type]}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {entry.source ? (
                        <Badge tone={SOURCE_TONE[entry.source]}>
                          {words.sources[entry.source]}
                        </Badge>
                      ) : (
                        <Badge tone="amber">{words.unbound}</Badge>
                      )}
                    </td>
                    <td className={`${TD} text-xs text-gray-500 dark:text-gray-400`}>
                      {entry.sceneIds.join(", ") || S.activities.noSceneUsage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label={words.uploaded} className="space-y-2">
        <h4 className="text-xs font-semibold">
          {words.uploaded}{" "}
          <span className="font-normal text-gray-500">
            {words.count(shownFiles.length, files.length)}
          </span>
        </h4>
        {uploadsLoading ? (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.libraryLoading}
          </p>
        ) : !files.length ? (
          <p className="text-xs text-gray-500">{S.activities.librarySectionEmpty}</p>
        ) : !shownFiles.length ? (
          <p className="text-xs text-gray-500">{words.noMatch}</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>{words.columns.file}</th>
                  <th className={TH}>{words.columns.type}</th>
                  <th className={TH}>{words.columns.size}</th>
                  <th className={TH}>{words.columns.usedBy}</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {shownFiles.map(({ upload, usedBy }) => (
                  <tr key={upload.path}>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        {upload.kind === "image" && (
                          <img
                            src={uploadUrl(upload.path)}
                            alt=""
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded border border-gray-200 object-cover dark:border-gray-800"
                          />
                        )}
                        <span className="min-w-0 break-all text-xs">{upload.name}</span>
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {S.activities.mediaTypes[upload.kind]}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs tabular-nums`}>
                      {fileSizeText(upload.byteLength)}
                    </td>
                    <td className={`${TD} text-xs`}>
                      {usedBy.length ? (
                        <span className="flex flex-wrap gap-x-2">
                          {usedBy.map((key) => (
                            <button
                              key={key}
                              type="button"
                              className={LINK}
                              onClick={() => onOpen(key)}
                            >
                              {key}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <span className="text-gray-500">{words.unused}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
