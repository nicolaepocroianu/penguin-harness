# @waterford/waf-harness-core

The WAF Harness SDK and execution engine: the ReAct loop (`context_engine`), the OmniMessage protocol, the LLM / Environment interface contracts, Agent State and append-only Traces.

The engine speaks only OmniMessage and delegates everything else through two swappable interfaces — `LLMInterface` (models, via the [`@prismshadow/mmsp`](https://www.npmjs.com/package/@prismshadow/mmsp) gateway) and `EnvironmentInterface` (tool execution). The SDK caller is the Human boundary: one entry point, `session.run`, streams the whole loop.

```ts
import { createAgent, isCompleteModelMessage, userText } from "@waterford/waf-harness-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow", // per-tool-call approval
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

A single `run` drives a complete Task: streaming output, per-call approvals, concurrent tool execution, interrupt carry-over, automatic reconnect and context compaction. State lives under `~/.waf-harness/data` (`WAFH_HOME`); every Session restores fully from its Trace.

## Documentation

- [Architecture](https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/architecture.en.md)
- [The OmniMessage Protocol](https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/omni-message.en.md)
- [Core Interfaces](https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/interfaces.en.md)
- [The Agent Loop](https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/agent-loop.en.md)
- [Sessions & Traces](https://github.com/nicolaepocroianu/waf-harness/blob/main/packages/docs/content/sessions-and-traces.en.md)

## Development

```bash
pnpm --filter @waterford/waf-harness-core build       # tsup → dist/ (exports point at dist)
pnpm --filter @waterford/waf-harness-core typecheck
pnpm --filter @waterford/waf-harness-core test
pnpm test:e2e                                       # live-model e2e (needs DEEPSEEK_API_KEY)
```

Part of [WAF Harness](https://github.com/nicolaepocroianu/waf-harness) · Apache-2.0
