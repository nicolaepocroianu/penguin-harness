/**
 * Coding agents as model rows: what a model picker offers next to a Project's own models.
 * One row per agent that can start a session (a saved definition, or a detected agent with a
 * runnable launch), plus one per model the agent advertised when it was last probed. Rows are
 * listed apart from the Project's models (`ModelsResponse.codingAgentModels`) so they are
 * never saved into the Project's model table, synced to a machine, or made the default.
 */
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
  ModelInfo,
} from "../api/types.js";
import { CODING_AGENT_PROVIDER, codingAgentModelId } from "./session-runtime.js";

/** The option an agent renders as its Model: the `model` category, else the first select. */
export function modelOptionOf(
  options: CodingAgentConfigOption[] | undefined,
): CodingAgentConfigOption | undefined {
  return (
    options?.find((o) => o.category === "model" && o.type === "select") ??
    options?.find((o) => o.type === "select")
  );
}

export function codingAgentModelRows(
  saved: CodingAgentServerInfo[],
  discovery: CodingAgentDiscoveryResponse,
): ModelInfo[] {
  const agents = new Map<string, { title: string; options?: CodingAgentConfigOption[] }>();
  for (const agent of saved) {
    const options =
      discovery.agentModels[agent.id] ??
      discovery.candidates.find((c) => c.recipeId === agent.id)?.models;
    agents.set(agent.id, { title: agent.title ?? agent.id, ...(options ? { options } : {}) });
  }
  for (const candidate of discovery.candidates) {
    if (agents.has(candidate.recipeId) || !candidate.detected || !candidate.launch) continue;
    agents.set(candidate.recipeId, {
      title: candidate.title,
      ...(candidate.models ? { options: candidate.models } : {}),
    });
  }
  return [...agents]
    .sort(([, a], [, b]) => a.title.localeCompare(b.title))
    .flatMap(([id, agent]) => {
      const option = modelOptionOf(agent.options);
      return [
        {
          provider: CODING_AGENT_PROVIDER,
          modelId: id,
          displayName: agent.title,
          isDefault: false,
        },
        ...(option?.options ?? []).map((value) => ({
          provider: CODING_AGENT_PROVIDER,
          modelId: codingAgentModelId(id, option!.id, value.value),
          displayName: `${agent.title} · ${value.name}`,
          isDefault: false,
        })),
      ];
    });
}
