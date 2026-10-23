/**
 * A product's refs, in the activity's header: which ref is open, the others to
 * move to, and what this one is called and whether others may build against it. Its
 * settings also carry the product's tags and the way to delete the activity, and a ref
 * numbered wrongly can be given another number here.
 *
 * A ref is an activity of its own here, so moving to another is navigation, and the page's
 * guard against leaving unsaved edits applies to it as to any other way out.
 */
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import type { ActivityDetail, ActivityRecord } from "@waterford/waf-harness-server/api";
import { ApiError } from "../../api/client";
import {
  Button,
  ConfirmModal,
  FieldLabel,
  InfoPopover,
  Input,
  Modal,
  Dropdown,
  ChevronDown,
  CloseIcon,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  Pill,
  Switch,
  ICON_SIZE,
  useGuardedClose,
  useUnsavedChanges,
} from "@waterford/waf-harness-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { normalizeTagInput } from "./activity-tags";
import { checkRefNumber } from "./ref-number";
import { useActivityClient } from "./activity-client";

/** Whether two tag lists hold the same tags in the same order. */
const sameTags = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((tag, index) => tag === right[index]);

/** Why a delete was refused, in the author's words where the reason is one of ours. */
function deleteErrorText(cause: unknown): string {
  const reasons = S.activities.deleteActivity.errors as Record<string, string | undefined>;
  return (cause instanceof ApiError && reasons[cause.code]) || apiErrorText(cause);
}

/** The server's tag refusals, one code per problem, worded by the App. */
const TAG_ERRORS = {
  tags_invalid: "invalid",
  tags_too_long: "tooLong",
  tags_too_many: "tooMany",
} as const;

/** Why a save was refused, in the author's words where the reason is one of ours. */
function saveErrorText(cause: unknown): string {
  const reason =
    cause instanceof ApiError ? TAG_ERRORS[cause.code as keyof typeof TAG_ERRORS] : undefined;
  return reason ? S.activities.tags[reason] : apiErrorText(cause);
}

/** Why a renumber was refused, in the author's words where the reason is one of ours. */
function renumberErrorText(cause: unknown): string {
  const words = S.activities.studioRefs;
  if (cause instanceof ApiError && cause.code === "ref_stable") return words.stableBlocks;
  const reasons = words.renumberErrors as Record<string, string | undefined>;
  return (cause instanceof ApiError && reasons[cause.code]) || apiErrorText(cause);
}

