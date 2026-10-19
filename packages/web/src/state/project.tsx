/**
 * Current Project / Agent context:
 * - Project list (owned + authorized); the current selection is remembered in localStorage and
 *   synced to server-side prefs (lastProjectId, best-effort);
 * - the current Project's Agent list and current Agent (switched via the top-bar breadcrumb
 *   dropdown; remembered per Project).
 *
 * State lives in a zustand vanilla store (one instance per Provider mount, so an unmount
 * still resets everything); the Provider is a thin lifecycle component that triggers the
 * initial fetches and republishes the store's state through the same context value as before.
 *
 * The Agent list follows lib/project-scope.ts: it is held tagged with the Project it was listed
 * for, an answer is applied only while that Project is still current (a late list of the
 * Project just left is dropped), and the context publishes only the current Project's list.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { isCurrentProject, scoped, scopedValue, type Scoped } from "../lib/project-scope";
import { WORKBENCH_UPDATED_EVENT, type WorkbenchUpdatedDetail } from "../lib/workbench-tabs";

const PROJECT_KEY = "penguin.lastProjectId";
const agentKey = (projectId: string) => `penguin.lastAgentId.${projectId}`;

/**
 * Remembers a Project and Agent the way the store does, for a surface that sits outside the
 * ProjectProvider (the full-page workbench route) and wants the shell to open on them next.
 */
export function rememberSelection(projectId: string, agentId: string): void {
  localStorage.setItem(PROJECT_KEY, projectId);
  localStorage.setItem(agentKey(projectId), agentId);
}

interface ProjectContextValue {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProject: ProjectSummary | null;
  /** A removed selection whose local editor declined to leave; never an accessible Project. */
  unavailableProjectId: string | null;
  setCurrentProjectId: (projectId: string) => void;
  /**
   * `guard()` returns whether it's fine to proceed now, or a Promise that settles with the
   * answer once a guard that needs to ask first (through its own dialog) gets one — the
   * caller (`deleteProject`, `setCurrentProjectId`, the removed-selection reload) awaits it
   * and only then continues, so its own success/error handling always runs on the answer
   * that mattered, never on a detached retry nobody is listening to.
   */
  registerProjectChangeGuard: (guard: () => boolean | Promise<boolean>) => () => void;
  reloadProjects: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;

  agents: AgentSummary[];
  agentsLoading: boolean;
  currentAgent: AgentSummary | null;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Project display name fallback: falls back to projectId when name is absent. */
export function projectDisplayName(p: ProjectSummary): string {
  return p.name ?? p.projectId;
}

/** Agent display name fallback: falls back to agentId when name is absent. */
export function agentDisplayName(a: AgentSummary): string {
  return a.name ?? a.agentId;
}

/** Store state: the context value's raw ingredients (currentProject/agents/currentAgent are derived by projectView) plus the mutation functions. */
interface ProjectStoreState {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProjectId: string | null;
  unavailableProjectId: string | null;

  /** The last Agent list applied, tagged with the Project it was listed for; null before any. */
  agents: Scoped<AgentSummary[]> | null;
  agentsLoading: boolean;
  currentAgentId: string | null;

