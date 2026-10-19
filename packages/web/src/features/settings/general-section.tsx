/**
 * General page of the Settings dialog: per-account preferences that are neither appearance nor
 * credentials. Everything applies the moment it is touched — the stores persist each value
 * (currency and task-completion notifications per browser) — so the page carries
 * no Save button and no draft state to lose.
 *
 * The notification row is the one that reaches outside the app: turning it on asks the
 * platform for permission then and there (lib/notification-pref explains why the prompt
 * hangs off this switch rather than off a page load), so it settles on whatever that
 * request answered rather than on what was clicked.
 */
import { useState, useSyncExternalStore } from "react";
import { PrefRow, Segmented, SettingsGroup, ToggleRow } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  enableNotifications,
  notificationHintFor,
  notificationPermission,
  notificationsEnabledVersion,
  readNotificationsEnabled,
  subscribeNotificationsEnabled,
  writeNotificationsEnabled,
} from "../../lib/notification-pref";
import type { NotificationAccess } from "../../lib/notification-pref";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { TraceImportRow } from "./trace-import-row";
import { VideoExperimentRow } from "./video-experiment-row";
import { useAuth } from "../../state/auth";

export function GeneralSection() {
  const { currency, setCurrency } = useTheme();
  const { serverEnabled, personalEnabled, setPersonalEnabled } = useCompany();
  const { user } = useAuth();

  useSyncExternalStore(subscribeNotificationsEnabled, notificationsEnabledVersion);
  const notificationsOn = readNotificationsEnabled();
  // What the platform last answered: its own state, because a refusal has to stay on screen
  // as a hint after the click that produced it. `asked` goes with it, so a prompt closed
  // without an answer is told apart from a browser that was simply never asked.
  const [access, setAccess] = useState<NotificationAccess>(notificationPermission);
  const [asked, setAsked] = useState(false);

  const currencyOptions: ReadonlyArray<{ value: Currency; label: string }> = [
    { value: "USD", label: S.models.currencyUsd },
    { value: "CNY", label: S.models.currencyCny },
  ];

  const hint = notificationHintFor(access, asked);
  const notificationHint =
    hint === "unsupported"
      ? S.settings.notificationsUnsupported
      : hint === "denied"
        ? S.settings.notificationsDenied
        : hint === "dismissed"
          ? S.settings.notificationsDismissed
          : undefined;

  return (
    <SettingsGroup>
      <PrefRow label={S.models.currency} info={S.settings.currencyInfo}>
        <Segmented options={currencyOptions} value={currency} onChange={setCurrency} cols={2} />
      </PrefRow>
      <ToggleRow
        label={S.settings.notifications}
        hint={notificationHint}
        info={S.settings.notificationsInfo}
        checked={notificationsOn}
        disabled={access === "unsupported"}
        onChange={(on) => {
          if (!on) {
            writeNotificationsEnabled(false);
            return;
          }
          // Only a granted request stores the preference, so anything else leaves the
          // switch where it was and turns the hint on instead.
          void enableNotifications().then((answer) => {
            setAccess(answer);
            setAsked(true);
          });
        }}
      />
      {/* The personal company-mode switch: off hides this user's mode switch and nothing else.
          Offered only while the server allows company mode at all — a switch that changes
          nothing would only invite the question of why. */}
      {serverEnabled && (
        <ToggleRow
          label={S.settings.companyModePersonal}
          info={S.settings.companyModePersonalInfo}
          checked={personalEnabled}
          onChange={setPersonalEnabled}
        />
      )}
      {/* Server-wide, so an admin's alone; the API refuses anyone else whatever is drawn. */}
      {user?.isAdmin === true && <VideoExperimentRow />}
      <TraceImportRow />
    </SettingsGroup>
  );
}
