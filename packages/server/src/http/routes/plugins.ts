/**
 * Plugins: the library this build ships, the registry a deployment lists, and what an
 * Agent has installed.
 *   GET    /api/plugins                                   # the built-in library by category (any logged-in user)
 *   GET    /api/plugins/:plugin/files                     # the files a library plugin ships, for the detail view's browser
 *   GET    /api/plugins/registry                          # the merged plugin index: the builtin entries and the published ones
 *   GET    /api/plugins/registry/readme?name=…            # one indexed entry's long-form readme
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills and hook packages keep their own routes
 * (skills.ts, hooks.ts).
 *
 * Library and registry are two views of one kind of thing — a package of skills and/or
 * hooks. The library is what this build carries; the registry is what the deployment can
 * fetch. Both are deployment-global (no Project check); only installing touches an Agent.
 */
import { Hono } from "hono";
import {
  installPlugin,
  listInstalledHooks,
  listInstalledSkills,
  libraryPlugin,
  loadPluginGroups,
  projectDir,
} from "@prismshadow/penguin-core";
import type {
  AgentPluginsInstallResponse,
  PluginFilesResponse,
  PluginIndexResponse,
  PluginLibraryResponse,
  PluginReadmeResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { Config, Hmr } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { CodexConnections, codexServerPath } from "../../services/codex-connection.js";
import { agentHooksRoutes } from "./hooks.js";
import { builtinPluginRegistry } from "../../plugin/registry.js";
import { pluginBases } from "../../plugin/loader.js";
import type { PluginBase } from "../../plugin/loader.js";

/** What these route groups reach — bound by their component below. */
export interface PluginsRouteDeps {
  config: ServerConfig;
  access: Access;
  agentConfigService: AgentConfig;
  manager: ManagerIface;
}
import { HttpError } from "../errors.js";
import { badRequest, optionalStringArray, readJson, requireValidId } from "../validate.js";
import {
  pluginFiles,
  resolveLibraryPlugins,
  toHookItem,
  toPluginItem,
  toSkillItem,
} from "../../services/plugin-library.js";

/** Library listing: the files are the source of truth — read fresh on every request (small files, infrequent requests, no caching). */
function libraryResponse(): PluginLibraryResponse {
  return {
    groups: loadPluginGroups().map((group) => ({
      id: group.id,
      title: group.title,
      ...(group.titleZh !== undefined ? { titleZh: group.titleZh } : {}),
      plugins: group.plugins.map(toPluginItem),
    })),
  };
}

/** GET /api/plugins (any logged-in user; no Project check). */
export function pluginLibraryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(libraryResponse()));
  // Everything one plugin ships, as text keyed by path, for the library detail view's file
  // browser (the listing never carries bodies or scripts).
  app.get("/:plugin/files", (c) => {
    const pluginName = c.req.param("plugin");
    const plugin = libraryPlugin(pluginName);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    return c.json({ files: pluginFiles(plugin) } satisfies PluginFilesResponse);
  });
  return app;
}

/** /api/projects/:p/agents/:a/plugins: install is a Project-member operation. */
export function agentPluginsRoutes(deps: PluginsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const names = optionalStringArray(await readJson(c), "names") ?? [];
    if (names.length === 0) throw badRequest("names must be a non-empty array.");
    // Verify every name up front before writing anything: an unknown name rejects the whole
    // request rather than leaving a half-installed state.
    const plugins = resolveLibraryPlugins(names);
    for (const plugin of plugins) {
      await installPlugin(deps.config.root, projectId, agentId, plugin);
    }
    // Hook packages are bound when a core Session is built (skills are read from disk on
    // demand, hooks are not): a runtime cached for this Agent would keep running the old
    // set — or none — until it was evicted, so its next idle access re-resumes it.
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    const [skills, hooks] = await Promise.all([
      listInstalledSkills(deps.config.root, projectId, agentId),
      listInstalledHooks(deps.config.root, projectId, agentId),
    ]);
    return c.json(
      {
        skills: skills.map(toSkillItem),
        hooks: hooks.map(toHookItem),
      } satisfies AgentPluginsInstallResponse,
      201,
    );
  });

  return app;
}

/** Project-owner account setup, scoped to the agent receiving delegation tools. */
export function codexConnectionRoutes(
  deps: PluginsRouteDeps,
  connections: Pick<CodexConnections, "status" | "connect" | "disconnect">,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    await next();
  });
  app.get("/", async (c) => c.json(await connections.status(c.req.param("projectId")!)));
  app.post("/", async (c) => {
    const projectId = c.req.param("projectId")!;
    const agentId = c.req.param("agentId")!;
    await prepareCodexAgent(deps, projectId, agentId);
    return c.json(await connections.connect(projectId));
  });
  app.delete("/", async (c) => c.json(await connections.disconnect(c.req.param("projectId")!)));
  return app;
}

