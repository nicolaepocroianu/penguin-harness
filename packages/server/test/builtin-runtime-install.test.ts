import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RuntimeInstallError,
  cleanRuntimes,
  installRuntime,
  installedRuntime,
} from "../src/coding-agents/builtin/runtime-install.js";
import { fakeRegistry, type FakeRegistry } from "./fixtures/builtin-registry.js";

const NAME = "@github/copilot-test-x64";

describe("runtime install", () => {
  let dir: string;
  let registry: FakeRegistry | null = null;
  beforeEach(async () => {
    dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "runtimes-")), "copilot");
  });
  afterEach(async () => {
    await registry?.close();
    registry = null;
    await fs.rm(path.dirname(dir), { recursive: true, force: true });
  });

  it("downloads, verifies, unpacks into <version>/ and runs --version", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "9.9.9" });
    const progress: number[] = [];
    const installed = await installRuntime({
      registry: registry.url,
      packageName: NAME,
      version: "9.9.9",
      runtimesDir: dir,
      onProgress: (received) => progress.push(received),
    });
    expect(installed.dir).toBe(path.join(dir, "9.9.9"));
    expect(installed.reportedVersion).toBe("1.0.0-test");
    expect(progress.at(-1)).toBeGreaterThan(0);
    expect(registry.requests[0]).toBe(`/${NAME}/9.9.9`);
    expect(await installedRuntime(dir, "9.9.9")).toMatchObject({ program: installed.program });
    expect((await fs.readdir(dir)).filter((n) => n.startsWith(".incoming-"))).toEqual([]);
  });

  it("discards a download whose checksum does not match, keeping the installed version", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "1.0.0" });
    await installRuntime({
      registry: registry.url,
      packageName: NAME,
      version: "1.0.0",
      runtimesDir: dir,
    });
    await registry.close();
    registry = await fakeRegistry({ packageName: NAME, version: "2.0.0", corrupt: true });
    await expect(
      installRuntime({
        registry: registry.url,
        packageName: NAME,
        version: "2.0.0",
        runtimesDir: dir,
      }),
    ).rejects.toMatchObject({ kind: "integrity" });
    expect(await installedRuntime(dir, "1.0.0")).not.toBeNull();
    expect(await installedRuntime(dir, "2.0.0")).toBeNull();
    expect((await fs.readdir(dir)).filter((n) => n.startsWith(".incoming-"))).toEqual([]);
  });

  it("reports a cut-off download as a network failure and leaves nothing behind", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "1.0.0", truncate: true });
    await expect(
      installRuntime({
        registry: registry.url,
        packageName: NAME,
        version: "1.0.0",
        runtimesDir: dir,
      }),
    ).rejects.toBeInstanceOf(RuntimeInstallError);
    expect(await installedRuntime(dir, "1.0.0")).toBeNull();
  });

  it("stops on cancel", async () => {
    let release!: () => void;
    registry = await fakeRegistry({
      packageName: NAME,
      version: "1.0.0",
      hold: new Promise<void>((r) => (release = r)),
    });
    const controller = new AbortController();
    const pending = installRuntime({
      registry: registry.url,
      packageName: NAME,
      version: "1.0.0",
      runtimesDir: dir,
      signal: controller.signal,
    });
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(await installedRuntime(dir, "1.0.0")).toBeNull();
  });

  it("cleans leftover incoming folders and other versions", async () => {
    await fs.mkdir(path.join(dir, ".incoming-abc"), { recursive: true });
    await fs.mkdir(path.join(dir, "0.1.0"), { recursive: true });
    await fs.mkdir(path.join(dir, "0.2.0"), { recursive: true });
    await cleanRuntimes(dir, "0.2.0");
    expect((await fs.readdir(dir)).sort()).toEqual(["0.2.0"]);
    await cleanRuntimes(path.join(dir, "missing"), null); // no throw on a missing folder
  });
});
