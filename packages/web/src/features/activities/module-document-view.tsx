/**
 * Configuration Data and Assessment Data: the module's own configuration and
 * assessment files for this ref, shown as they are. The module owns them (an assembly
 * wrote them, or they are the checkout's), so they are read here, not edited.
 */
import { useEffect, useState } from "react";
import type { ModuleDocuments } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { InfoPopover } from "../../components/ui/info-popover";

export function ModuleDocumentView({
  endpoint,
  kind,
  revision,
}: {
  endpoint: string;
  kind: "configuration" | "assessment";
  /** A new draft revision can mean a new assembly; read again. */
  revision: string;
}) {
  const words = S.activities.moduleDocuments;
  const [documents, setDocuments] = useState<ModuleDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleDocuments>(`${endpoint}/module-documents`)
      .then((value) => {
        if (cancelled) return;
        setDocuments(value);
        setError(null);
      })
      .catch((cause) => {
        if (!cancelled) setError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, revision]);

  if (error) return <p className={`text-sm ${toneInk.danger}`}>{words.unreadable(error)}</p>;
  if (!documents) return <p className="text-sm text-gray-500">{words.loading}</p>;
  if (!documents.source) return <p className="text-sm text-gray-500">{words.none}</p>;
  const document = documents[kind];
  if (!document) return <p className="text-sm text-gray-500">{words.missing[kind]}</p>;
  const items =
    kind === "assessment" &&
    document.value &&
    typeof document.value === "object" &&
    Array.isArray((document.value as { items?: unknown }).items)
      ? (document.value as { items: unknown[] }).items.length
      : null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sectionNames[kind]}
        <InfoPopover label={S.activities.sectionNames[kind]}>
          <p>{words.readOnly}</p>
        </InfoPopover>
      </h3>
      <p className="text-xs text-gray-500">
        {documents.source === "run"
          ? words.fromRun(document.file)
          : words.fromCheckout(document.file)}
        {items !== null && ` ${words.items(items)}.`}
      </p>
      <pre className="max-h-[70vh] overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs whitespace-pre-wrap break-words dark:border-gray-800 dark:bg-gray-900">
        {JSON.stringify(document.value, null, 2)}
      </pre>
    </section>
  );
}
