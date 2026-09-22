/**
 * External coding agents (Claude Code, Codex, OpenCode, Copilot, Cline, ...) offered in the
 * new-chat model dropdown next to ordinary models, so starting one is picking it, not filling
 * in a form. Each agent is a row under its own provider id, plus one row per model it
 * advertised when the server last probed it; the pick is encoded in the row's `modelId` and
 * read back by `parseCodingAgentRef` when the draft is sent.
 */
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
  ModelInfo,
  ModelRefDto,
} from "@prismshadow/penguin-server/api";

export const CODING_AGENT_PROVIDER = "coding-agent";

/** Separates agent id, config option id and value inside a row's `modelId`. */
const SEP = "::";

/** The option an agent's card renders as its Model: the `model` category, else the first select. */
function modelOptionOf(options: CodingAgentConfigOption[] | undefined) {
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
    agents.set(agent.id, {
      title: agent.title ?? agent.id,
      ...(discovery.agentModels[agent.id] ? { options: discovery.agentModels[agent.id] } : {}),
    });
  }
  // A detected agent with a runnable launch starts a session without being saved first.
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
          modelId: [id, option!.id, value.value].join(SEP),
          displayName: `${agent.title} · ${value.name}`,
          isDefault: false,
        })),
      ];
    });
}

/** The coding agent a dropdown pick names, with its model choice; null for an ordinary model. */
export function parseCodingAgentRef(
  ref: ModelRefDto | null,
): { agentId: string; model: { configId: string; value: string } | null } | null {
  if (ref?.provider !== CODING_AGENT_PROVIDER) return null;
  const [agentId = "", configId, ...value] = ref.modelId.split(SEP);
  if (configId === undefined || value.length === 0) return { agentId, model: null };
  return { agentId, model: { configId, value: value.join(SEP) } };
}

export function isCodingAgentRow(row: { provider: string }): boolean {
  return row.provider === CODING_AGENT_PROVIDER;
}
