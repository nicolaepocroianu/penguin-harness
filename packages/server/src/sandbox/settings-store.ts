/**
 * Sandbox settings, as a settings group: the confinement every agent command spawns under is
 * declared on `PluginConfigProvider.groups` like any module's settings, drawn on the Settings
 * dialog's Plugins page and stored under `plugin-config:sandbox`, so a restart keeps it. A
 * sandbox backend that has settings of its own declares its own group with `parent: "sandbox"`
 * and reads it itself; nothing here carries a backend's values.
 *
 * `SandboxSettings` declares the group and applies what is stored to the service — on boot
 * and after every save. The service stays on the capability-free floor (a bare kernel boots
 * it with no database), and its parked context still carries the settings across a hot swap:
 * on boot a saved document wins, and with none saved the service keeps what the swap carried.
 * The card's live status (what this machine enforces, which backends are not in use and why)
 * is `SandboxSettingsStatus`, in settings-status.ts.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { PluginConfig } from "../plugin/config.js";
import { Sandbox, SandboxModule } from "./service.js";
import { sandboxStartOf } from "./settings-policy.js";

/** The sandbox's group name (its contribution id), and the parent a backend's group names. */
export const SANDBOX_GROUP = "sandbox";

@Component({
  contributes: {
    "PluginConfigProvider.groups": [
      {
        id: "sandbox",
        order: 0,
        // The name the Plugins page gives the sandbox backends' category, so the card and the
        // plugins it is enforced by read as one thing.
        title: "Agent Sandbox",
        description:
          "The confinement new sessions start with, enforced by a sandbox backend plugin. A session keeps the policy it started with; change it from that session's permission button.",
        // Off, the card shows the switch alone: the presets, notices and backends' own settings
        // matter only to a confined Session.
        switch: "enabled",
        properties: {
          // No default: a document saved before the switch derives it (sandboxEnabledOf), and
          // with nothing saved that reads as off, the default mode being Off.
          enabled: {
            type: "boolean",
            title: "Enable",
            description:
              "Whether new sessions start in the sandbox. On: from the default preset. Off: with full file and network access, held only by their ask mode. Sessions that already exist keep their own policy.",
          },
          // The composer's menu: each preset a named mode, network level and approval mode, and
          // the default (marked after its name): the row a new Session starts from while on.
          // Full Access keeps its promise (nothing confined, everything approved): only its
          // name, whether the menu lists it and whether it is the default can change.
          presets: {
            type: "table",
            title: "Presets",
            description:
              "Named combinations of file access, network and ask mode. The pinned ones are what the composer's permission menu offers, and the one marked (Default) is what a new session starts from while the sandbox is on; changing it reaches new sessions only. A session keeps its own three values, and the menu names it by the first row that matches. Each name's \"?\" says what the row is for.",
            rowChoice: { field: "defaultPreset", title: "Default" },
            columnGroup: {
              title: "Action",
              description:
                "Pin: listed in the composer's permission menu. Handle: drag to reorder (or focus it and use the arrow keys); the order is the menu's. …: set the row as the default, or delete a preset you added (built-in ones can only be unpinned).",
              columns: ["enabled"],
            },
            // Presets an administrator adds: only those can be deleted; every row can be moved,
            // and the order is the composer's menu order.
            extensible: {
              add: "Add preset",
              values: {
                name: "New preset",
                enabled: false,
                mode: "workspace-write",
                network: "open",
                approvalMode: "always-ask",
              },
            },
            pin: {
              column: "enabled",
              on: "Pinned to the menu",
              off: "Not in the menu",
            },
            columns: [
              {
                name: "name",
                type: "string",
                title: "Name",
                description:
                  "What the menu and the permission button call this row. A rename keeps what the row does; clear the box to restore the original name.",
              },
              {
                name: "mode",
                type: "enum",
                title: "Files",
                description:
                  "What a confined command may write. Full access: anywhere. Workspace: the session's workspace, its scratchpad and the temp directory. Read-only: the temp directory only. Needs a sandbox backend unless Full access.",
                options: [
                  {
                    value: "danger-full-access",
                    title: "Full access",
                    description: "Commands and file tools may write anywhere.",
                  },
                  {
                    value: "workspace-write",
                    title: "Workspace write only",
                    description:
                      "Commands and file tools may write only the workspace, the session's scratchpad and the temp directory.",
                  },
                  {
                    value: "read-only",
                    title: "Read-only",
                    description:
                      "Commands and file tools may write nothing but the temp directory.",
                  },
                ],
              },
              {
                name: "network",
                type: "enum",
                title: "Network",
                description:
                  "What a confined command, hook script or read_file URL may reach. Localhost allows only this machine. Each limit needs a backend that can enforce it — sandbox-dsh confines files only — and is greyed out where the backends in use cannot.",
                options: [
                  {
                    value: "open",
                    title: "Full access",
                    description: "Any address can be reached.",
                  },
                  {
                    value: "local",
                    title: "Localhost only",
                    description: "Only this machine can be reached.",
                  },
                  {
                    value: "none",
                    title: "No network",
                    description: "Nothing can be reached.",
                  },
                ],
              },
              {
                name: "approvalMode",
                type: "enum",
                title: "Ask mode",
                description:
                  "Which tool calls run without asking: all of them, only the ones that read, none (each asks first), or none at all (every call is denied).",
                options: [
                  {
                    value: "allow-all",
                    title: "Approve everything",
                    description: "Every tool call runs without asking.",
                  },
                  {
                    value: "read-only",
                    title: "Approve read-only",
                    description: "Calls that only read run; every other call asks you first.",
                  },
                  {
                    value: "always-ask",
                    title: "Ask every time",
                    description: "Every tool call asks you first.",
                  },
                  {
                    value: "deny-all",
                    title: "Deny everything",
                    description: "Every tool call is refused.",
                  },
                ],
              },
              {
                name: "enabled",
                type: "boolean",
                title: "Pin",
                description:
                  "Whether the composer's permission menu lists this row. An unpinned row can still be the default.",
              },
            ],
            rows: [
              {
                id: "full-access",
                values: {
                  name: "Full Access",
                  enabled: true,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "allow-all",
                },
                description:
                  "No sandbox and nothing asked: the agent writes files, runs commands and uses the network freely. For work you trust and watch.",
                locked: ["mode", "network", "approvalMode"],
              },
              {
                id: "always-ask",
                values: {
                  name: "Always Ask",
                  enabled: true,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "always-ask",
                },
                description:
                  "No sandbox, but every tool call waits for your approval. For approving the work step by step.",
              },
              {
                id: "workspace-write",
                values: {
                  name: "Workspace Write",
                  enabled: true,
                  mode: "workspace-write",
                  network: "open",
                  approvalMode: "allow-all",
                },
                description:
                  "Commands and file tools change files only inside the workspace; the network is open and calls run without asking. For everyday coding.",
              },
              {
                id: "read-only",
                values: {
                  name: "Read Only",
                  enabled: true,
                  mode: "read-only",
                  network: "open",
                  approvalMode: "allow-all",
                },
                description:
                  "Nothing can be written but the temp directory; the network is open and calls run without asking. For exploring, reviewing and answering questions.",
              },
              {
                id: "workspace-write-ask",
                values: {
                  name: "Workspace Write with Ask",
                  enabled: false,
                  mode: "workspace-write",
                  network: "open",
                  approvalMode: "always-ask",
                },
                description:
                  "Like Workspace Write, but every tool call asks you first. For careful edits.",
              },
              {
                id: "denied-all",
                values: {
                  name: "Denied All",
                  enabled: false,
                  mode: "danger-full-access",
                  network: "open",
                  approvalMode: "deny-all",
                },
                description:
                  "Every tool call is refused, so the agent can only talk. For a conversation with no tool use.",
              },
            ],
          },
          // The row a new Session starts from while the switch is on, drawn only as the table's
          // "(Default)" marker. No declared default: the derive hook shows DEFAULT_PRESET, or for a
          // document stored before it the row giving that document's start, else none
          // (settings-policy.ts, prePresetStartOf).
          defaultPreset: {
            type: "enum",
            title: "Default preset",
            options: [
              { value: "full-access", title: "Full Access" },
              { value: "always-ask", title: "Always Ask" },
              { value: "workspace-write", title: "Workspace Write" },
              { value: "read-only", title: "Read Only" },
              {
                value: "workspace-write-ask",
                title: "Workspace Write with Ask",
              },
              { value: "denied-all", title: "Denied All" },
            ],
          },
          writableTemp: {
            type: "boolean",
            advanced: true,
            title: "Temporary directory writable",
            description:
              "Confined commands, hook scripts and file tools may write the system temp directory, in either mode. Shells and most tools need one to start; off keeps it read-only too. Off needs a backend that can close it — sandbox-dsh cannot — and is greyed out where the backends in use cannot.",
            default: true,
          },
          maskPaths: {
            type: "list",
            advanced: true,
            title: "Masked paths",
            description:
              "Paths hidden from confined commands, hook scripts and file tools, reads included. Needs a backend that masks paths — sandbox-dsh does not: without one, every command is refused while any is listed.",
            hint: "One absolute path per line, at most 64.",
            maxItems: 64,
            // POSIX `/…`, Windows `C:\…` or `C:/…`, or a UNC `\\server\…`.
            pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)",
            patternErrorMessage: "must list absolute paths",
          },
        },
      },
    ],
  },
})
export class SandboxSettings {
  @Use() private readonly pluginConfig!: PluginConfig;
  @Use(SandboxModule) private readonly sandbox!: Sandbox;
  setup() {
    const { pluginConfig, sandbox } = this;
    // A saved document wins; with none saved the service keeps what the swap carried —
    // applying the defaults here would un-confine a deployment on every hot update.
    const schema = () => pluginConfig.schema(SANDBOX_GROUP);
    if (pluginConfig.saved(SANDBOX_GROUP)) {
      sandbox.configure(sandboxStartOf(schema(), pluginConfig.get(SANDBOX_GROUP)).policy);
    }
    pluginConfig.watch(SANDBOX_GROUP, (doc) =>
      sandbox.configure(sandboxStartOf(schema(), doc).policy),
    );
  }
}
