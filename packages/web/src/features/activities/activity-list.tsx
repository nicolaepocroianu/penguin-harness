/**
 * The Activities home: every activity of the project, a dense row each, grouped under a thin
 * header per product code, narrowed by a search, by one product tag at a time and by a lens
 * on what each one needs (in progress, needs the author, built), sorted by recency or by code.
 *
 * A row leads with the activity's picture, the first scene's picture or video the server names
 * in its summary, decoded here from wherever the file plays as the studio's posters are;
 * nothing about it is stored. New ref lives in the row's menu, offered where a new ref can be
 * made from the product's canonical ref and said why not where it cannot.
 */
import { useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type {
  ActivityPoster,
  ActivityRecord,
  ActivitySummary,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Chevron,
  Dropdown,
  GlyphIcon,
  EmptyState,
  IconButton,
  Input,
  Pill,
  SkeletonList,
  ICON_SIZE,
  ICONS,
  Menu,
  MenuItem,
} from "@prismshadow/penguin-ui";
import { ChipGroup } from "../../components/ui/chip-group";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { formatRelativeShort } from "../../lib/format";
import { tagCounts } from "./activity-tags";
import {
  LIST_LENSES,
  groupByProduct,
  lensCounts,
  readCollapsed,
  writeCollapsed,
  type ActivityGroup,
  type GroupSort,
  type ListLens,
} from "./activity-groups";
import { activityEndpoint } from "./activity-api";
import { mediaPreview } from "./media-preview";
import { MediaThumb } from "./media-thumb";
import { NO_PLACEHOLDERS } from "./placeholder-media";
import { runKindLabel } from "./run-toasts";

/** The columns every row shares, from the picture to the menu, once there is room for them. */
const ROW =
  "grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,9rem)_2rem] items-center gap-3 @2xl:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,13rem)_5rem_2rem]";

export function ActivityList({
  items,
  loading,
  error,
  editable,
  available,
  createDisabled = false,
  projectId,
  summaries,
  sort,
  onSort,
  search,
  onSearch,
  tag: chosenTag,
  onTag,
  lens,
  onLens,
  onRefresh,
  onOpenFromModules,
  onCreate,
  onMedia,
}: {
  items: readonly ActivityRecord[];
  loading: boolean;
  error: string;
  editable: boolean;
  available: boolean;
  /** Creating is held back while something unsaved would be lost by leaving. */
  createDisabled?: boolean;
  projectId: string;
  summaries: Readonly<Record<string, ActivitySummary>>;
  sort: GroupSort;
  onSort: (sort: GroupSort) => void;
  search: string;
  onSearch: (search: string) => void;
  /** The one tag the list is narrowed to, or null for all of them. */
  tag: string | null;
  onTag: (tag: string | null) => void;
  /** What the list shows by what each activity needs. */
  lens: ListLens;
  onLens: (lens: ListLens) => void;
  onRefresh: () => void;
  /** Open a product that is in the WAF workspace's modules into this project. */
  onOpenFromModules: () => void;
  onCreate: () => void;
  /** Open the project media library: every activity's uploads in one place. */
  onMedia: () => void;
}) {
  const counts = useMemo(() => tagCounts(items), [items]);
  // A tag that no activity carries any more (deleted, or retagged elsewhere) stops filtering.
  const tag =
    chosenTag && counts.some((entry) => entry.tag.toLowerCase() === chosenTag.toLowerCase())
      ? chosenTag
      : null;
  const words = S.activities.tags;
  const home = S.activities.home;
  const groups = useMemo(
    () => groupByProduct(items, summaries, { sort, search, tag, lens }),
    [items, summaries, sort, search, tag, lens],
  );
  const inLens = useMemo(
    () => lensCounts(items, summaries, { search, tag }),
    [items, summaries, search, tag],
  );
  const [collapsed, setCollapsed] = useState(() => readCollapsed(projectId));
  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(projectId, next);
      return next;
    });
  }
  const tagValue = counts.find((c) => c.tag.toLowerCase() === tag?.toLowerCase())?.tag ?? "";
  return (
    <div className="h-full overflow-auto">
      <div className="@container mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          {/* Reading the list again belongs to its title, not among the actions that go
              somewhere: a glyph beside the heading, named on hover and to a reader. */}
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold">{S.activities.title}</h1>
            <IconButton
              size="sm"
              variant="ghost"
              label={S.activities.refresh}
              disabled={!available}
              onClick={onRefresh}
            >
              <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.iconButton} />
            </IconButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!available} onClick={onMedia}>
              {S.activities.projectMedia.open}
            </Button>
            {editable && (
              <Button size="sm" disabled={!available} onClick={onOpenFromModules}>
                {S.activities.openFromModules.title}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="primary"
                disabled={!available || createDisabled}
                onClick={onCreate}
              >
                {S.activities.newActivity}
              </Button>
            )}
          </div>
        </header>
        {!available && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.unavailable}
          </p>
        )}
        {available && !editable && (
          <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.readOnly}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                size="sm"
                aria-label={S.activities.search}
                placeholder={S.activities.search}
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                className="max-w-sm"
              />
              <ChipGroup
                label={home.lensLabel}
                value={lens}
                onChange={onLens}
                options={LIST_LENSES.map((value) => ({
                  value,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {home.lenses[value]}
                      <span className="tabular-nums opacity-70">{inLens[value]}</span>
                    </span>
                  ),
                }))}
              />
              <span className="flex-1" />
              <ChipGroup
                label={home.sortLabel}
                value={sort}
                onChange={onSort}
                options={[
                  { value: "recent", label: home.sort.recent },
                  { value: "code", label: home.sort.code },
                ]}
              />
            </div>
            {counts.length > 0 && (
              <ChipGroup
                label={words.filter}
                value={tagValue}
                onChange={(v) => onTag(v === "" ? null : v)}
                // "All" carries no count: the lens beside it already counts what is shown.
                options={[
                  { value: "", label: words.all },
                  ...counts.map((c) => ({ value: c.tag, label: `${c.tag} · ${c.count}` })),
                ]}
              />
            )}
          </div>
        )}
        {loading ? (
          <div role="status" aria-label={S.activities.loading}>
            <SkeletonList rows={4} />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title={items.length === 0 ? S.activities.empty : S.activities.noMatches} />
        ) : (
          <div>
            {groups.map((group) => (
              <ProductGroup
                key={group.key}
                group={group}
                projectId={projectId}
                summaries={summaries}
                collapsed={collapsed.has(group.key)}
                onToggle={() => toggle(group.key)}
                editable={editable && available}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductGroup({
  group,
  projectId,
  summaries,
  collapsed,
  onToggle,
  editable,
}: {
  group: ActivityGroup;
  projectId: string;
  summaries: Readonly<Record<string, ActivitySummary>>;
  collapsed: boolean;
  onToggle: () => void;
  editable: boolean;
}) {
  const home = S.activities.home;
  const canonical = group.canonicalId ? summaries[group.canonicalId] : undefined;
  // A new ref copies the canonical ref's media plan, so it waits for one — the same gate as
  // the studio's New ref section (`hasPlan`). A legacy canonical ref with no product row is
  // refused as a template by the server, so it offers no New ref either.
  const canAddRef =
    editable && !!canonical?.hasPlan && group.canonicalId !== null && group.canonicalHasProduct;
  const newRef =
    group.canonicalId !== null
      ? `/activities/${encodeURIComponent(group.canonicalId)}?section=newRef`
      : null;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="border-b border-gray-200 dark:border-gray-800">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-1 pt-4 pb-1.5 text-left"
        >
          <Chevron open={!collapsed} />
          <span className="font-mono text-sm font-semibold">{group.productCode}</span>
          {/* Standard is what nearly every product is; only the exception is named. */}
          {group.activityType === "book" && <Pill>{S.activities.book}</Pill>}
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            {home.refs(group.items.length)}
          </span>
        </button>
      </h2>
      {!collapsed && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-900">
          {group.items.map((item) => (
            <li key={item.id}>
              <ActivityRow
                item={item}
                projectId={projectId}
                summary={summaries[item.id]}
                newRef={
                  editable
                    ? {
                        href: canAddRef ? newRef : null,
                        label: home.newRefFrom(group.productCode),
                      }
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The activity's picture: its poster's first frame or image, else a blank tile. */
function RowPicture({
  projectId,
  activityId,
  poster,
}: {
  projectId: string;
  activityId: string;
  poster: ActivityPoster | null | undefined;
}) {
  const preview = poster
    ? mediaPreview(poster.asset, activityEndpoint(projectId, activityId), NO_PLACEHOLDERS)
    : { kind: "none" as const };
  return (
    <span className="block h-10 w-14 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      <MediaThumb preview={preview} type={poster?.asset.type ?? "image"} compact />
    </span>
  );
}

/** One activity ref as a row linking to it: picture, name, status, when, menu. */
function ActivityRow({
  item,
  projectId,
  summary,
  newRef,
}: {
  item: ActivityRecord;
  projectId: string;
  summary?: ActivitySummary;
  /** New ref of this product: where it is made, or null with the reason it cannot be. */
  newRef: { href: string | null; label: string } | null;
}) {
  const home = S.activities.home;
  const { locale } = useLocale();
  const title = item.displayName ?? item.title;
  const href = `/activities/${encodeURIComponent(item.id)}`;
  return (
    <div className={`${ROW} relative px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900`}>
      <RowPicture projectId={projectId} activityId={item.id} poster={summary?.poster} />
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The name is the link, and its hit area covers the row; the menu sits above it. */}
          <Link
            to={href}
            className="truncate text-sm font-medium after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </Link>
          {summary?.canonical && (
            <span
              role="img"
              className="text-gray-400"
              aria-label={home.canonical}
              data-tooltip={home.canonical}
            >
              {/* A five-pointed star: the product's canonical ref, the one its module and shared documents live on. */}
              <GlyphIcon d={ICONS.star} size={ICON_SIZE.inlineGlyph} filled />
            </span>
          )}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          <span className="font-mono">{home.ref(item.refNum)}</span>
          {/* Narrow, the edited column folds into this line. */}
          <span className="@2xl:hidden">{` · ${formatRelativeShort(item.updatedAt, locale)}`}</span>
        </span>
      </div>
      <span className="min-w-0">{summary && <SummaryStatus summary={summary} />}</span>
      <span className="text-xs text-gray-500 tabular-nums @max-2xl:hidden dark:text-gray-400">
        {formatRelativeShort(item.updatedAt, locale)}
      </span>
      <RowMenu title={title} href={href} newRef={newRef} />
    </div>
  );
}

/** A row's menu: open the activity, and make a new ref of its product. */
function RowMenu({
  title,
  href,
  newRef,
}: {
  title: string;
  href: string;
  newRef: { href: string | null; label: string } | null;
}) {
  const home = S.activities.home;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-64 max-w-[calc(100vw-1.5rem)]"
      className="relative z-10"
      button={
        <IconButton
          size="sm"
          variant="ghost"
          aria-haspopup="menu"
          aria-expanded={open}
          label={home.more(title)}
          onClick={() => setOpen(!open)}
        >
          <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
        </IconButton>
      }
    >
      <Menu label={home.more(title)} density="md" className="py-1">
        <MenuItem label={home.open} onSelect={() => go(href)} />
        {newRef &&
          (newRef.href ? (
            <MenuItem label={newRef.label} onSelect={() => newRef.href && go(newRef.href)} />
          ) : (
            <MenuItem disabled label={newRef.label} description={home.newRefUnavailable} />
          ))}
      </Menu>
    </Dropdown>
  );
}

/**
 * Where the activity stands, in words: a run under way, a plan to redo, built, or the milestone
 * next. The next milestone already says how far it got, so the three milestones are not drawn
 * again as a bar; they are named on hover and to a reader.
 */
function SummaryStatus({ summary }: { summary: ActivitySummary }) {
  const home = S.activities.home;
  const words = home.status;
  const { status } = summary;
  const [tone, text] =
    status.kind === "running"
      ? (["busy", words.running(runKindLabel({ kind: status.runKind }))] as const)
      : status.kind === "stale"
        ? (["attention", words.stale] as const)
        : status.kind === "built"
          ? (["success", words.built] as const)
          : (["muted", words.next[status.milestone]] as const);
  const steps = (["spec", "mediaPlan", "module"] as const)
    .slice(0, summary.total)
    .map((step, index) => home.milestone(home.milestones[step], index < summary.done));
  const progress = `${home.progress(summary.done, summary.total)}: ${steps.join(", ")}`;
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs ${
        tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[tone]
      }`}
      data-tooltip={[text, ...steps].join("\n")}
      data-tooltip-extra
    >
      {/* Only a run gets a mark: it is the one state that is live. */}
      {tone === "busy" && (
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${toneDot.busy}`} />
      )}
      <span className="truncate">{text}</span>
      <span className="sr-only">{`, ${progress}`}</span>
    </span>
  );
}
