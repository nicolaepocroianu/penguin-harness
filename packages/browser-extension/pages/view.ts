/**
 * What the options page and the popup both show: a server's connection, and the theme switch in
 * the header.
 */
import {
  parseThemePref,
  readThemePref,
  setThemePref,
  type ConnectionStatus,
  type ServerStatus,
  type ThemePref,
} from "../src/storage.js";
import { strings, type Strings } from "../src/strings.js";

export function statusText(status: ConnectionStatus | undefined, strings: Strings): string {
  switch (status) {
    case "connected":
      return strings.statusConnected;
    case "connecting":
      return strings.statusConnecting;
    case "waiting":
      return strings.statusWaiting;
    case "replaced":
      return strings.statusReplaced;
    case "revoked":
      return strings.statusRevoked;
    case "protocol_mismatch":
      return strings.statusProtocolMismatch;
    case "disabled":
      return strings.statusDisabled;
    default:
      return strings.statusStopped;
  }
}

export function statusTone(status: ConnectionStatus | undefined): "ok" | "wait" | "danger" | "off" {
  switch (status) {
    case "connected":
      return "ok";
    case "connecting":
    case "waiting":
    case "disabled":
      return "wait";
    case "replaced":
    case "revoked":
    case "protocol_mismatch":
      return "danger";
    default:
      return "off";
  }
}

/** A status dot whose meaning is in its tooltip and label, not its colour alone. */
export function statusDot(state: ServerStatus | undefined, strings: Strings): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.dataset.tone = statusTone(state?.status);
  dot.title = statusText(state?.status, strings);
  dot.setAttribute("aria-label", dot.title);
  return dot;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

export function setText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node !== null) node.textContent = text;
}

/**
 * Applies the user's theme and keeps the switch current. With no pick the theme follows the
 * device's light or dark setting live (the stylesheet's media query does that; `data-theme` is
 * set only for a picked theme). A pick in one page reaches every open page of the extension.
 */
export function followPreferences(): void {
  let theme: ThemePref = "system";
  const show = () => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    renderThemeSwitch(theme);
  };

  document
    .getElementById("theme")
    ?.addEventListener("click", () => void setThemePref(NEXT_THEME[theme]));

  void readThemePref().then((pref) => {
    theme = pref;
    show();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("uiTheme" in changes)) return;
    theme = parseThemePref(changes.uiTheme?.newValue);
    show();
  });
}

/** True for a storage change that only the theme switch cares about. */
export function isPreferenceChange(changes: Record<string, unknown>, area: string): boolean {
  return area === "local" && Object.keys(changes).every((key) => key === "uiTheme");
}

/** The theme switch steps through the three the way the product site's does. */
const NEXT_THEME: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };

/** Labels the `#theme` button with the theme it is on; its icon follows `data-mode` in CSS. */
function renderThemeSwitch(current: ThemePref): void {
  const button = document.getElementById("theme");
  if (button === null) return;
  const names: Record<ThemePref, string> = {
    light: strings.themeLight,
    dark: strings.themeDark,
    system: strings.themeSystem,
  };
  const label = strings.choice(strings.themeLabel, names[current]);
  button.dataset.mode = current;
  button.title = label;
  button.setAttribute("aria-label", label);
}
