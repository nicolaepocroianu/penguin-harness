/**
 * The builtin prefix's third-party packages are what pnpm-lock.yaml resolves
 * (scripts/lib/locked-prefix.mjs): the closure build-plugins pins with npm `overrides` comes
 * from the lockfile, and npm's installed tree is checked against it by version and by integrity.
 */
import { describe, expect, it } from "vitest";
import { integrityMismatches, lockedClosure } from "../../../scripts/lib/locked-prefix.mjs";

const lock = {
  importers: {
    "plugins/sandbox-dsh": {
      dependencies: { koffi: { version: "3.1.6" }, "left-pad": { version: "1.0.0" } },
    },
  },
  packages: {
    "koffi@3.1.6": { resolution: { integrity: "sha512-koffi" } },
    "@koromix/koffi-linux-x64@3.1.6": {
      os: ["linux"],
      cpu: ["x64"],
      resolution: { integrity: "sha512-linux" },
    },
    "@koromix/koffi-freebsd-x64@3.1.6": { os: ["freebsd"], cpu: ["x64"] },
  },
  snapshots: {
    "koffi@3.1.6": {
      optionalDependencies: {
        "@koromix/koffi-linux-x64": "3.1.6",
        "@koromix/koffi-freebsd-x64": "3.1.6",
      },
    },
  },
};
const closure = new Map([
  ["@koromix/koffi-linux-x64", "3.1.6"],
  ["koffi", "3.1.6"],
]);

describe("lockedClosure", () => {
  it("follows the native dependencies' snapshots, keeping only the target platforms' packages", () => {
    const natives = new Set(["koffi"]);
    const targets = [{ os: "linux", cpu: "x64" }];
    expect(lockedClosure(lock, ["plugins/sandbox-dsh"], natives, targets)).toEqual(closure);
  });

  it("follows npm aliases to their real package, and keeps a host-only package's build for the host", () => {
    const aliased = {
      importers: {
        "plugins/use-codex": {
          dependencies: { "@agentclientprotocol/codex-acp": { version: "1.12.0" } },
        },
      },
      packages: {
        "@agentclientprotocol/codex-acp@1.12.0": {},
        "@openai/codex@0.154.0": {},
        "@openai/codex@0.154.0-linux-x64": { os: ["linux"], cpu: ["x64"] },
        "@openai/codex@0.154.0-win32-x64": { os: ["win32"], cpu: ["x64"] },
      },
      snapshots: {
        "@agentclientprotocol/codex-acp@1.12.0": { dependencies: { "@openai/codex": "0.154.0" } },
        "@openai/codex@0.154.0": {
          optionalDependencies: {
            "@openai/codex-linux-x64": "@openai/codex@0.154.0-linux-x64",
            "@openai/codex-win32-x64": "@openai/codex@0.154.0-win32-x64",
          },
        },
      },
    };
    const natives = new Set(["@agentclientprotocol/codex-acp"]);
    const targets = [
      { os: "linux", cpu: "x64" },
      { os: "win32", cpu: "x64" },
    ];
    const importers = ["plugins/use-codex"];
    expect(lockedClosure(aliased, importers, natives, targets)).toEqual(
      new Map([
        ["@agentclientprotocol/codex-acp", "1.12.0"],
        ["@openai/codex", "0.154.0"],
        ["@openai/codex-linux-x64", "npm:@openai/codex@0.154.0-linux-x64"],
        ["@openai/codex-win32-x64", "npm:@openai/codex@0.154.0-win32-x64"],
      ]),
    );
    const host = { os: "win32", cpu: "x64" };
    const hostOnly = new Set(["@openai/codex"]);
    expect(lockedClosure(aliased, importers, natives, targets, hostOnly, host)).toEqual(
      new Map([
        ["@agentclientprotocol/codex-acp", "1.12.0"],
        ["@openai/codex", "0.154.0"],
        ["@openai/codex-win32-x64", "npm:@openai/codex@0.154.0-win32-x64"],
      ]),
    );
  });
});

describe("integrityMismatches", () => {
  const npmLock = (linuxIntegrity: string | undefined) => ({
    packages: {
      "": { name: "penguin-builtin-plugins" },
      "node_modules/@penguinharness/sandbox-dsh": { version: "0.2.3" },
      "node_modules/koffi": { version: "3.1.6", integrity: "sha512-koffi" },
      "node_modules/@koromix/koffi-linux-x64": { version: "3.1.6", integrity: linuxIntegrity },
    },
  });
  const builtins = new Set(["@penguinharness/sandbox-dsh"]);

  it.each([
    ["sha512-linux", []],
    [
      "sha512-other",
      ["@koromix/koffi-linux-x64@3.1.6: npm installed sha512-other, locked sha512-linux"],
    ],
    [
      undefined,
      ["@koromix/koffi-linux-x64@3.1.6: npm installed (no integrity), locked sha512-linux"],
    ],
  ])("npm's integrity %s against the lockfile's: %j", (integrity, mismatches) => {
    expect(integrityMismatches(lock, closure, npmLock(integrity), builtins)).toEqual(mismatches);
  });

  it("checks an aliased package by the real package npm records beside its install name", () => {
    const aliasLock = {
      packages: {
        "@openai/codex@0.154.0-linux-x64": { resolution: { integrity: "sha512-codex" } },
      },
    };
    const aliasClosure = new Map([
      ["@openai/codex-linux-x64", "npm:@openai/codex@0.154.0-linux-x64"],
    ]);
    const entry = (integrity: string) => ({
      packages: {
        "node_modules/@openai/codex-linux-x64": {
          name: "@openai/codex",
          version: "0.154.0-linux-x64",
          integrity,
        },
      },
    });
    expect(integrityMismatches(aliasLock, aliasClosure, entry("sha512-codex"))).toEqual([]);
    expect(integrityMismatches(aliasLock, aliasClosure, entry("sha512-other"))).toEqual([
      "@openai/codex-linux-x64@npm:@openai/codex@0.154.0-linux-x64: npm installed sha512-other, locked sha512-codex",
    ]);
  });

  it("names a drifted version and a locked package npm did not install", () => {
    const tree = {
      packages: { "node_modules/koffi": { version: "3.1.7", integrity: "sha512-x" } },
    };
    expect(integrityMismatches(lock, closure, tree)).toEqual([
      "koffi@3.1.7: not in the locked closure",
      "@koromix/koffi-linux-x64@3.1.6: not in npm's lockfile",
    ]);
  });
});
