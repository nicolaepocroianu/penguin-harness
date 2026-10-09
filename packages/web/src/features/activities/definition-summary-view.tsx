/**
 * The Module Definition at a glance: its engine and versions, the files it loads, each theme's
 * properties, and the other build documents beside it. Read-only; the JSON view edits it.
 *
 * Whether a file is in the module is asked of the preview's own module route, which reads the
 * same module the documents came from, so a "Found" here is a file the player would load.
 */
import { useEffect, useState } from "react";
import type { ModuleDocuments } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import {
  TABLE,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
  TBODY,
  TD,
  TH,
} from "../../components/ui/table-classes";
import {
  assessmentItemCount,
  filePresence,
  moduleFileUrl,
  readDefinition,
  type DefinitionFile,
  type FilePresence,
} from "./module-document";

/** Past this many characters a property value is clamped to two lines until asked for. */
const LONG_VALUE = 140;

const PRESENCE_TONE: Record<FilePresence | "checking", Tone> = {
  checking: "muted",
  found: "success",
  missing: "danger",
  unknown: "muted",
};

const CARD = "rounded-lg border border-gray-200 dark:border-gray-800";

/** Each file's presence in the module, by path; absent while it is being asked. */
function usePresence(endpoint: string, revision: string, paths: readonly string[], on: boolean) {
  const [presence, setPresence] = useState<Record<string, FilePresence>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!on || !key) return;
    let cancelled = false;
    setPresence({});
    for (const path of key.split("\n"))
      fetch(moduleFileUrl(endpoint, path), { method: "HEAD", credentials: "same-origin" })
        .then((response) => filePresence(response.status))
        .catch((): FilePresence => "unknown")
        .then((state) => {
          if (!cancelled) setPresence((current) => ({ ...current, [path]: state }));
        });
    return () => {
      cancelled = true;
    };
  }, [endpoint, revision, key, on]);
  return presence;
}

