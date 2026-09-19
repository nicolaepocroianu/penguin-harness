import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { CodexConnections } from "../src/services/codex-connection.js";

describe("Codex account connections", () => {
  const services: CodexConnections[] = [];
  afterEach(() => {
    for (const service of services.splice(0)) service.dispose();
    vi.useRealTimers();
  });
  function setup() {
    let status: unknown = { account: { type: "unauthenticated" }, login: null };
    const controls: { call: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
    const factory = vi.fn(async () => {
      const control = { call: vi.fn(async () => status), close: vi.fn(async () => {}) };
      controls.push(control);
      return control;
    });
    const root = path.resolve("test-projects");
    const service = new CodexConnections(root, factory);
    services.push(service);
    return {
      service,
      factory,
      controls,
      root,
      setStatus: (value: unknown) => {
        status = value;
      },
    };
  }

  it("keeps one controller per project, releases it on logout and recreates it on retry", async () => {
    const { service, factory, controls, root } = setup();
    await service.status("one");
    await service.status("one");
    await service.status("two");
    expect(factory.mock.calls).toEqual([[path.join(root, "one")], [path.join(root, "two")]]);
    expect(await service.disconnect("one")).toEqual({ state: "disconnected" });
    await Promise.resolve();
    expect(controls[0]!.close).toHaveBeenCalledOnce();
    expect(controls[1]!.close).not.toHaveBeenCalled();
    await service.status("one");
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("returns only the device challenge and connection state, never account details", async () => {
    const { service, setStatus, controls } = setup();
    setStatus({
      account: { type: "unauthenticated" },
      login: {
        status: "pending",
        verificationUrl: "https://auth.openai.com/codex/device",
        message: "Enter ABCD",
        elicitationId: "internal",
      },
    });
    expect(await service.connect("one")).toEqual({
      state: "pending",
      verificationUrl: "https://auth.openai.com/codex/device",
      message: "Enter ABCD",
    });
    expect(controls[0]!.call.mock.calls).toEqual([["codex_connect"], ["codex_status"]]);
    setStatus({
      account: { type: "chat-gpt", email: "private@example.com", token: "secret" },
      limits: { private: true },
    });
    expect(await service.status("one")).toEqual({ state: "connected" });
  });

  it.each([
    "https://evil.example/device",
    "http://auth.openai.com/device",
    "https://user@auth.openai.com/device",
  ])("does not publish untrusted login links: %s", async (verificationUrl) => {
    const { service, setStatus } = setup();
    setStatus({ login: { status: "pending", verificationUrl, message: "challenge" } });
    expect(await service.status("one")).toEqual({ state: "pending" });
  });

  it("releases a failed controller so the next request can recover", async () => {
    const { service, controls, factory } = setup();
    await service.status("one");
    controls[0]!.call.mockRejectedValueOnce(new Error("adapter stopped"));
    await expect(service.status("one")).rejects.toThrow("adapter stopped");
    await service.status("one");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(controls[0]!.close).toHaveBeenCalledOnce();
  });

  it("expires idle controllers and closes all remaining controllers on shutdown", async () => {
    vi.useFakeTimers();
    const { service, controls } = setup();
    await service.status("one");
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(controls[0]!.close).toHaveBeenCalledOnce();
    await service.status("two");
    service.dispose();
    await Promise.resolve();
    expect(controls[1]!.close).toHaveBeenCalledOnce();
  });
});
