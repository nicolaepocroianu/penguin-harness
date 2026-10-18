/**
 * The admin side of activity authoring, and the coding agents, as the demo server holds them:
 * the outcome ledger of a few runs of one activity, the run folders' disk and a cleanup's dry
 * run, the test browser, the WAF workspace and its settings, the activity sandbox switch, the
 * deploy settings (tokens only as whether one is set), and the coding agents with the built-in
 * Copilot. Typed by the server's own DTOs, like the rest of the fixtures.
 */
import type {
  ActivitySandboxState,
  BuiltinAgentInfo,
  CodingAgentDiscoveryCandidate,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
  DeploySettingsView,
  OutcomeRun,
  RunCleanupPlan,
  RunRecipe,
  RunStorage,
  RunStory,
  TestBrowserStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "@prismshadow/penguin-server/api";
import { IDS } from "./ids";

type ModelOptions = CodingAgentDiscoveryResponse["agentModels"][string];

export interface ActivityAdminFixtures {
  /** The one activity the ledger has runs of, and its runs (newest first). */
  activityId: string;
  recipes: { id: string; recipe: RunRecipe }[];
  runs: OutcomeRun[];
  stories: RunStory[];
  storage: RunStorage;
  /** The latest dry run, until it is confirmed. */
  plan: RunCleanupPlan | null;
  benchHome: string | null;
  testBrowser: TestBrowserStatus;
  wafWorkspace: WafWorkspaceStatus;
  wafSettings: WafWorkspaceSettings;
  sandbox: ActivitySandboxState;
  deploy: DeploySettingsView;
  codingAgents: CodingAgentServerInfo[];
  candidates: CodingAgentDiscoveryCandidate[];
  agentModels: Record<string, ModelOptions>;
  probedAt: number | undefined;
  copilot: BuiltinAgentInfo;
}

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const claudeModels: ModelOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "sonnet",
    options: [
      { value: "sonnet", name: "Sonnet" },
      { value: "opus", name: "Opus" },
      { value: "haiku", name: "Haiku" },
    ],
  },
];

