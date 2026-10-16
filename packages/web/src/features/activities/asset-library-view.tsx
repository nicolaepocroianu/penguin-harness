/**
 * The Asset Library: every asset the media plan asks for, and every file uploaded for the
 * activity, in one place. It answers the questions the scene tree cannot at a glance: what
 * is still unbound across all scenes, which are only a placeholder, which uploads nothing
 * uses, and which assets share a file. An asset is named by what it shows or says, with its
 * key underneath for whoever needs the key, and led by its picture: an image, a video's first
 * frame, or a sound's shape and play button. An asset opens in the editor from here.
 *
 * Two layouts, remembered per viewer: a grid of tiles, what still needs a file first, and a
 * table. A table narrower than its columns need (a side panel open beside it) lays out one
 * row per asset instead (narrow-table.ts), so a key never breaks one letter per line.
 */
import { useState, type ReactNode } from "react";
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
  needsAttention,
  plannedEntries,
  readLibraryLayout,
  uploadEntries,
  writeLibraryLayout,
  type LibraryBinding,
  type LibraryKind,
  type LibraryLayout,
  type PlannedEntry,
} from "./asset-library";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { ClipButton, useClipPlayer, type ClipPlayer } from "./clip-player";
import { ClipWave } from "./clip-wave";
import { fileSizeText } from "./media-library";
import type { MediaPreview } from "./media-preview";
import { MediaThumb } from "./media-thumb";
import { useTableLayout } from "./narrow-table";
import { NO_PLACEHOLDERS, type PlaceholderPaths } from "./placeholder-media";
import { boundSource } from "./ref-plan";
import { formatClipLength } from "./script-media";

type MediaAsset = AssetManifest["assets"][string][number];

const NO_PREVIEW = (): MediaPreview => ({ kind: "none" });

/** The narrowest the plan's four columns read in: below it, one row per asset. */
const PLANNED_TABLE_MIN = 640;
/** The same for the uploads' four columns. */
const UPLOADS_TABLE_MIN = 560;

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

/** What an asset is called where it is listed: what it says, what it shows, or its key. */
function assetName(entry: PlannedEntry, asset: MediaAsset | undefined): string {
  if (entry.type === "audio" && asset?.script?.trim()) return asset.script.trim();
  return entry.description.trim() || entry.key;
}

/** Where a planned asset's file came from, said as a badge; nothing bound says so in amber. */
function SourceBadge({ entry }: { entry: PlannedEntry }) {
  const words = S.activities.assetLibrary;
  return entry.source ? (
    <Badge tone={SOURCE_TONE[entry.source]}>{words.sources[entry.source]}</Badge>
  ) : (
    <Badge tone="amber">{words.unbound}</Badge>
  );
}

