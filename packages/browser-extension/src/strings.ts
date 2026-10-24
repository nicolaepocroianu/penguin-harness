/**
 * The extension's copy, in English. The pages and the toolbar title are English only; the theme
 * (light, dark, or the device's) is the one preference the user can change, kept in storage.ts.
 */

export const strings = {
  appName: "WAF Harness Browser",
  titleConnected: (labels: string) => `WAF Harness Browser — connected to ${labels}`,
  titleNotConnected: "WAF Harness Browser — not connected",
  titlePaused: "WAF Harness Browser — paused",
  groupTitle: "WAF Harness",
  themeLabel: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  /** A switch's tooltip: what it sets, and to what. */
  choice: (setting: string, value: string) => `${setting}: ${value}`,

  pairHeading: "WAF Harness Browser",
  pairIntro:
    "Lets the agents of a WAF Harness server drive the Chrome tabs you hand them: the tabs they open in the WAF Harness group, and tabs you add with the toolbar icon. Your other tabs, your browsing history and Chrome's cookie store stay out of reach.",
  pairedTitle: "Paired servers",
  pairedNone: "No server is paired yet.",
  pairedBy: (user: string) => `paired by ${user}`,
  remove: "Remove",
  removeHint: "Forgets the server here. Revoke it in the Web App too, under Settings › Browser.",
  addTitle: "Add a server",
  serverUrlLabel: "Server address",
  serverUrlPlaceholder: "https://wafh.example.com",
  codeLabel: "Pairing code",
  codePlaceholder: "Paste the code from the Web App",
  connect: "Connect",
  connecting: "Connecting…",
  stepsTitle: "How to pair",
  step1: "In the WAF Harness Web App, open the Browser panel and choose Connect your Chrome.",
  step2:
    "Copy the server address and the pairing code it shows. The code works once, for 10 minutes.",
  step3: "Paste both here and choose Connect.",
  docsLink: "Using your own Chrome",
  docsUrl:
    "https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/builtin-browser.en.md",
  updateAvailable: (version: string) =>
    `The server runs ${version}; update this extension to match.`,

  statusConnected: "Connected",
  statusConnecting: "Connecting",
  statusWaiting: "Not reachable; retrying",
  statusReplaced: "Another Chrome took over this pairing",
  statusRevoked: "Revoked in the Web App",
  statusProtocolMismatch: "This extension is too old or too new for the server; update it",
  statusDisabled: "Turned off by the server's administrator; retrying hourly",
  statusStopped: "Not connected",
  reconnect: "Reconnect",

  errorUrlEmpty: "Enter the server's address.",
  errorUrlInvalid: "That is not a web address.",
  errorUrlScheme: "The address must start with http:// or https://.",
  errorCode: "Paste the whole pairing code: 43 letters, digits, - or _.",
  errorUnreachable: (origin: string) =>
    `${origin} did not answer. Check the address, and that the server is running.`,
  errorRefused: (message: string) => `The server refused the code: ${message}`,
  errorBadResponse: "The server's answer is not a pairing. Is this a WAF Harness server?",
  paired: (label: string) => `Paired with ${label}.`,

  popupTabs: (count: number) =>
    count === 0
      ? "No tabs handed over"
      : count === 1
        ? "1 tab handed over"
        : `${count} tabs handed over`,
  popupAdd: "Add this tab",
  popupAddTo: (label: string) => `Add this tab to ${label}`,
  popupRelease: "Release this tab",
  popupDriven: (label: string) => `${label} may drive this tab.`,
  popupReleased: "You stopped the agent on this tab. Add it again to hand it back.",
  popupRestricted: "Chrome does not let extensions drive this page.",
  popupPause: "Pause",
  popupResume: "Resume",
  popupPaused: "Paused: agents cannot act in any tab until you resume.",
  popupSettings: "Settings",
  popupNotPaired: "No server is paired. Open Settings to pair one.",
};

export type Strings = typeof strings;
