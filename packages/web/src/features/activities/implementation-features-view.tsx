/**
 * Implementation Features: patterns shipped modules implement well, which this ref can ask
 * its module assembly to reproduce exactly. Each switch saves at once, since there is
 * nothing else on the page to save; the selection is read by the next assembly.
 */
import { useId, useState } from "react";
import type { ImplementationFeature } from "@prismshadow/penguin-server/api";
import { Badge } from "../../components/ui/badge";
import { FieldLabel } from "../../components/ui/field";
import { InfoPopover } from "../../components/ui/info-popover";
import { SkeletonList } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { useActivityClient } from "./activity-client";
import { useResource } from "./use-resource";

function FeatureRow({
  feature,
  selected,
  disabled,
  onToggle,
}: {
  feature: ImplementationFeature;
  selected: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const id = useId();
  const words = S.activities.implementationFeatures;
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <FieldLabel htmlFor={id} block={false}>
            {feature.label}
          </FieldLabel>
          <Badge tone="gray">{feature.category}</Badge>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">{feature.description}</p>
        <p className="text-xs text-gray-500">{words.source(feature.sourceModule)}</p>
      </div>
      <Switch id={id} checked={selected} disabled={disabled} onChange={onToggle} />
    </li>
  );
}

export function ImplementationFeaturesView({ editable }: { editable: boolean }) {
  const words = S.activities.implementationFeatures;
  const { api, cache } = useActivityClient();
  const read = useResource(cache, api.implementationFeatures.read, "");
  const state = read.data ?? null;
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = saveError ?? (read.error ? apiErrorText(read.error) : null);
  const [saving, setSaving] = useState(false);

  async function toggle(featureId: string, on: boolean) {
    if (!state) return;
    const selectedIds = on
      ? [...state.selectedIds, featureId]
      : state.selectedIds.filter((id) => id !== featureId);
    setSaving(true);
    setSaveError(null);
    try {
      cache.put(
        api.implementationFeatures.read,
        await api.implementationFeatures.save(selectedIds),
      );
    } catch (cause) {
      setSaveError(apiErrorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sectionNames.features}
        <InfoPopover label={S.activities.sectionNames.features}>
          <p>{words.help}</p>
        </InfoPopover>
      </h3>
      {error && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.unreadable(error)}
        </p>
      )}
      {!state ? (
        !error && (
          <div role="status" aria-label={S.common.loading}>
            <SkeletonList rows={3} />
          </div>
        )
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {words.selected(state.selectedIds.length, state.features.length)}
          </p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
            {state.features.map((feature) => (
              <FeatureRow
                key={feature.id}
                feature={feature}
                selected={state.selectedIds.includes(feature.id)}
                disabled={!editable || saving}
                onToggle={(on) => void toggle(feature.id, on)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
