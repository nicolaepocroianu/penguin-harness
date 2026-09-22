/**
 * Models → Local CLI: the coding agents installed on the server machine, as model sources
 * next to the API providers. One card per agent — logo, name and who makes it, version and
 * sign-in state, the model it will use — and the selected card opens to its Model and
 * Reasoning effort, remembered for the agent and applied to its new Sessions. Agents that are
 * not installed wait in a folded list with a link to install them. Starting one is starting a
 * chat with it picked in the model dropdown; its Sessions are ordinary Sessions.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
} from "@prismshadow/penguin-server/api";
import {
  discoverCodingAgents,
  listCodingAgents,
  refreshCodingAgents,
  removeCodingAgent,
  setCodingAgentModel,
  setCodingAgentOption,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { Select } from "../../components/ui/select";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { AddAgentModal } from "../coding-agents/coding-agents-page";
import {
  buildAgentCards,
  currentModel,
  effortOptionOf,
  modelOptionOf,
  type AgentCardModel,
} from "../coding-agents/agent-cards";
import { CODING_AGENT_PROVIDER, codingAgentLogo } from "../chat/coding-agent-models";

export function LocalCliPanel() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const navigate = useNavigate();
  const [saved, setSaved] = useState<CodingAgentServerInfo[] | null>(null);
  const [discovery, setDiscovery] = useState<CodingAgentDiscoveryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<AgentCardModel | null>(null);

  const load = useCallback(() => {
    void Promise.all([listCodingAgents(), discoverCodingAgents()])
      .then(([agents, found]) => {
        setSaved(agents.agents);
        setDiscovery(found);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const rescan = () => {
    setScanning(true);
    refreshCodingAgents()
      .then((found) => {
        setDiscovery(found);
        return listCodingAgents().then((agents) => setSaved(agents.agents));
      })
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setScanning(false));
  };

  const { installed, available } = buildAgentCards(
    saved ?? [],
    discovery,
    S.codingAgents.setupRequired,
  );
  const loading = saved === null && !failed;

  return (
    <section aria-label={S.models.viewLocalCli}>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{S.models.localCliIntro}</p>
      {failed && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
          {S.models.cliScanFailed}
        </div>
      )}
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {S.models.installedClis(installed.length)}
        </h2>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              {S.models.cliAddAgent}
            </Button>
            <Button size="sm" onClick={rescan} disabled={scanning}>
              {scanning ? S.models.cliScanning : S.models.cliRescan}
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : installed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {S.models.cliNone}
        </p>
      ) : (
        <ul className="space-y-2">
          {installed.map((card) => (
            <CliCard
              key={card.key}
              card={card}
              selected={selected === card.agentId}
              isAdmin={isAdmin}
              onSelect={() => setSelected(selected === card.agentId ? null : card.agentId)}
              onChanged={load}
              onStartChat={() =>
                navigate("/chat/new", {
                  state: { modelRef: { provider: CODING_AGENT_PROVIDER, modelId: card.agentId } },
                })
              }
              onRemove={() => setRemoving(card)}
            />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800">
          <button
            type="button"
            aria-expanded={availableOpen}
            onClick={() => setAvailableOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            <Chevron open={availableOpen} />
            {S.models.availableClis(available.length)}
          </button>
          {availableOpen && (
            <ul className="grid gap-2 border-t border-gray-200 p-3 sm:grid-cols-2 dark:border-gray-800">
              {available.map((card) => (
                <li
                  key={card.key}
                  className="flex min-w-0 items-center gap-3 rounded-md bg-gray-50 px-3 py-2.5 dark:bg-gray-900"
                >
                  <ProviderLogo
                    provider={codingAgentLogo(card.agentId, card.title)}
                    className="h-6 w-6 shrink-0 opacity-60"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-900 dark:text-gray-100">
                      {card.title}
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {card.setupHint ?? S.codingAgents.setupRequired}
                    </div>
                  </div>
                  {card.homepageUrl && (
                    <a
                      href={card.homepageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline"
                    >
                      {S.models.cliInstall}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />
      <ConfirmModal
        open={removing !== null}
        title={S.codingAgents.removeConfirmTitle}
        confirmLabel={S.models.cliRemove}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) {
            void removeCodingAgent(removing.agentId)
              .then(load)
              .catch((e: unknown) => toastError(apiErrorText(e)));
          }
          setRemoving(null);
        }}
      >
        {removing !== null ? S.codingAgents.removeConfirmBody(removing.title) : ""}
      </ConfirmModal>
    </section>
  );
}

/**
 * One installed agent. Collapsed it reads like a model row — logo, name · maker, version and
 * sign-in state, the model it will use; selected it opens to the settings its Sessions start
 * with, plus the way to start one.
 */
