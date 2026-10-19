/**
 * The notice for fields the author edited that the saved draft changed differently: what is
 * in conflict, a way to see the saved version where it is cheap, and per thing in conflict
 * the two ways out: keep the author's edit, or take the saved one.
 */
import type { ActivityDraft, VideoTimeline } from "@prismshadow/penguin-server/api";
import { Button } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import { conflictGroups, conflictParts, type ConflictGroup, type FieldId } from "./draft-merge";
import { timelineLength, toSeconds } from "./scene-timeline";

/** The parts of the draft in conflict, named for the notice. */
export function conflictText(conflicts: Iterable<FieldId>): string {
  const words = S.activities.conflictParts;
  const parts = conflictParts(conflicts);
  const names = [
    ...(parts.script ? [words.script] : []),
    ...(parts.spec ? [words.spec] : []),
    ...(parts.media ? [words.media] : []),
    ...parts.assets.map(words.asset),
    ...parts.timelines.map(words.timeline),
  ];
  return names.length > 1
    ? words.and(names.slice(0, -1).join(", "), names[names.length - 1]!)
    : (names[0] ?? "");
}

function groupName(group: ConflictGroup): string {
  const words = S.activities.conflictParts;
  switch (group.kind) {
    case "script":
      return words.script;
    case "spec":
      return words.spec;
    case "media":
      return words.media;
    case "asset":
      return words.asset(group.key ?? "");
    case "timeline":
      return words.timeline(group.key ?? "");
  }
}

export function ConflictNotice({
  conflicts,
  saved,
  timelines,
  editable,
  onResolve,
  onCompareScript,
}: {
  conflicts: ReadonlySet<FieldId>;
  /** The saved draft, the other side of each conflict. */
  saved: ActivityDraft;
  /** The author's timeline edits, by `${language}/${assetKey}`. */
  timelines: Readonly<Record<string, VideoTimeline>>;
  editable: boolean;
  onResolve: (fields: readonly FieldId[], choice: "mine" | "theirs") => void;
  /** Show the script beside the saved one. */
  onCompareScript: () => void;
}) {
  const words = S.activities.conflict;
  const groups = conflictGroups(conflicts);
  /** Both versions of a timeline, by how long each plays. */
  const timelineVersions = (group: ConflictGroup) => {
    const mine = timelines[`${group.language}/${group.key}`];
    const theirs = saved.mediaPlan?.manifest.assets[group.language ?? ""]?.find(
      (asset) => asset.key === group.key,
    )?.timeline;
    return mine && theirs
      ? words.timelineVersions(toSeconds(timelineLength(theirs)), toSeconds(timelineLength(mine)))
      : null;
  };
  return (
    <div role="status" className={`space-y-2 rounded-md border p-3 text-xs ${toneStrip.attention}`}>
      <p>{S.activities.remoteChanged(conflictText(conflicts))}</p>
      {editable && (
        <ul className="space-y-2">
          {groups.map((group) => {
            const name = groupName(group);
            const versions = group.kind === "timeline" ? timelineVersions(group) : null;
            return (
              <li key={group.fields.join(" ")} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 font-medium">{name}</span>
                {versions && <span>{versions}</span>}
                {group.kind === "script" && (
                  <Button size="sm" variant="ghost" onClick={onCompareScript}>
                    {words.compareScript}
                  </Button>
                )}
                <Button
                  size="sm"
                  aria-label={words.keepMineFor(name)}
                  onClick={() => onResolve(group.fields, "mine")}
                >
                  {words.keepMine}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={words.takeTheirsFor(name)}
                  onClick={() => onResolve(group.fields, "theirs")}
                >
                  {words.takeTheirs}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
