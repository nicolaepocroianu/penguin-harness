/**
 * Which registry glyph each page wears in navigation: the sidebar nav, the collapsed rail, company
 * mode's page entries, and cross-page jump actions (the chat info dropdown's "view trace"). The
 * drawings live in the shared registry, named for what they draw; which drawing stands for which
 * page is the app's knowledge, so the map lives here.
 */
import { ICONS } from "@waterford/waf-harness-ui";

export const NAV_ICONS = {
  /** Agents: the robot head, the one glyph in the app that means "agent". */
  agents: ICONS.robot,
  /** Activity Studio (a written page): the activities a module is authored from. */
  activities: ICONS.fileLines,
  /** The media library (a picture): the files every activity of the project draws from. */
  media: ICONS.image,
  /** Coding agents (the bot with an antenna): the external programs a session can run. */
  "coding-agents": ICONS.robotVisor,
  /** Plugin library (the puzzle piece). */
  plugins: ICONS.puzzle,
  /** Model library (a chip). */
  models: ICONS.chip,
  /** Machines (two stacked server units). */
  machines: ICONS.server,
  usage: ICONS.barChart,
  /** Trace observation (an open eye): watching what a run actually did. */
  traces: ICONS.eye,
  /** Benchmark center (a trophy). */
  benchmark: ICONS.trophy,
  /** Terminal (a `>_` prompt in a window frame). */
  terminal: ICONS.terminalWindow,
  /** Company mode's overview. */
  orgOverview: ICONS.dashboard,
  /** The org chart. */
  orgChart: ICONS.network,
  /** The organization calendar: the same calendar the sidebar's time grouping wears. */
  orgCalendar: ICONS.calendar,
  /** The ticket board. */
  orgTickets: ICONS.kanban,
  /** Finance. */
  orgFinance: ICONS.dollarCircle,
  /** The handbook, the company's knowledge base. */
  orgHandbook: ICONS.bookOpen,
} as const;