  setCurrentProjectId: (projectId: string) => void;
  registerProjectChangeGuard: (guard: () => boolean | Promise<boolean>) => () => void;
  reloadProjects: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

/**
 * What moving to another Project resets, in the same update that moves it: the current Agent
 * and the Agent list are the previous Project's, and nothing may read them as the new one's.
 */
function enteredProject(projectId: string | null): Partial<ProjectStoreState> {
  return {
    currentProjectId: projectId,
    unavailableProjectId: null,
    currentAgentId: null,
    agents: null,
    agentsLoading: projectId !== null,
  };
}

/**
 * Runs every registered project-change guard in order, in the shape
 * `registerProjectChangeGuard` expects: a guard that has nothing to ask returns a plain
 * boolean; one that needs to ask first (through its own dialog) returns a Promise that
 * settles once answered. Short-circuits on the first "no" — a guard after a declining one is
 * never even asked (only one editor guard is registered in practice, but this keeps the
 * aggregation honest if that ever changes).
 *
 * Stays synchronous end-to-end when every guard answers synchronously (returns a plain
 * boolean rather than a Promise): a caller like `setCurrentProjectId` that isn't itself
 * awaited needs its state change to land in the very same tick when nothing was dirty, not
 * one microtask later — `await`ing a non-Promise would still defer by a tick, so this only
 * switches to a Promise once a guard actually returns one.
 */
export function combineChangeGuards(
  guards: Iterable<() => boolean | Promise<boolean>>,
): boolean | Promise<boolean> {
  const run = (
    iterator: Iterator<() => boolean | Promise<boolean>>,
  ): boolean | Promise<boolean> => {
    const next = iterator.next();
    if (next.done) return true;
    const result = next.value();
    if (result instanceof Promise) return result.then((ok) => (ok ? run(iterator) : false));
    return result ? run(iterator) : false;
  };
  return run([...guards][Symbol.iterator]());
}

export function createProjectStore() {
  /** Agent-list asks so far: only the newest one's answer is applied (see reloadAgents). */
  let agentsAsked = 0;
  const changeGuards = new Set<() => boolean | Promise<boolean>>();
  const canLeave = () => combineChangeGuards(changeGuards);
  const rememberProject = (projectId: string) => {
    localStorage.setItem(PROJECT_KEY, projectId);
    // Sync server-side prefs (best-effort; failure doesn't affect the local experience).
    void api.putPrefs({ lastProjectId: projectId }).catch(() => undefined);
  };
  const store = createStore<ProjectStoreState>((set, get) => ({
    projects: [],
    projectsLoading: true,
    currentProjectId: null,
    unavailableProjectId: null,

    agents: null,
    agentsLoading: true,
    currentAgentId: null,

    registerProjectChangeGuard: (guard) => {
      changeGuards.add(guard);
      return () => {
        changeGuards.delete(guard);
      };
    },

    reloadProjects: () => loadProjects(),
    deleteProject: async (projectId) => {
      // Confirm before the irreversible request. A refresh after this same deletion must
      // not ask again after the Project is already gone. Awaiting canLeave() means this
      // same call (and the caller's own await) stays pending until a guard's dialog is
      // answered — success or failure from here on is handled exactly once, by whoever
      // called deleteProject, never by a detached retry nobody is listening to.
      const selected = get().currentProjectId ?? get().unavailableProjectId;
      if (projectId === selected && !(await canLeave())) return false;
      await api.deleteProject(projectId);
      await loadProjects(projectId);
      return true;
    },

    setCurrentProjectId: (projectId) => {
      // If the selection is already the current Project, return immediately. Otherwise the
      // code below would clear agents and set loading back to true while currentProjectId
      // stays unchanged — the Provider's reloadAgents effect depends on it and wouldn't rerun,
      // so the Agent list (and the Session list mounted under it) would disappear for good
      // (reproducible by clicking the already-current Project in the dropdown).
      if (projectId === get().currentProjectId) return;
      if (!get().projects.some((project) => project.projectId === projectId)) return;
      const commit = () => {
        rememberProject(projectId);
        // Clear the Agent list in sync: avoids a transient render with "new projectId + old
        // Project's agents" that would make downstream consumers (Sessions) fetch with the
        // wrong Agent set (which could create spurious Sessions under the new Project).
        set(enteredProject(projectId));
      };
      // Project selection is independent of the router. Consult editors before any
      // selection, agent, localStorage, or server preference mutation takes place. Stays
      // synchronous (no `await`) when every guard answers synchronously — a caller here never
      // awaits this function's return, so a switch that has nothing to ask must still land in
      // this same tick.
      const ok = canLeave();
      if (ok instanceof Promise) {
        void ok.then((allowed) => {
          if (!allowed) return;
          // The answer can take as long as the author needs: re-check both guards above,
          // since the world may have moved on (another switch already landed, or the target
          // Project disappeared) while it was pending.
          if (projectId === get().currentProjectId) return;
          if (!get().projects.some((project) => project.projectId === projectId)) return;
          commit();
        });
        return;
      }
      if (ok) commit();
    },

    reloadAgents: async () => {
      const projectId = get().currentProjectId;
      if (!projectId) return;
      const ask = ++agentsAsked;
      // The answer is applied only while it is the newest ask and its Project is still the
      // current one. A list of the Project just left that answers after the switch — slow
      // network, slow machine, a reload fired by the turn that just ended there — would
      // otherwise land as the new Project's Agents, and every page would then pair the new
      // Project with Agents it does not have.
      const applies = () =>
        ask === agentsAsked && isCurrentProject(projectId, get().currentProjectId);
      set({ agentsLoading: true });
      try {
        const res = await api.listAgents(projectId);
        if (!applies()) return;
        const wanted = get().currentAgentId ?? localStorage.getItem(agentKey(projectId));
        set({
          agents: scoped(projectId, res.agents),
          currentAgentId: agentOf(res.agents, wanted)?.agentId ?? null,
        });
      } finally {
        if (applies()) set({ agentsLoading: false });
      }
    },

    setCurrentAgentId: (agentId) => {
      const currentProjectId = get().currentProjectId;
      if (currentProjectId) localStorage.setItem(agentKey(currentProjectId), agentId);
      set({ currentAgentId: agentId });
    },
  }));

  async function loadProjects(approvedRemoval?: string): Promise<void> {
    store.setState({ projectsLoading: true });
    let projects: ProjectSummary[];
    try {
      ({ projects } = await api.listProjects());
    } finally {
      // Not wrapped around the guard await below: that can sit open for as long as the
      // author takes to answer a "discard unsaved changes?" dialog, and nothing about that
      // wait should keep the Project list showing a loading state.
      store.setState({ projectsLoading: false });
    }
    const state = store.getState();
    const previous = state.currentProjectId ?? state.unavailableProjectId;
    const wanted = previous ?? localStorage.getItem(PROJECT_KEY);
    const found = projects.find((project) => project.projectId === wanted);
    const next = (found ?? projects[0])?.projectId ?? null;
    if (previous && next !== previous && approvedRemoval !== previous && !(await canLeave())) {
      // Access is gone regardless of the answer. Keep only an ID so an editor can
      // retain its local text, while every other consumer sees no active Project.
      store.setState({ projects, ...enteredProject(null), unavailableProjectId: previous });
      return;
    }
    // The current Project gone from the list (deleted, access lost) moves the app to another
    // one: a switch like any other, so it resets what a switch resets, in the same update.
    store.setState({
      projects,
      ...(state.currentProjectId !== next ? enteredProject(next) : { unavailableProjectId: null }),
    });
    if (previous && next && next !== previous) rememberProject(next);
  }
  return store;
}

/**
 * The Agent an id names among THIS server's, else the one a conversation defaults to
 * (`default_agent`, then the first). The id may name an Agent only a machine has — a draft or
 * a Session on that machine follows its pick through to the current Agent — and the current
 * Agent is never one of those: the chat page renders nothing until there is a current Agent,
 * so resolving such an id to null left every chat route on its placeholder until a reload.
 */
export function agentOf(
  agents: readonly AgentSummary[],
  agentId: string | null,
): AgentSummary | null {
  return (
    agents.find((a) => a.agentId === agentId) ??
    agents.find((a) => a.agentId === "default_agent") ??
    agents[0] ??
    null
  );
}

/** Published while no Agent list of the current Project has been applied: one identity, so effects keyed on it stay put. */
const NO_AGENTS: AgentSummary[] = [];

/**
 * What the context publishes from the store: the current Project, its Agents and the current
 * Agent. The Agent list is handed out only when it was listed for the current Project — never
 * another Project's, whichever write left it there — and the current Agent is one of it.
 */
function projectView(
  state: Pick<ProjectStoreState, "projects" | "currentProjectId" | "agents" | "currentAgentId">,
): {
  currentProject: ProjectSummary | null;
  agents: AgentSummary[];
  currentAgent: AgentSummary | null;
} {
  const currentProject = state.projects.find((p) => p.projectId === state.currentProjectId) ?? null;
  const agents = scopedValue(state.agents, state.currentProjectId) ?? NO_AGENTS;
  return { currentProject, agents, currentAgent: agentOf(agents, state.currentAgentId) };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProjectStore);
  const state = useStore(store);

  useEffect(() => {
    void store.getState().reloadProjects();
  }, [store]);

  const { currentProjectId } = state;
  useEffect(() => {
    void store.getState().reloadAgents();
  }, [store, currentProjectId]);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (detail.projectId === store.getState().currentProjectId)
        void store.getState().reloadAgents();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, changed);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, changed);
  }, [store]);

  const value = useMemo<ProjectContextValue>(() => {
    const { currentProject, agents, currentAgent } = projectView(state);
    return {
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      currentProject,
      unavailableProjectId: state.unavailableProjectId,
      setCurrentProjectId: state.setCurrentProjectId,
      registerProjectChangeGuard: state.registerProjectChangeGuard,
      reloadProjects: state.reloadProjects,
      deleteProject: state.deleteProject,
      agents,
      agentsLoading: state.agentsLoading,
      currentAgent,
      setCurrentAgentId: state.setCurrentAgentId,
      reloadAgents: state.reloadAgents,
    };
  }, [state]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