export function DefinitionSummaryView({
  endpoint,
  revision,
  text,
  unsaved,
  documents,
  onShowJson,
  onOpenSection,
}: {
  endpoint: string;
  revision: string;
  /** The definition as the editor holds it, saved or not. */
  text: string;
  unsaved: boolean;
  documents: ModuleDocuments;
  onShowJson: () => void;
  onOpenSection?: (section: "configuration" | "assessment") => (() => void) | undefined;
}) {
  const words = S.activities.moduleDocuments.summary;
  const read = readDefinition(text);
  const files = "summary" in read ? read.summary.files : [];
  // Only an assembled module or the checkout has files to look in; a draft-only edit has none.
  const hasModule = documents.source === "run" || documents.source === "checkout";
  const paths = [...new Set(files.flatMap((file) => (file.path ? [file.path] : [])))];
  const presence = usePresence(endpoint, revision, paths, hasModule);

  if ("error" in read)
    return (
      <div
        role="status"
        className={`space-y-2 rounded-md border p-3 text-sm ${toneStrip.attention}`}
      >
        <p>{words.unreadable(read.error)}</p>
        <Button size="sm" onClick={onShowJson}>
          {words.openJson}
        </Button>
      </div>
    );
  const summary = read.summary;
  const pair = (a: string | number | null, b: string | number | null) =>
    `${a ?? words.none} · ${b ?? words.none}`;
  const tiles = [
    { label: words.engine, value: summary.engine ?? words.none },
    {
      label: words.versions,
      value: pair(summary.schemaVersion, summary.specificationVersion),
    },
    {
      label: words.themes,
      value: summary.themes.length
        ? summary.themes.map((theme) => theme.name).join(", ")
        : words.none,
    },
    { label: words.counts, value: pair(summary.assets, summary.properties) },
  ];

  return (
    <div className="space-y-5">
      {unsaved && <p className="text-xs text-gray-500">{words.unsaved}</p>}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={`min-w-0 px-3 py-2.5 ${CARD}`}>
            <dt className="text-xs text-gray-500">{tile.label}</dt>
            <dd className="mt-1 truncate text-sm font-semibold" title={tile.value}>
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {words.files}
          <InfoPopover label={words.files}>
            <p>{words.filesAbout}</p>
          </InfoPopover>
        </h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-500">{words.noFiles}</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th className={TH}>{words.role}</th>
                  <th className={TH}>{words.file}</th>
                  <th className={TH}>{words.type}</th>
                  {hasModule && <th className={TH}>{words.presence}</th>}
                </tr>
              </thead>
              <tbody className={TBODY}>
                {files.map((file) => (
                  <FileRow
                    key={file.role}
                    file={file}
                    endpoint={endpoint}
                    hasModule={hasModule}
                    presence={
                      file.path ? (presence[file.path] ?? "checking") : ("unknown" as const)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {summary.themes.length === 0 ? (
        <p className="text-sm text-gray-500">{words.noThemes}</p>
      ) : (
        summary.themes.map((theme) => (
          <section key={theme.name} className="space-y-2">
            <h3 className="text-sm font-semibold">{words.theme(theme.name)}</h3>
            {theme.properties.length === 0 ? (
              <p className="text-sm text-gray-500">{words.noProperties}</p>
            ) : (
              <dl
                className={`grid grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] gap-x-6 gap-y-2 px-3 py-2.5 text-sm ${CARD}`}
              >
                {theme.properties.map((property) => (
                  <PropertyRow key={property.key} name={property.key} value={property.value} />
                ))}
              </dl>
            )}
          </section>
        ))
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{words.related}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <RelatedCard
            title={S.activities.sectionNames.configuration}
            line={
              documents.configuration?.file ?? S.activities.moduleDocuments.missing.configuration
            }
            onOpen={onOpenSection?.("configuration")}
          />
          <RelatedCard
            title={S.activities.sectionNames.assessment}
            line={assessmentLine(documents)}
            onOpen={onOpenSection?.("assessment")}
          />
        </div>
      </section>
    </div>
  );
}

function assessmentLine(documents: ModuleDocuments): string {
  const document = documents.assessment;
  if (!document) return S.activities.moduleDocuments.missing.assessment;
  const items = assessmentItemCount(document.value);
  return items === null
    ? document.file
    : `${document.file} · ${S.activities.moduleDocuments.items(items)}`;
}

function FileRow({
  file,
  endpoint,
  hasModule,
  presence,
}: {
  file: DefinitionFile;
  endpoint: string;
  hasModule: boolean;
  presence: FilePresence | "checking";
}) {
  const words = S.activities.moduleDocuments.summary;
  const tone = PRESENCE_TONE[presence];
  return (
    <tr>
      <td className={`${TD} whitespace-nowrap`}>
        {file.role.charAt(0).toUpperCase() + file.role.slice(1)}
      </td>
      <td className={`${TD} break-all font-mono text-xs`}>
        {file.url === null ? (
          <span className="font-sans text-gray-500">{words.noUrl}</span>
        ) : file.path && hasModule ? (
          <a
            href={moduleFileUrl(endpoint, file.path)}
            target="_blank"
            rel="noreferrer"
            title={words.openFile(file.path)}
            className="text-brand-700 hover:underline dark:text-brand-300"
          >
            {file.url}
          </a>
        ) : (
          file.url
        )}
      </td>
      <td className={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
        {file.type ?? words.none}
      </td>
      {hasModule && (
        <td className={`${TD} whitespace-nowrap`}>
          <span className={`inline-flex items-center gap-1.5 text-xs ${toneInk[tone]}`}>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${toneDot[tone]}`} />
            {words.presenceState[presence]}
          </span>
        </td>
      )}
    </tr>
  );
}

function PropertyRow({ name, value }: { name: string; value: string }) {
  const words = S.activities.moduleDocuments.summary;
  const [open, setOpen] = useState(false);
  const long = value.length > LONG_VALUE || value.includes("\n");
  return (
    <>
      <dt className="font-mono text-xs leading-5 text-gray-500">{name}</dt>
      <dd className="min-w-0">
        <p
          title={long && !open ? value : undefined}
          className={`break-words whitespace-pre-wrap ${long && !open ? "line-clamp-2" : ""}`}
        >
          {value}
        </p>
        {long && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((shown) => !shown)}
          >
            {open ? words.showLess : words.showAll}
          </Button>
        )}
      </dd>
    </>
  );
}

function RelatedCard({
  title,
  line,
  onOpen,
}: {
  title: string;
  line: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block truncate text-xs text-gray-500">{line}</span>
    </>
  );
  if (!onOpen) return <div className={`min-w-0 px-3 py-2.5 ${CARD}`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`min-w-0 px-3 py-2.5 text-left hover:border-brand-400 hover:bg-gray-50 dark:hover:border-brand-500 dark:hover:bg-gray-900 ${CARD}`}
    >
      {body}
    </button>
  );
}
