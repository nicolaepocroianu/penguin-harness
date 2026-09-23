/**
 * Loom's refs, in the activity's header: which ref of the product is open, the others to
 * move to, and what this one is called and whether others may build against it.
 *
 * A ref is an activity of its own here, so moving to another is navigation, and the page's
 * guard against leaving unsaved edits applies to it as to any other way out.
 */
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import type { ActivityRecord } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

export function RefSwitcher({
  base,
  activity,
  editable,
  onIdentity,
}: {
  /** The project's activities API path. */
  base: string;
  activity: ActivityRecord;
  editable: boolean;
  onIdentity: (record: ActivityRecord) => void;
}) {
  const words = S.activities.studioRefs;
  const navigate = useNavigate();
  const [refs, setRefs] = useState<ActivityRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [stable, setStable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stableId = useId();

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ activities: ActivityRecord[] }>(
      `${base}?${new URLSearchParams({ collectionId: activity.collectionId })}`,
    )
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
  }, [base, activity.collectionId, activity.productCode, activity.displayName, activity.stable]);

  const label = (entry: ActivityRecord) =>
    words.option(entry.refNum, entry.displayName, entry.stable);
  const others = refs.length > 1;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const record = await apiFetch<ActivityRecord>(
        `${base}/${encodeURIComponent(activity.id)}/identity`,
        { method: "PATCH", body: { displayName: name, stable } },
      );
      onIdentity(record);
      setEditing(false);
    } catch (cause) {
      setError(apiErrorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {others ? (
        <span className="w-44">
          <Select
            size="sm"
            aria-label={words.ref}
            value={activity.id}
            onChange={(event) => {
              if (event.target.value !== activity.id)
                navigate(`/activities/${encodeURIComponent(event.target.value)}`);
            }}
          >
            {refs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {label(entry)}
              </option>
            ))}
          </Select>
        </span>
      ) : (
        <span className="truncate">{label(activity)}</span>
      )}
      {activity.stable && <Badge tone="gray">{words.stable}</Badge>}
      {editable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setName(activity.displayName ?? "");
            setStable(activity.stable);
            setError(null);
            setEditing(true);
          }}
        >
          {words.settings}
        </Button>
      )}
      <Modal
        open={editing}
        title={words.settingsTitle(activity.productCode, activity.refNum)}
        onClose={() => setEditing(false)}
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
          {error && (
            <p role="alert" className={`text-xs ${toneInk.danger}`}>
              {error}
            </p>
          )}
        </div>
      </Modal>
    </span>
  );
}
