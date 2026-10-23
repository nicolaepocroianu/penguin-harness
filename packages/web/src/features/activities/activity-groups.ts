/**
 * The Activities home's groups: one per product, its refs as rows. A product's refs
 * belong together (one product has ten), and a product code is what authors search by.
 * A code is unique only within its collection, so a group is keyed by both.
 */
import type { ActivityRecord, ActivitySummary } from "@waterford/waf-harness-server/api";
import { filterByTag } from "./activity-tags";
import { filterActivities } from "./preview";

export type GroupSort = "recent" | "code";

/**
 * The list's lenses, by what an activity needs: work under way (a run, or a milestone next),
 * the author (a media plan the specification has moved on from), or nothing (built). An
 * activity with no summary yet is in progress until the server says otherwise.
 */
export type ListLens = "all" | "progress" | "attention" | "built";
export const LIST_LENSES: readonly ListLens[] = ["all", "progress", "attention", "built"];

export function lensOf(summary: ActivitySummary | undefined): Exclude<ListLens, "all"> {
  const kind = summary?.status?.kind;
  if (kind === "stale") return "attention";
  if (kind === "built") return "built";
  return "progress";
}

/** How many activities each lens holds, among those the search and tag leave. */
export function lensCounts(
  items: readonly ActivityRecord[],
  summaries: Readonly<Record<string, ActivitySummary>>,
  options: { search: string; tag: string | null },
): Record<ListLens, number> {
  const visible = filterActivities(filterByTag(items, options.tag), options.search);
  const counts: Record<ListLens, number> = {
    all: visible.length,
    progress: 0,
    attention: 0,
    built: 0,
  };
  for (const entry of visible) counts[lensOf(summaries[entry.id])] += 1;
  return counts;
}

export interface ActivityGroup {
  /** Collection and product code together: two collections may reuse one code. */
  key: string;
  productCode: string;
  activityType: "standard" | "book";
  items: ActivityRecord[];
  canonicalId: string | null;
  /** The canonical ref can be a template: a legacy ref with no product row cannot. */
  canonicalHasProduct: boolean;
  latest: string;
}

export function groupByProduct(
  items: readonly ActivityRecord[],
  summaries: Readonly<Record<string, ActivitySummary>>,
  options: { sort: GroupSort; search: string; tag: string | null; lens?: ListLens },
): ActivityGroup[] {
  // The canonical ref is found across ALL of a product's refs, before search or tag
  // filtering: the New-ref gate follows it even when the filter hides it.
  const canonicalByKey = new Map<string, ActivityRecord>();
  for (const entry of items) {
    const key = groupKey(entry);
    if (summaries[entry.id]?.canonical === true && !canonicalByKey.has(key)) {
      canonicalByKey.set(key, entry);
    }
  }
  const lens = options.lens ?? "all";
  const visible = filterActivities(filterByTag(items, options.tag), options.search).filter(
    (entry) => lens === "all" || lensOf(summaries[entry.id]) === lens,
  );
  const byKey = new Map<string, ActivityRecord[]>();
  for (const entry of visible) {
    const key = groupKey(entry);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }
  const groups = [...byKey.entries()].map(([key, refs]): ActivityGroup => {
    const canonical = canonicalByKey.get(key);
    const canonicalId = canonical?.id ?? null;
    const ordered = [...refs].sort((left, right) =>
      left.id === canonicalId ? -1 : right.id === canonicalId ? 1 : left.refNum - right.refNum,
    );
    // refs[0]! is safe: refs is an array only created when there is at least one item in visible with this key.
    const first = refs[0]!;
    return {
      key,
      productCode: first.productCode,
      activityType: first.activityType,
      items: ordered,
      canonicalId,
      canonicalHasProduct: canonical?.productId != null,
      latest: refs.reduce((max, entry) => (entry.updatedAt > max ? entry.updatedAt : max), ""),
    };
  });
  return groups.sort((left, right) =>
    options.sort === "code"
      ? left.productCode.localeCompare(right.productCode)
      : right.latest.localeCompare(left.latest) ||
        left.productCode.localeCompare(right.productCode),
  );
}

function groupKey(entry: Pick<ActivityRecord, "collectionId" | "productCode">): string {
  return `${entry.collectionId}:${entry.productCode}`;
}

export const COLLAPSED_GROUPS_KEY = "wafh.activities.collapsedGroups";

type CollapsedStore = Record<string, string[]>;

function readStore(storage: Pick<Storage, "getItem">): CollapsedStore {
  const parsed: unknown = JSON.parse(storage.getItem(COLLAPSED_GROUPS_KEY) ?? "{}");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as CollapsedStore)
    : {};
}

export function readCollapsed(projectId: string, storage?: Pick<Storage, "getItem">): Set<string> {
  try {
    const codes = readStore(storage ?? localStorage)[projectId];
    return new Set(Array.isArray(codes) ? codes.filter((code) => typeof code === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsed(
  projectId: string,
  collapsed: ReadonlySet<string>,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  try {
    const s = storage ?? localStorage;
    const store = readStore(s);
    store[projectId] = [...collapsed];
    s.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(store));
  } catch {
    // Remembering folds is a convenience; a blocked storage just forgets them.
  }
}