function CliCard({
  card,
  selected,
  isAdmin,
  onSelect,
  onChanged,
  onStartChat,
  onRemove,
}: {
  card: AgentCardModel;
  selected: boolean;
  isAdmin: boolean;
  onSelect: () => void;
  onChanged: () => void;
  onStartChat: () => void;
  onRemove: () => void;
}) {
  const model = currentModel(card);
  const modelOption = modelOptionOf(card.options);
  const effortOption = effortOptionOf(card.options);
  const remember = (option: CodingAgentConfigOption, value: string, isModel: boolean) => {
    const name = option.options.find((o) => o.value === value)?.name;
    const request = isModel
      ? setCodingAgentModel(card.agentId, {
          configId: option.id,
          value,
          ...(name !== undefined ? { name } : {}),
        })
      : setCodingAgentOption(card.agentId, { configId: option.id, value });
    void request.then(onChanged).catch((e: unknown) => toastError(apiErrorText(e)));
  };
  const effortValue = String(
    (effortOption && card.rememberedOptions?.[effortOption.id]) ?? effortOption?.currentValue ?? "",
  );
  return (
    <li
      className={`rounded-lg border bg-white transition-colors duration-150 dark:bg-gray-900 ${
        selected
          ? "border-gray-400 shadow-sm dark:border-gray-600"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left"
      >
        <ProviderLogo
          provider={codingAgentLogo(card.agentId, card.title)}
          className="h-8 w-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
            <span className="truncate font-medium text-gray-900 dark:text-gray-100">
              {card.title}
            </span>
            {card.vendor && (
              <span className="truncate text-gray-500 dark:text-gray-400">· {card.vendor}</span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {card.version && <span className="truncate font-mono">{card.version}</span>}
            {card.authStatus === "ok" && (
              <span className={toneInk.success}>{S.models.cliSignedIn}</span>
            )}
            {card.authStatus === "missing" && (
              <span className={toneInk.attention}>{S.models.cliSignInRequired}</span>
            )}
          </div>
          {!selected && (
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              {S.models.cliModelSummary(model?.name ?? S.models.cliDefault)}
            </div>
          )}
        </div>
      </button>

      {selected && (
        <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3 dark:border-gray-800">
          {card.commandLine !== "" && (
            <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
              {card.commandLine}
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {S.models.cliModel}
              </span>
              {modelOption && <Badge tone="green">{S.models.cliSynced}</Badge>}
            </div>
            {modelOption && modelOption.options.length > 0 ? (
              <Select
                size="sm"
                aria-label={`${card.title} ${S.models.cliModel}`}
                value={model?.value ?? ""}
                disabled={!isAdmin}
                onChange={(e) => remember(modelOption, e.target.value, true)}
              >
                {modelOption.options.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {model?.name ?? S.models.cliModelsUnknown}
              </p>
            )}
          </div>
          {effortOption && effortOption.options.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {S.models.cliEffort}
              </span>
              <Select
                size="sm"
                aria-label={`${card.title} ${S.models.cliEffort}`}
                value={effortValue}
                disabled={!isAdmin}
                onChange={(e) => remember(effortOption, e.target.value, false)}
              >
                {effortOption.options.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {card.setupHint && <p className={`text-xs ${toneInk.attention}`}>{card.setupHint}</p>}
          <div className="flex flex-wrap gap-2">
            {card.startable && (
              <Button size="sm" variant="primary" onClick={onStartChat}>
                {S.models.cliStartChat}
              </Button>
            )}
            {card.saved && isAdmin && (
              <Button size="sm" variant="danger" onClick={onRemove}>
                {S.models.cliRemove}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
