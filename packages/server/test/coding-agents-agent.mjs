/**
 * A real ACP agent subprocess for the coding-agents API tests: v1 over stdio, one fixed
 * text chunk per prompt, then end_turn, plus a Model config option that can be set.
 * Run with node.
 */
import { Readable, Writable } from "node:stream";
import { agent, methods, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

/** @type {import("@agentclientprotocol/sdk").AgentConnection | undefined} */
let connection;

const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "balanced",
    options: [
      { value: "balanced", name: "Balanced" },
      { value: "fast", name: "Fast" },
    ],
  },
  {
    id: "plan",
    name: "Planning",
    type: "boolean",
    currentValue: false,
  },
];

const app = agent({ name: "fake-agent-test" })
  .onConnect((conn) => {
    connection = conn;
  })
  .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
  .onRequest(methods.agent.session.new, () => ({
    sessionId: `sess-${Date.now()}`,
    configOptions,
  }))
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    const text = ctx.params.prompt
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    // A marker prompt exercises the tool-call projection: one call, then its completion.
    if (text === "run a tool") {
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read package.json",
          kind: "read",
          status: "pending",
        },
      });
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
        },
      });
    }
    await connection.client.notify(methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from subprocess" },
      },
    });
    return { stopReason: "end_turn" };
  })
  .onRequest(methods.agent.session.setConfigOption, (ctx) => {
    for (const option of configOptions) {
      if (option.id === ctx.params.configId) option.currentValue = ctx.params.value;
    }
    return { configOptions };
  })
  .onRequest(methods.agent.session.close, () => ({}));

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