export function RefSwitcher({
  activity,
  editable,
  revision,
  onIdentity,
  onRenumbered,
  onDeleted,
  onNewRef,
  onReload,
}: {
  activity: ActivityRecord;
  editable: boolean;
  /** The saved draft's revision; a renumber is refused if the draft moved past it. */
  revision: string;
  onIdentity: (record: ActivityRecord) => void;
  /** The ref has a new number; `detail` is the activity as the server now holds it. */
  onRenumbered: (detail: ActivityDetail, from: number) => void;
  /** The activity was deleted (archived); the caller leaves it. */
  onDeleted: () => void;
  /** Open the page that makes a new ref from this one, the product's template; absent until
   *  the ref has a media plan, which that page walks. */
  onNewRef?: () => void;
  /** Load the saved draft again; absent while it cannot be. The caller confirms a discard. */
  onReload?: () => void;
}) {
  const { api, project } = useActivityClient();
  const words = S.activities.studioRefs;
  const tagWords = S.activities.tags;
  const deleteWords = S.activities.deleteActivity;
  const navigate = useNavigate();
  const [refs, setRefs] = useState<ActivityRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [stable, setStable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [tagError, setTagError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renumbering, setRenumbering] = useState(false);
  const [numberText, setNumberText] = useState("");
  const [numberError, setNumberError] = useState<string | null>(null);
  const [numberBusy, setNumberBusy] = useState(false);
  const stableId = useId();
  const settingsScope = `ref-settings${useId()}`;
  // Whether this ref is the product's template, which is where new refs are made from.
  const [canonical, setCanonical] = useState(false);
  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    api.ref
      .nextNumber()
      .then((value) => {
        if (!cancelled) setCanonical(value?.canonical === true);
      })
      .catch(() => {
        /* Without the answer the shortcut stays hidden; nothing else depends on it. */
      });
    return () => {
      cancelled = true;
    };
  }, [api, activity.refNum, editable]);

  useEffect(() => {
    let cancelled = false;
    project
      .refs(activity.collectionId)
      .then((value) => {
        if (cancelled) return;
        setRefs(
          value.activities
            .filter((entry) => entry.productCode === activity.productCode && !entry.archived)
            .sort((left, right) => left.refNum - right.refNum),
        );
      })
      .catch(() => {
        /* The switcher is a shortcut; the header still names the ref without it. */
      });
    return () => {
      cancelled = true;
    };
  }, [
    project,
    activity.collectionId,
    activity.productCode,
    activity.displayName,
    activity.stable,
    activity.refNum,
  ]);

  /** The settings form back to the ref as it is stored. */
  function resetSettings() {
    setName(activity.displayName ?? "");
    setStable(activity.stable);
    setTags([...(activity.tags ?? [])]);
    setTagText("");
    setTagError("");
    setError(null);
  }
  // The settings dialog holds edits until Save; leaving it with some asks first.
  const settingsDirty =
    editing &&
    (name !== (activity.displayName ?? "") ||
      stable !== activity.stable ||
      !sameTags(tags, activity.tags ?? []) ||
      tagText.trim() !== "");
  useUnsavedChanges(settingsDirty, { scope: settingsScope, discard: resetSettings });
  const closeSettings = useGuardedClose(() => setEditing(false), settingsScope);

  const label = (entry: ActivityRecord) =>
    words.option(entry.refNum, entry.displayName, entry.stable);
  const others = refs.length > 1;

  /** The tags with whatever is typed but not yet added, or null when that entry is refused. */
  function withTyped(): string[] | null {
    const next = normalizeTagInput(tagText, tags);
    if ("problem" in next) {
      setTagError(tagWords[next.problem]);
      return null;
    }
    setTagError("");
    return next.tags;
  }

  function addTag() {
    const next = withTyped();
    if (!next) return;
    setTags(next);
    setTagText("");
  }

  async function save() {
    // A tag typed but not added is still meant to be kept.
    const nextTags = withTyped();
    if (!nextTags) return;
    setSaving(true);
    setError(null);
    try {
      const record = await api.ref.identity({ displayName: name, stable });
      onIdentity(record);
      if (!sameTags(nextTags, activity.tags ?? [])) {
        const saved = await api.ref.tags(nextTags);
        onIdentity({ ...record, tags: saved.tags });
      }
      setTagText("");
      setEditing(false);
    } catch (cause) {
      setError(saveErrorText(cause));
    } finally {
      setSaving(false);
    }
  }

  async function renumber() {
    const from = activity.refNum;
    const check = checkRefNumber(
      numberText,
      from,
      refs.filter((entry) => entry.id !== activity.id).map((entry) => entry.refNum),
    );
    if (!check.ok) {
      setNumberError(
        check.problem === "taken" ? words.numberTaken(check.refNum) : words.numberHint,
      );
      return;
    }
    setNumberBusy(true);
    setNumberError(null);
    try {
      const detail = await api.ref.renumber(check.refNum, revision);
      setRenumbering(false);
      onRenumbered(detail, from);
    } catch (cause) {
      setNumberError(renumberErrorText(cause));
    } finally {
      setNumberBusy(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.ref.remove();
      setConfirmDelete(false);
      onDeleted();
    } catch (cause) {
      setDeleteError(deleteErrorText(cause));
    } finally {
      setDeleting(false);
    }
  }

  // Every action on the ref, and the way to another ref, behind the ref's own name: the
  // header row stays a title with marks beside it, not a row of look-alike text buttons.
  const actions: { key: string; label: string; run: () => void }[] = [
    ...(editable
      ? [
          {
            key: "settings",
            label: words.settings,
            run: () => {
              resetSettings();
              setEditing(true);
            },
          },
          {
            key: "number",
            label: words.changeNumber,
            run: () => {
              setNumberText(String(activity.refNum));
              setNumberError(null);
              setRenumbering(true);
            },
          },
        ]
      : []),
    ...(editable && canonical && onNewRef
      ? [{ key: "new", label: S.activities.createRef.newRef, run: onNewRef }]
      : []),
  ];
  const choose = (run: () => void) => {
    setMenuOpen(false);
    run();
  };

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Dropdown
        open={menuOpen}
        setOpen={setMenuOpen}
        portal={{ direction: "down", align: "left" }}
        menuClass="w-64 max-w-[calc(100vw-1.5rem)]"
        button={
          <Button
            size="sm"
            variant="ghost"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={words.menu}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {/* Stable is said once, by the pill beside the trigger, not again in its name. */}
            <span className="max-w-48 truncate">
              {words.option(activity.refNum, activity.displayName, false)}
            </span>
            <ChevronDown className="text-gray-400" />
          </Button>
        }
      >
        <Menu label={words.menu} density="md" className="max-h-[60vh] overflow-y-auto py-1">
          {others && (
            <>
              <MenuLabel>{words.refs}</MenuLabel>
              {refs.map((entry) => (
                <MenuRadioItem
                  key={entry.id}
                  checked={entry.id === activity.id}
                  label={label(entry)}
                  onSelect={() =>
                    choose(() => {
                      if (entry.id !== activity.id)
                        navigate(`/activities/${encodeURIComponent(entry.id)}`);
                    })
                  }
                />
              ))}
              {(actions.length > 0 || onReload) && <MenuSeparator />}
            </>
          )}
          {actions.map((entry) => (
            <MenuItem key={entry.key} label={entry.label} onSelect={() => choose(entry.run)} />
          ))}
          {onReload && (
            <>
              {actions.length > 0 && <MenuSeparator />}
              <MenuItem label={S.activities.reload} onSelect={() => choose(onReload)} />
            </>
          )}
        </Menu>
      </Dropdown>
      {activity.stable && <Pill>{words.stable}</Pill>}
      <Modal
        open={renumbering}
        title={words.changeNumberTitle(activity.productCode, activity.refNum)}
        onClose={() => setRenumbering(false)}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRenumbering(false)}
              disabled={numberBusy}
            >
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void renumber()}
              disabled={
                numberBusy || activity.stable || numberText.trim() === String(activity.refNum)
              }
            >
              {words.renumber}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            size="sm"
            type="number"
            min={0}
            step={1}
            label={words.newNumber}
            hint={words.numberHint}
            value={numberText}
            disabled={activity.stable || numberBusy}
            error={numberError ?? undefined}
            onChange={(event) => {
              setNumberText(event.target.value);
              setNumberError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !activity.stable) {
                event.preventDefault();
                void renumber();
              }
            }}
          />
          {activity.stable && (
            <p className={`text-xs ${toneInk.attention}`}>{words.stableBlocks}</p>
          )}
        </div>
      </Modal>
      <Modal
        open={editing}
        title={words.settingsTitle(activity.productCode, activity.refNum)}
        onClose={closeSettings}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            size="sm"
            label={words.displayName}
            hint={words.displayNameHint}
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
          {/* The house Field-with-info layout: the title stands apart from the control and
              names it by id, so the "?" beside it is never inside a label. */}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <FieldLabel htmlFor={stableId} block={false}>
                {words.stable}
              </FieldLabel>
              <InfoPopover label={words.stable}>
                <p>{words.stableHint}</p>
              </InfoPopover>
            </span>
            <Switch id={stableId} checked={stable} onChange={setStable} />
          </div>
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  size="sm"
                  label={tagWords.label}
                  info={<p>{tagWords.about}</p>}
                  infoLabel={tagWords.label}
                  placeholder={tagWords.placeholder}
                  value={tagText}
                  error={tagError || undefined}
                  onChange={(event) => {
                    setTagText(event.target.value);
                    setTagError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                />
              </div>
              <Button size="sm" onClick={addTag} disabled={!tagText.trim()}>
                {tagWords.add}
              </Button>
            </div>
            {tags.length > 0 && (
              <ul aria-label={tagWords.label} className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2 pr-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={tagWords.removeTag(tag)}
                      onClick={() => setTags((current) => current.filter((entry) => entry !== tag))}
                      className="rounded-full p-px text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    >
                      <CloseIcon size={ICON_SIZE.rowMark} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p role="alert" className={`text-xs ${toneInk.danger}`}>
              {error}
            </p>
          )}
          <div className="flex justify-start border-t border-gray-100 pt-4 dark:border-gray-800">
            <Button
              size="sm"
              variant="danger"
              disabled={saving}
              onClick={() => {
                setDeleteError(null);
                setEditing(false);
                setConfirmDelete(true);
              }}
            >
              {deleteWords.action}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        cancelLabel={S.common.cancel}
        open={confirmDelete}
        title={deleteWords.confirmTitle}
        confirmLabel={deleteWords.action}
        busy={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      >
        <p className="text-sm">{deleteWords.deleteConfirm(activity.title, activity.refNum)}</p>
        {deleteError && (
          <p role="alert" className={`mt-2 text-xs ${toneInk.danger}`}>
            {deleteError}
          </p>
        )}
      </ConfirmModal>
    </span>
  );
}