/** A tile of the grid: the asset's picture or its sound, what it is called, and where it is used. */
function AssetTile({
  entry,
  asset,
  preview,
  endpoint,
  player,
  onOpen,
}: {
  entry: PlannedEntry;
  asset: MediaAsset | undefined;
  preview: MediaPreview;
  endpoint: string;
  player: ClipPlayer;
  onOpen: (key: string) => void;
}) {
  const words = S.activities.assetLibrary;
  const name = assetName(entry, asset);
  const src = asset?.type === "audio" ? boundSource(asset, endpoint) : null;
  const sounding = player.playing === entry.key;
  const scenes = entry.sceneIds.join(", ");
  return (
    <li className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="relative aspect-[16/11]">
        {src ? (
          <div
            className={`flex size-full items-center justify-center px-3 ${
              sounding ? "bg-brand-50 dark:bg-brand-950/70" : "bg-gray-50 dark:bg-gray-900"
            }`}
          >
            <ClipWave
              src={src}
              bars={22}
              played={sounding ? player.progress : 0}
              className="h-8 w-full text-brand-600 dark:text-brand-300"
            />
            <span className="absolute bottom-1.5 left-1.5">
              <ClipButton clip={{ key: entry.key, src }} words={name} player={player} />
            </span>
            {asset?.durationMs !== undefined && (
              <span className="absolute right-1.5 bottom-1.5 font-mono text-xs text-gray-500 tabular-nums dark:text-gray-400">
                {formatClipLength(asset.durationMs)}
              </span>
            )}
          </div>
        ) : (
          <MediaThumb preview={preview} type={entry.type} />
        )}
        {!entry.path && (
          <span className="absolute top-1.5 left-1.5">
            <Badge tone="amber">{words.needsFile}</Badge>
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-2.5 py-2">
        <button
          type="button"
          title={entry.key}
          className={`${ASSET_NAME} text-xs`}
          onClick={() => onOpen(entry.key)}
        >
          {name}
        </button>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {words.facts([
            S.activities.mediaTypes[entry.type],
            scenes ? words.scenes(scenes) : S.activities.noSceneUsage,
          ])}
        </p>
        {player.failed === entry.key && (
          <p className={`text-xs ${toneInk.danger}`}>{S.activities.clipPlayback.failed}</p>
        )}
      </div>
    </li>
  );
}

/** One group of the grid, under its heading and count. */
function TileGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h5 className="text-xs font-semibold">
        {title} <span className="font-normal text-gray-500">{count}</span>
      </h5>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">{children}</ul>
    </section>
  );
}

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
  const [layout, setLayout] = useState<LibraryLayout>(() => readLibraryLayout());
  const [plannedBox, plannedLayout] = useTableLayout<HTMLElement>(PLANNED_TABLE_MIN);
  const [uploadsBox, uploadsLayout] = useTableLayout<HTMLElement>(UPLOADS_TABLE_MIN);
  const player = useClipPlayer();
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const planned = plannedEntries(assets, placeholders);
  const files = uploadEntries(uploads, assets);
  const shownPlanned = filterPlanned(planned, kind, binding, query);
  const shownFiles = filterUploads(files, kind, binding, query);
  const uploadUrl = (path: string) => `${endpoint}/media-upload?path=${encodeURIComponent(path)}`;
  const attention = shownPlanned.filter(needsAttention);
  const ready = shownPlanned.filter((entry) => !needsAttention(entry));

  function chooseLayout(next: LibraryLayout) {
    setLayout(next);
    writeLibraryLayout(next);
  }

  const tile = (entry: PlannedEntry) => (
    <AssetTile
      key={entry.key}
      entry={entry}
      asset={byKey.get(entry.key)}
      preview={previewOf(entry.key)}
      endpoint={endpoint}
      player={player}
      onOpen={onOpen}
    />
  );

  /** An asset's name, key and trouble, as the table's first cell and a stacked row both lead. */
  const nameBlock = (entry: PlannedEntry) => {
    const name = assetName(entry, byKey.get(entry.key));
    return (
      <div className="min-w-0">
        <button type="button" className={ASSET_NAME} onClick={() => onOpen(entry.key)}>
          {name}
        </button>
        {name !== entry.key && (
          <p
            className="truncate font-mono text-xs text-gray-500 dark:text-gray-400"
            title={entry.key}
          >
            {entry.key}
          </p>
        )}
        {player.failed === entry.key && (
          <p className={`text-xs ${toneInk.danger}`}>{S.activities.clipPlayback.failed}</p>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      {player.element}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{S.activities.libraryTitle}</h3>
        <span className="flex-1" />
        <ChipGroup
          label={words.layout}
          value={layout}
          onChange={chooseLayout}
          options={(["grid", "table"] as const).map((value) => ({
            value,
            label: words.layouts[value],
          }))}
        />
      </div>
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

      <section ref={plannedBox} aria-label={words.planned} className="space-y-2">
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
        ) : layout === "grid" ? (
          <div className="space-y-4">
            {attention.length > 0 && (
              <TileGroup title={words.needsAttention} count={attention.length}>
                {attention.map(tile)}
              </TileGroup>
            )}
            {ready.length > 0 && (
              <TileGroup title={words.ready} count={ready.length}>
                {ready.map(tile)}
              </TileGroup>
            )}
          </div>
        ) : plannedLayout === "stacked" ? (
          <ul className={`${TABLE_WRAP} ${TBODY}`}>
            {shownPlanned.map((entry) => (
              <li key={entry.key} className={`flex items-start px-3 py-2 text-sm ${ICON_GAP.card}`}>
                {byKey.has(entry.key) && (
                  <AssetPicture
                    asset={byKey.get(entry.key)!}
                    preview={previewOf(entry.key)}
                    endpoint={endpoint}
                    player={player}
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  {nameBlock(entry)}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{S.activities.mediaTypes[entry.type]}</span>
                    <SourceBadge entry={entry} />
                    <span>
                      {entry.sceneIds.length
                        ? words.scenes(entry.sceneIds.join(", "))
                        : S.activities.noSceneUsage}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
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
                        {nameBlock(entry)}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {S.activities.mediaTypes[entry.type]}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <SourceBadge entry={entry} />
                    </td>
                    <td className={`${TD} text-xs text-gray-500 dark:text-gray-400`}>
                      {/* Scene ids are words a reader reads whole: one per line, never split. */}
                      {entry.sceneIds.length ? (
                        <span className="flex flex-col whitespace-nowrap">
                          {entry.sceneIds.map((id) => (
                            <span key={id}>{id}</span>
                          ))}
                        </span>
                      ) : (
                        S.activities.noSceneUsage
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section ref={uploadsBox} aria-label={words.uploaded} className="space-y-2">
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
        ) : uploadsLayout === "stacked" ? (
          <ul className={`${TABLE_WRAP} ${TBODY}`}>
            {shownFiles.map(({ upload, usedBy }) => (
              <li key={upload.path} className="flex items-start gap-2 px-3 py-2">
                {upload.kind === "image" && (
                  <img
                    src={uploadUrl(upload.path)}
                    alt=""
                    loading="lazy"
                    className="h-8 w-8 shrink-0 rounded border border-gray-200 object-cover dark:border-gray-800"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                  <p className="truncate font-medium" title={upload.name}>
                    {upload.name}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400">
                    {words.facts([
                      S.activities.mediaTypes[upload.kind],
                      fileSizeText(upload.byteLength),
                    ])}
                  </p>
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
                </div>
              </li>
            ))}
          </ul>
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