export async function prepareCodexAgent(
  deps: PluginsRouteDeps,
  projectId: string,
  agentId: string,
) {
  const plugin = libraryPlugin("use-codex");
  if (!plugin)
    throw new HttpError(503, "codex_unavailable", "Codex is unavailable in this installation");
  const server = codexServerPath();
  const args = [server, "--project-dir", projectDir(deps.config.root, projectId)];
  const { config } = await deps.agentConfigService.getConfig(projectId, agentId);
  const existing = config.mcpServers.find((s) => s.name === "codex");
  // Never overwrite an operator's custom MCP entry or locally edited skill.
  if (
    existing &&
    (JSON.stringify(existing.config.args) !== JSON.stringify(args) ||
      !["node", process.execPath].includes(String(existing.config.command)) ||
      existing.config.permission === "r")
  )
    throw new HttpError(
      409,
      "codex_config_conflict",
      "An existing Codex MCP configuration differs. Rename or remove it in Agent Settings before connecting.",
    );
  if (!existing)
    await deps.agentConfigService.updateConfig(projectId, agentId, {
      config: {
        mcpServers: [
          ...config.mcpServers,
          {
            name: "codex",
            config: {
              command: process.execPath,
              args,
              timeoutMs: 60000,
              maxOutputLength: 180000,
              ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
            },
          },
        ],
      },
    });
  const skills = await listInstalledSkills(deps.config.root, projectId, agentId);
  if (!skills.some((s) => s.name === "codex"))
    await installPlugin(deps.config.root, projectId, agentId, plugin);
  deps.manager.invalidateAgentRuntimes(projectId, agentId);
}

/** The plugin library and the Agent-scoped install/uninstall groups, as one route component. */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "PluginRoutes.library", prefix: "/api/plugins", auth: "user", order: 70 },
      {
        id: "PluginRoutes.agent-plugins",
        prefix: "/api/projects/:projectId/agents/:agentId/plugins",
        auth: "user",
        order: 222,
      },
      {
        id: "PluginRoutes.agent-hooks",
        prefix: "/api/projects/:projectId/agents/:agentId/hooks",
        auth: "user",
        order: 224,
      },
      {
        id: "PluginRoutes.codex",
        prefix: "/api/projects/:projectId/agents/:agentId/codex",
        auth: "user",
        order: 225,
      },
    ],
  },
})
export class PluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly manager!: ManagerIface;
  @Bind("PluginRoutes.library") libraryRoutes!: Hono<AppEnv>;
  @Bind("PluginRoutes.agent-plugins") pluginRoutes!: Hono<AppEnv>;
  @Bind("PluginRoutes.agent-hooks") hookRoutes!: Hono<AppEnv>;
  @Bind("PluginRoutes.codex") codexRoutes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    const deps = {
      config: this.config,
      access: this.access,
      agentConfigService: this.agentConfig,
      manager: this.manager,
    };
    this.libraryRoutes = pluginLibraryRoutes();
    this.pluginRoutes = agentPluginsRoutes(deps);
    this.hookRoutes = agentHooksRoutes(deps);
    const connections = new CodexConnections(this.config.root);
    effect(() => connections.dispose());
    this.codexRoutes = codexConnectionRoutes(deps, connections);
  }
}

export function pluginRegistryRoutes(bases: () => readonly PluginBase[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = builtinPluginRegistry(bases);
  app.get("/", async (c) => {
    const body: PluginIndexResponse = { plugins: await registry.index() };
    return c.json(body);
  });
  app.get("/readme", async (c) => {
    const name = c.req.query("name");
    if (name === undefined || name === "") {
      return c.json({ error: { code: "bad_request", message: "name is required" } }, 400);
    }
    // Only entries this deployment actually lists: the readme map is keyed by specifier,
    // and answering for an unlisted name would make the endpoint a probe of what exists.
    const listed = (await registry.index()).some((e) => e.name === name);
    if (!listed) {
      return c.json({ error: { code: "not_found", message: "no such plugin" } }, 404);
    }
    const body: PluginReadmeResponse = { name, readme: await registry.readme(name) };
    return c.json(body);
  });
  return app;
}

/**
 * The registry the Plugins page reads beside the built-in library: deployment-global, and
 * nested under /api/plugins/registry so both views answer under one prefix. The specifier
 * is a query parameter on `readme`, not a path segment, because it is scoped
 * (`@scope/name`) and would otherwise have to survive two rounds of slash encoding.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginRegistryRoutes.routes",
        prefix: "/api/plugins/registry",
        auth: "user",
        order: 69,
      },
    ],
  },
})
export class PluginRegistryRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Bind("PluginRegistryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    // Read per request: a push moves the shipped prefix to a new assets directory.
    this.routes = pluginRegistryRoutes(() => pluginBases(this.config.root, this.hmr.assetsDir()));
  }
}
