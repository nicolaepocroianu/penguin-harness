/**
 * Activity Stats: the media plan counted and weighed, by asset type and by
 * language, in the app's own table style.
 */
import type { MediaStat } from "@prismshadow/penguin-server/api";
import { Button, EmptyState, SkeletonList } from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { useActivityClient } from "./activity-client";
import { statsTables, type StatsRow } from "./activity-stats";
import { fileSizeText } from "./media-library";
import { useResource } from "./use-resource";

function StatsTable({
  heading,
  rows,
  total,
  label,
}: {
  heading: string;
  rows: StatsRow[];
  total?: StatsRow;
  label: (row: StatsRow) => string;
}) {
  const words = S.activities.activityStats;
  const cell = "whitespace-nowrap px-3 py-2";
  const row = (entry: StatsRow, strong = false) => (
    <tr key={entry.key} className={strong ? "font-medium" : undefined}>
      <td className={cell}>{label(entry)}</td>
      <td className={`${cell} text-right tabular-nums`}>{entry.count}</td>
      <td className={`${cell} text-right tabular-nums`}>{entry.bound}</td>
      <td className={`${cell} text-right tabular-nums`}>{fileSizeText(entry.bytes)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
            <th className={`${cell} font-medium`}>{heading}</th>
            <th className={`${cell} text-right font-medium`}>{words.count}</th>
            <th className={`${cell} text-right font-medium`}>{words.bound}</th>
            <th className={`${cell} text-right font-medium`}>{words.size}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
          {rows.map((entry) => row(entry))}
          {total && row(total, true)}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityStatsView({ revision }: { revision: string }) {
  const words = S.activities.activityStats;
  // The same read the scenes' file details use, by the draft's revision.
  const { api, cache } = useActivityClient();
  const read = useResource(cache, api.media.stats, revision);
  const stats = read.data?.media ?? null;
  const error = read.error ? apiErrorText(read.error) : null;

  const tables = stats ? statsTables(stats) : null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{S.activities.sectionNames.stats}</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void cache.read(api.media.stats, revision).catch(() => undefined)}
        >
          {words.reload}
        </Button>
      </div>
      {error ? (
        <p role="alert" className={`text-sm ${toneInk.danger}`}>
          {words.unreadable(error)}
        </p>
      ) : !tables ? (
        <div role="status" aria-label={S.common.loading}>
          <SkeletonList rows={3} />
        </div>
      ) : tables.total.count === 0 ? (
        <EmptyState title={words.empty} />
      ) : (
        <>
          <StatsTable
            heading={words.type}
            rows={tables.byType}
            total={tables.total}
            label={(row) =>
              row.key === "total"
                ? words.total
                : S.activities.mediaTypes[row.key as MediaStat["type"]]
            }
          />
          {tables.byLanguage.length > 1 && (
            <StatsTable
              heading={words.language}
              rows={tables.byLanguage}
              label={(row) => row.key}
            />
          )}
          {tables.total.missing > 0 && (
            <p className={`text-xs ${toneInk.attention}`}>{words.missing(tables.total.missing)}</p>
          )}
        </>
      )}
    </section>
  );
}
