/**
 * Data router: /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 */
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router";
import { useAuth } from "./state/auth";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
import { CompanyProvider } from "./state/company";
import { AppLayout } from "./components/layout/app-layout";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";
import { OrgIndexRedirect, OrgLayout } from "./features/company/org-layout";
import { lazy, Suspense } from "react";
import { PAGES } from "./lib/pages";
import type { PageEntry } from "./lib/pages";

/**
 * Every page but chat (where the app opens) loads on first visit, so the first paint downloads
 * the shell and the chat page only — not the activity studio's editors, the charts, the
 * terminal. A route's element sits inside the shell's `<Suspense>`, which keeps the sidebar up
 * while a page's code arrives.
 */
function lazyPage<K extends string>(
  load: () => Promise<Record<K, React.ComponentType>>,
  name: K,
): React.LazyExoticComponent<React.ComponentType> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const AgentsPage = lazyPage(() => import("./features/agents/agents-page"), "AgentsPage");
const ActivitiesPage = lazyPage(
  () => import("./features/activities/activities-page"),
  "ActivitiesPage",
);
const AgentSettingsPage = lazyPage(
  () => import("./features/agents/agent-settings-page"),
  "AgentSettingsPage",
);
const PluginsPage = lazyPage(() => import("./features/plugins/plugins-page"), "PluginsPage");
const ModelsPage = lazyPage(() => import("./features/models/models-page"), "ModelsPage");
const PluginDetailPage = lazyPage(
  () => import("./features/plugins/plugin-detail-page"),
  "PluginDetailPage",
);
const UsagePage = lazyPage(() => import("./features/usage/usage-page"), "UsagePage");
const BenchmarkPage = lazyPage(
  () => import("./features/benchmark/benchmark-page"),
  "BenchmarkPage",
);
const BenchmarkDetailPage = lazyPage(
  () => import("./features/benchmark/benchmark-detail-page"),
  "BenchmarkDetailPage",
);
const TerminalPage = lazyPage(() => import("./features/terminal/terminal-page"), "TerminalPage");
const OverviewPage = lazyPage(() => import("./features/company/overview-page"), "OverviewPage");
const OrgChartPage = lazyPage(() => import("./features/company/org-chart-page"), "OrgChartPage");
const CalendarPage = lazyPage(() => import("./features/company/calendar-page"), "CalendarPage");
const TicketsPage = lazyPage(() => import("./features/company/tickets-page"), "TicketsPage");
const FinancePage = lazyPage(() => import("./features/company/finance-page"), "FinancePage");
const ChannelView = lazyPage(() => import("./features/company/channel-view"), "ChannelView");
const HandbookPage = lazyPage(() => import("./features/company/handbook-page"), "HandbookPage");
const MachinesPage = lazyPage(() => import("./features/machines/machines-page"), "MachinesPage");

/**
 * The renderers the manifest may name. A page is a module.json entry plus one line here;
 * a server-contributed page renders only when its `builtin` is in this registry.
 */
const BUILTIN_PAGES: Record<string, React.ComponentType> = {
  ChatPage,
  AgentsPage,
  ActivitiesPage,
  AgentSettingsPage,
  PluginsPage,
  ModelsPage,
  PluginDetailPage,
  MachinesPage,
  UsagePage,
  BenchmarkPage,
  BenchmarkDetailPage,
};

function renderPage(page: PageEntry): React.ReactNode {
  if ("iframe" in page.renderer) {
    return (
      <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
    );
  }
  const Component = BUILTIN_PAGES[page.renderer.builtin];
  return Component === undefined ? <Navigate to="/chat" replace /> : <Component />;
}

/** Route guard: shows blank while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return null; // GET /api/me is still initializing
  if (user === null) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <SessionsProvider>
        <CompanyProvider>
          <AppLayout />
        </CompanyProvider>
      </SessionsProvider>
    </ProjectProvider>
  );
}

/**
 * Login guard without the app shell: the terminal page is a standalone full-window surface
 * (no sidebar, no Project context), it only needs the user to be signed in — the terminal
 * WebSocket authenticates with the same session cookie.
 */
function RequireAuthBare({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (user === null) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** When already logged in, visiting /login redirects straight to the chat page. */
function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/chat" replace />;
  return <LoginPage />;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/terminal"
        element={
          <RequireAuthBare>
            <Suspense fallback={null}>
              <TerminalPage />
            </Suspense>
          </RequireAuthBare>
        }
      />
      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/chat" replace />} />
        {/* Every page is a module.json entry (lib/pages.ts). Admin-only ones are refused
              server-side (403); the sidebar hides their row, so a member only ever reaches
              one by typing the URL. */}
        {PAGES.map((page) => (
          <Route key={page.id} path={page.path} element={renderPage(page)} />
        ))}
        {/* Company mode: /org resolves to an organization (or the empty landing), and an
              organization opens on its overview — the page that says what the whole
              organization is doing; its channels are the sidebar's own list beside it. Both
              fall back to /chat while company mode is unavailable (see OrgLayout). */}
        <Route path="/org" element={<OrgIndexRedirect />} />
        <Route path="/org/:projectId/:orgId" element={<OrgLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="chart" element={<OrgChartPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="handbook" element={<HandbookPage />} />
          <Route path="channels/:channelId" element={<ChannelView />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Route>
        {/* System settings and user management live in the settings dialog now (see
              SettingsDialog); their old routes fall through to the catch-all. */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </>,
  ),
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
