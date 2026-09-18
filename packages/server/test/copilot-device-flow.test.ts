import { describe, expect, it, vi } from "vitest";
import { CopilotDeviceFlow } from "../src/services/copilot-device-flow.js";

const owner = { projectId: "p1", userId: "u1" };
const device = {
  device_code: "secret-device",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};
const token = { access_token: "gho_test-secret", token_type: "bearer" };
function setup() {
  let clock = 0;
  const apply = vi.fn(async () => 2);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(device));
  const service = new CopilotDeviceFlow(
    apply,
    fetcher,
    () => clock,
    () => "penguin-app",
  );
  return {
    service,
    fetcher,
    apply,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("Copilot device authorization", () => {
  it("accepts case-insensitive bearer token types", async () => {
    const { service, fetcher, advance, apply } = setup();
    const { flowId } = await service.start(owner);
    advance(5000);
    fetcher.mockResolvedValue(Response.json({ ...token, token_type: "Bearer" }));
    expect(await service.poll({ ...owner, flowId })).toMatchObject({ status: "done", applied: 2 });
    expect(apply).toHaveBeenCalledOnce();
  });
  it("requires an explicitly configured app and never borrows another client's identity", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const flow = new CopilotDeviceFlow(
      async () => 0,
      fetcher,
      Date.now,
      () => undefined,
    );
    await expect(flow.start(owner)).rejects.toThrow("PENGUIN_COPILOT_CLIENT_ID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps secrets server-side and applies a token exactly once", async () => {
    const { service, fetcher, apply, advance } = setup();
    const started = await service.start(owner);
    expect(JSON.stringify(started)).not.toContain("secret-device");
    const input = { ...owner, flowId: started.flowId };
    expect((await service.poll(input)).status).toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(5000);
    fetcher.mockResolvedValue(Response.json(token));
    expect(await service.poll(input)).toEqual({
      status: "done",
      provider: "github-copilot",
      applied: 2,
    });
    await service.poll(input);
    expect(apply).toHaveBeenCalledExactlyOnceWith(
      "p1",
      token.access_token,
      expect.any(AbortSignal),
    );
    const options = fetcher.mock.calls[1]![1]!;
    expect(JSON.parse(String(options.body))).toMatchObject({
      client_id: "penguin-app",
      device_code: "secret-device",
    });
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("enforces ownership, expiry and cancellation", async () => {
    const { service, advance, apply } = setup();
    const { flowId } = await service.start(owner);
    await expect(service.poll({ ...owner, userId: "u2", flowId })).rejects.toMatchObject({
      status: 404,
    });
    expect(() => service.cancel({ ...owner, projectId: "p2", flowId })).toThrow();
    service.cancel({ ...owner, flowId });
    await expect(service.poll({ ...owner, flowId })).rejects.toThrow();
    const next = await service.start(owner);
    advance(900_000);
    await expect(service.poll({ ...owner, flowId: next.flowId })).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });

  it("throttles polls, including slow_down and overlapping calls", async () => {
    const { service, fetcher, advance, apply } = setup();
    const { flowId } = await service.start(owner);
    const input = { ...owner, flowId };
    advance(5000);
    fetcher.mockResolvedValue(Response.json({ error: "slow_down" }));
    await service.poll(input);
    advance(5000);
    await service.poll(input);
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(5000);
    let resolve!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = service.poll(input);
    await service.poll(input);
    expect(fetcher).toHaveBeenCalledTimes(3);
    resolve(Response.json(token));
    await first;
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not persist a token received after cancellation", async () => {
    const { service, fetcher, advance, apply } = setup();
    const { flowId } = await service.start(owner);
    const input = { ...owner, flowId };
    advance(5000);
    let resolve!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = service.poll(input);
    service.cancel(input);
    resolve(Response.json(token));
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: "access_denied" }, "access_denied"],
    [{ error: "expired_token" }, "code_rejected"],
    [{ error: "incorrect_device_code" }, "code_rejected"],
    [{ error: "incorrect_client_credentials" }, "invalid_request"],
    [{ error: "device_flow_disabled" }, "invalid_request"],
    [{ error: "unsupported_grant_type" }, "invalid_request"],
    [{ error: "unrecognized", error_description: "secret" }, "upstream_failed"],
    [{ ...token, expires_in: 3600 }, "expiring_token"],
    [{ ...token, refresh_token: "secret" }, "expiring_token"],
    [{ ...token, refresh_token_expires_in: 3600 }, "expiring_token"],
    [{ ...token, access_token: "ghu_secret" }, "unsupported_token"],
    [{ ...token, token_type: "unknown" }, "unsupported_token"],
    [{}, "unsupported_token"],
  ])(
    "classifies rejected responses without leaking credentials: %j -> %s",
    async (reply, error) => {
      const { service, fetcher, advance, apply } = setup();
      const { flowId } = await service.start(owner);
      advance(5000);
      fetcher.mockResolvedValue(Response.json(reply));
      expect(await service.poll({ ...owner, flowId })).toEqual({
        status: "error",
        provider: "github-copilot",
        error,
      });
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it("reports model discovery or credential write failure without disclosing tokens", async () => {
    const { service, fetcher, advance, apply } = setup();
    const { flowId } = await service.start(owner);
    advance(5000);
    fetcher.mockResolvedValue(Response.json(token));
    apply.mockRejectedValue(new Error("upstream body with gho_test-secret"));
    expect(await service.poll({ ...owner, flowId })).toEqual({
      status: "error",
      provider: "github-copilot",
      error: "apply_failed",
    });
  });
});