const codexModels: ModelOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-5-codex",
    options: [
      { value: "gpt-5-codex", name: "GPT-5 Codex" },
      { value: "gpt-5", name: "GPT-5" },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

export function buildActivityAdmin(now: number): ActivityAdminFixtures {
  const ago = (minutes: number) => iso(now - minutes * MINUTE);
  const activityId = "spelling-bee-l1";
  const library = [
    {
      plugin: "waf-authoring",
      version: "2026.10.12",
      skills: [
        {
          name: "activity-spec",
          version: "2026.10.12",
          sha256: "4f1c0e9a7b2d3c5e6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6",
        },
      ],
    },
  ];
  const recipes = [
    {
      id: "r-3f9a",
      recipe: {
        runtime: "agent:deepseek/deepseek-flash",
        library,
        penguin: "0.42.0",
      } satisfies RunRecipe,
    },
    {
      id: "r-81c2",
      recipe: { runtime: "coding:claude-code", library, penguin: "0.42.0" } satisfies RunRecipe,
    },
  ];
  const runs: OutcomeRun[] = [
    {
      runId: "run-0007",
      projectId: IDS.project,
      activityId,
      startedAt: ago(40),
      status: "succeeded",
    },
    {
      runId: "run-0006",
      projectId: IDS.project,
      activityId,
      startedAt: ago(190),
      status: "failed",
    },
    {
      runId: "run-0005",
      projectId: IDS.project,
      activityId,
      startedAt: ago(1500),
      status: "succeeded",
    },
    {
      runId: "run-0004",
      projectId: IDS.project,
      activityId,
      startedAt: ago(2900),
      status: "succeeded",
    },
  ];
  const stories: RunStory[] = runs.map((run, i) => {
    const started = Date.parse(run.startedAt);
    const seconds = 140 + i * 37;
    return {
      runId: run.runId,
      activityId,
      kind: "spec",
      startedAt: run.startedAt,
      recipe: recipes[i % 2]!.recipe,
      facts: [
        { fact: "opened", at: iso(started), detail: {} },
        { fact: "started", at: iso(started + 2_000), detail: {} },
        {
          fact: "settled",
          at: iso(started + seconds * 1_000),
          detail: { status: run.status, seconds },
        },
        ...(run.status === "succeeded"
          ? [{ fact: "accepted" as const, at: iso(started + (seconds + 90) * 1_000), detail: {} }]
          : []),
      ],
    };
  });
  return {
    activityId,
    recipes,
    runs,
    stories,
    storage: { bytes: 734_003_200, folders: 23 },
    plan: null,
    benchHome: null,
    testBrowser: {
      available: true,
      installed: true,
      version: "149.0.7827.55",
      path: "/var/lib/penguin/test-browser/chromium-1194",
      installing: false,
      error: null,
      log: null,
    },
    wafWorkspace: {
      managed: true,
      root: "/var/lib/penguin/waf",
      ready: true,
      repos: (
        [
          ["framework", "waf-framework", "main", true],
          ["navbar", "waf-navbar", "main", true],
          ["media", "waf-media", "main", null],
          ["activityData", "waf-activity-data", "develop", null],
        ] as const
      ).map(([id, folder, branch, installed]) => ({
        id,
        path: `/var/lib/penguin/waf/${folder}`,
        present: true,
        remote: `git@github.com:waterford/${folder}.git`,
        remoteMatches: true,
        branch,
        branchMatches: true,
        dirty: false,
        installed,
      })),
      preparing: false,
      lastError: null,
      log: [],
    },
    wafSettings: {
      externalRoot: "",
      repos: {
        framework: { remote: "git@github.com:waterford/waf-framework.git", branch: "main" },
        navbar: { remote: "git@github.com:waterford/waf-navbar.git", branch: "main" },
        media: { remote: "git@github.com:waterford/waf-media.git", branch: "main" },
        activityData: {
          remote: "git@github.com:waterford/waf-activity-data.git",
          branch: "develop",
        },
      },
      moduleRemote: "git@github.com:waterford/{module}.git",
    },
    sandbox: { enabled: true, problem: null },
    deploy: {
      qa: {
        jenkinsUrl: "https://jenkins-qa.example.com",
        username: "deploy-bot",
        token: { set: true },
        tier: "qa",
        environment: "qa1",
        frameworkVersion: "4.12.0",
        activityBaseUrl: "https://qa.example.com/activities/",
      },
      prod: {
        jenkinsUrl: "https://jenkins.example.com",
        username: "deploy-bot",
        token: { set: false },
        tier: "prod",
        environment: "prod",
        frameworkVersion: "4.12.0",
      },
      jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
      repos: { mediaPublicBase: "/media/" },
      git: { userName: "Penguin Deploy", userEmail: "deploy@example.com" },
      timeouts: { buildMinutes: 30, deployMinutes: 30 },
    },
    codingAgents: [
      {
        id: "claude-code",
        title: "Claude Code",
        command: "npx",
        args: ["-y", "@zed-industries/claude-code-acp"],
        rememberedModel: { configId: "model", value: "sonnet", name: "Sonnet" },
        rememberedOptions: {},
        env: [],
        envPending: false,
      },
      {
        id: "codex",
        title: "Codex",
        command: "npx",
        args: ["-y", "@zed-industries/codex-acp"],
        rememberedModel: null,
        rememberedOptions: { reasoning_effort: "medium" },
        env: [{ key: "OPENAI_BASE_URL", valueMasked: "http****" }],
        envPending: false,
      },
    ],
    candidates: [
      {
        recipeId: "claude-code",
        title: "Claude Code",
        homepageUrl: "https://docs.anthropic.com/en/docs/claude-code",
        detected: true,
        launch: { command: "npx", args: ["-y", "@zed-industries/claude-code-acp"] },
        authHint: "Sign in once with `claude` on the server machine.",
        setupHint: null,
        alreadyAdded: true,
        authStatus: "ok",
        authSource: "stored",
        models: claudeModels,
        installCommand: "npm install -g @anthropic-ai/claude-code",
      },
      {
        recipeId: "codex",
        title: "Codex",
        homepageUrl: "https://github.com/openai/codex",
        detected: true,
        launch: { command: "npx", args: ["-y", "@zed-industries/codex-acp"] },
        authHint: "Sign in once with `codex login` on the server machine.",
        setupHint: null,
        alreadyAdded: true,
        authStatus: "ok",
        authSource: "stored",
        models: codexModels,
        installCommand: "npm install -g @openai/codex",
      },
      {
        recipeId: "opencode",
        title: "OpenCode",
        homepageUrl: "https://opencode.ai",
        detected: false,
        launch: null,
        authHint: "Configure a provider with `opencode auth login` on the server machine.",
        setupHint: "The `opencode` command was not found on the server machine.",
        alreadyAdded: false,
        installCommand: "npm install -g opencode-ai",
      },
    ],
    agentModels: { "claude-code": claudeModels, codex: codexModels },
    probedAt: now - 25 * MINUTE,
    copilot: {
      id: "copilot",
      agentId: "copilot-builtin",
      title: "GitHub Copilot",
      status: "not-installed",
      installedVersion: null,
      pinnedVersion: "1.0.4",
      downloadSize: 62_914_560,
      progress: null,
      tokenMasked: null,
      envPending: false,
      message: null,
    },
  };
}
