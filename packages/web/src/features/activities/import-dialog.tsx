import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { filterImportSources, type ImportSource, type ImportSources } from "./import-sources";

/** What the server says about one import, as far as this dialog shows it. */
interface ImportResult {
  message: string;
  problems: string[];
}

/**
 * Bringing activities Loom generated into this project.
 *
 * Lists what the WAF checkout offers -- reading only, nothing is imported by looking -- and
 * imports one product at a time, showing the server's own account of what was created,
 * repaired or left behind beside it rather than a bare success.
 */
export function ImportDialog({
  projectId,
  onClose,
  onImported,
}: {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities`;
  const [sources, setSources] = useState<ImportSources | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ImportResult | { error: string }>>({});

  useEffect(() => {
    let live = true;
    apiFetch<ImportSources>(`${base}/import-sources`)
      .then((value) => {
        if (live) setSources(value);
      })
      .catch((cause: unknown) => {
        if (live) setError(apiErrorText(cause));
      });
    return () => {
      live = false;
    };
  }, [base]);

  const visible = useMemo(
    () => filterImportSources(sources?.products ?? [], search),
    [sources, search],
  );

  async function importProduct(source: ImportSource) {
    const key = `${source.product.moduleFolder}/${source.product.productCode}`;
    setImporting(key);
    try {
      const result = await apiFetch<ImportResult>(`${base}/import`, {
        method: "POST",
        body: {
          moduleFolder: source.product.moduleFolder,
          productCode: source.product.productCode,
        },
      });
      setResults((current) => ({ ...current, [key]: result }));
      onImported();
    } catch (cause) {
      setResults((current) => ({ ...current, [key]: { error: apiErrorText(cause) } }));
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal
      open
      title={S.activities.importFromLoom}
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose} disabled={importing !== null}>
          {S.common.close}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">{S.activities.importHelp}</p>
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {!sources && !error && (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.importLoading}
          </p>
        )}
        {sources && sources.modulesDir === null && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.importNoCheckout}
          </p>
        )}
        {sources && sources.modulesDir !== null && sources.products.length === 0 && (
          <p className="text-sm text-gray-500">{S.activities.importEmpty}</p>
        )}
        {sources && sources.products.length > 0 && (
          <>
            <Input
              size="sm"
              aria-label={S.activities.importSearch}
              placeholder={S.activities.importSearch}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ul className="max-h-[50vh] space-y-2 overflow-auto">
              {visible.map((source) => {
                const key = `${source.product.moduleFolder}/${source.product.productCode}`;
                const result = results[key];
                return (
                  <li
                    key={key}
                    className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {source.product.title || source.product.productCode}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {source.product.productCode} · {source.product.moduleFolder} ·{" "}
                          {S.activities.importRefs(source.refs.length)}
                          {source.problems.length > 0 &&
                            ` · ${S.activities.importProblems(source.problems.length)}`}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant={result && !("error" in result) ? "ghost" : "primary"}
                        disabled={importing !== null}
                        onClick={() => void importProduct(source)}
                      >
                        {importing === key
                          ? S.activities.importing
                          : result && !("error" in result)
                            ? S.activities.importImported
                            : S.activities.importAction}
                      </Button>
                    </div>
                    {result && "error" in result && (
                      <p role="alert" className={`text-xs ${toneInk.danger}`}>
                        {result.error}
                      </p>
                    )}
                    {result && !("error" in result) && (
                      <div
                        role="status"
                        className={`space-y-1 rounded-md border p-2 text-xs ${toneStrip[result.problems.length > 0 ? "attention" : "success"]}`}
                      >
                        <p>{result.message}</p>
                        {result.problems.length > 0 && (
                          <ul className="list-disc pl-4">
                            {result.problems.map((problem) => (
                              <li key={problem}>{problem}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
