/**
 * A real ACP agent subprocess standing in for an external coding agent running an activity
 * stage: each prompt writes `activity-spec.json` into the session's working directory from
 * FAKE_STAGE_SPEC and ends the turn. FAKE_STAGE_STOP makes it end with that stop reason
 * instead, writing nothing; FAKE_STAGE_WAIT=cancel holds the turn until it is cancelled.
 * Run with node.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { agent, methods, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

const cwds = new Map();
const cancelled = new Set();
let seq = 0;

const app = agent({ name: "fake-stage-agent" })
  .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
  .onRequest(methods.agent.session.new, (ctx) => {
    const sessionId = `stage-${process.pid}-${++seq}`;
    cwds.set(sessionId, ctx.params.cwd);
    return { sessionId };
  })
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    const sessionId = ctx.params.sessionId;
    if (process.env.FAKE_STAGE_WAIT === "cancel") {
      while (!cancelled.has(sessionId)) await new Promise((r) => setTimeout(r, 10));
      return { stopReason: "cancelled" };
    }
    if (process.env.FAKE_STAGE_STOP) return { stopReason: process.env.FAKE_STAGE_STOP };
    await fs.writeFile(
      path.join(cwds.get(sessionId), "activity-spec.json"),
      process.env.FAKE_STAGE_SPEC ?? "{}",
    );
    return { stopReason: "end_turn" };
  })
  .onRequest(methods.agent.session.close, () => ({}))
  .onNotification(methods.agent.session.cancel, (ctx) => {
    cancelled.add(ctx.params.sessionId);
  });

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
