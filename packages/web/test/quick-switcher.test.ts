/**
 * quick-switcher.ts / quick-switcher-recents.ts unit tests: the Quick Switcher's pure
 * decisions. The filter ranks prefix > substring > secondary-text > fuzzy subsequence
 * (case-insensitive) and always answers in grouped sections — pages, agents, sessions —
 * with the empty query surfacing the stored recents first (stale ids and duplicates
 * ignored, capped). Recents are one guarded localStorage list (injectable storage:
 * vitest runs in Node): corrupt JSON, non-array payloads, non-string items and throwing
 * storage all read back as empty, and a push dedupes, caps and persists best-effort.
 */
import { describe, expect, it } from "vitest";
import {
  SWITCHER_SECTIONS,
  buildAgentEntries,
  buildPageEntries,
  buildSessionEntries,
  filterSwitcherEntries,
  isSubsequence,
  nextSwitcherCursor,
  switcherMatchScore,
} from "../src/lib/quick-switcher";
import type { SwitcherEntry } from "../src/lib/quick-switcher";
import {
  QUICK_SWITCHER_RECENTS_KEY,
  QUICK_SWITCHER_RECENTS_LIMIT,
  pushQuickSwitcherRecent,
  readQuickSwitcherRecents,
} from "../src/lib/quick-switcher-recents";
import type { SwitcherRecentsStorage } from "../src/lib/quick-switcher-recents";
import { en } from "../src/lib/strings-en";
import { navKeysFor } from "../src/lib/nav-group-collapse";

/** In-memory storage (vitest runs in a Node environment, no localStorage; nav-group-collapse.test.ts convention). */
function memStorage(): SwitcherRecentsStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** Throwing storage: merely touching localStorage can throw a SecurityError (blocked site data). */
const throwingStorage: SwitcherRecentsStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("entry builders", () => {
  it("pages take /<key> targets and their nav titles; ids are recents-stable", () => {
    const keys = navKeysFor(true);
    const entries = buildPageEntries(keys.map((key) => ({ key, title: en.nav[key] })));
    expect(entries.map((e) => e.id)).toEqual(keys.map((key) => `page:${key}`));
    expect(entries.map((e) => e.to)).toEqual(keys.map((key) => `/${key}`));
    expect(entries[0]).toMatchObject({
      section: "pages",
      title: en.nav[keys[0]!],
      detail: null,
      busy: null,
      routeState: null,
    });
  });

  it("agents are named by title with the command line as detail, and land on the coding-agents page", () => {
    const entries = buildAgentEntries([
      { id: "claude", title: "Claude Code", command: "claude --experimental-acp" },
      { id: "gemini", title: "gemini", command: "gemini --experimental-acp" },
    ]);
    expect(entries).toEqual([
      {
        id: "agent:claude",
        section: "agents",
        title: "Claude Code",
        detail: "claude --experimental-acp",
        to: "/coding-agents",
        routeState: null,
        busy: null,
      },
      {
        id: "agent:gemini",
        section: "agents",
        title: "gemini",
        detail: "gemini --experimental-acp",
        to: "/coding-agents",
        routeState: null,
        busy: null,
      },
    ]);
  });

  it("sessions are named by set title or id, carry the agent name as detail, and preselect themselves via route state", () => {
    const entries = buildSessionEntries([
      {
        sessionId: "s-1",
        agentId: "claude",
        title: "Fix the login flow",
        agentTitle: "Claude Code",
        busy: true,
      },
      {
        sessionId: "s-2",
        agentId: "gemini",
        title: null,
        agentTitle: null,
        busy: false,
      },
    ]);
    expect(entries.map((e) => e.title)).toEqual(["Fix the login flow", "s-2"]);
    expect(entries.map((e) => e.detail)).toEqual(["Claude Code", "gemini"]);
    expect(entries.map((e) => e.busy)).toEqual([true, false]);
    expect(entries[0]!.to).toBe("/coding-agents");
    expect(entries[0]!.routeState).toEqual({ sessionId: "s-1" });
    expect(entries[0]!.id).toBe("session:s-1");
  });
});

describe("switcherMatchScore", () => {
  it("ranks exact > prefix > substring > detail hit > fuzzy subsequence", () => {
    const q = "cod";
    const scores = {
      exact: switcherMatchScore("cod", null, q),
      prefix: switcherMatchScore("coding agents", null, q),
      substring: switcherMatchScore("my coding agents", null, q),
      detail: switcherMatchScore("Agents", "run the cod command", q),
      fuzzy: switcherMatchScore("chaos order desk", null, q),
      none: switcherMatchScore("models", null, q),
    };
    expect(scores.exact).toBeGreaterThan(scores.prefix);
    expect(scores.prefix).toBeGreaterThan(scores.substring);
    expect(scores.substring).toBeGreaterThan(scores.detail);
    expect(scores.detail).toBeGreaterThan(scores.fuzzy);
    expect(scores.fuzzy).toBeGreaterThan(0);
    expect(scores.none).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(switcherMatchScore("Coding Agents", null, "COD")).toBe(
      switcherMatchScore("coding agents", null, "cod"),
    );
  });

  it("scores nothing without a query (the empty query shows recents, not everything ranked)", () => {
    expect(switcherMatchScore("Agents", null, "")).toBe(0);
  });

  it("isSubsequence demands the query characters in order", () => {
    expect(isSubsequence("gnt", "coding agents")).toBe(true);
    expect(isSubsequence("age", "coding agents")).toBe(true);
    expect(isSubsequence("sg", "coding agents")).toBe(false);
    expect(isSubsequence("dz", "coding agents")).toBe(false);
  });
});

describe("filterSwitcherEntries", () => {
  const entries: SwitcherEntry[] = [
    ...buildPageEntries([
      { key: "agents", title: "Agents" },
      { key: "models", title: "Models" },
    ]),
    ...buildAgentEntries([
      { id: "claude", title: "Claude Code", command: "claude --experimental-acp" },
    ]),
    ...buildSessionEntries([
      {
        sessionId: "s-1",
        agentId: "claude",
        title: "Fix login",
        agentTitle: "Claude",
        busy: false,
      },
    ]),
  ];

  it("with no query, recents come first in recents order, then the sections in fixed order", () => {
    const groups = filterSwitcherEntries("", entries, ["agent:claude", "page:models"]);
    // The agents section is fully consumed by recents, so it drops out entirely.
    expect(groups.map((g) => g.section)).toEqual(["recents", "pages", "sessions"]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["agent:claude", "page:models"]);
    // The rest of the sections leave their recent members out (no double rows).
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(["page:agents"]);
    expect(groups[2]!.entries.map((e) => e.id)).toEqual(["session:s-1"]);
  });

  it("ignores stale recents and duplicates, and caps the recents group", () => {
    const groups = filterSwitcherEntries("", entries, [
      "session:s-1",
      "session:s-1",
      "page:gone",
      "agent:claude",
    ]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["session:s-1", "agent:claude"]);
    // "page:gone" matches nothing today, so the pages section keeps both its entries.
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(["page:agents", "page:models"]);
  });

  it("caps the recents group at five even when the stored list is longer", () => {
    const stored = [
      "session:s-1",
      "session:s-2",
      "session:s-3",
      "session:s-4",
      "session:s-5",
      "session:s-6",
    ];
    const many = buildSessionEntries(
      stored.map((id) => ({
        sessionId: id.slice("session:".length),
        agentId: "a",
        title: null,
        agentTitle: null,
        busy: false,
      })),
    );
    const groups = filterSwitcherEntries("", [...entries, ...many], stored);
    expect(groups[0]!.entries).toHaveLength(5);
  });

  it("with a query, sections stay grouped, ranked within each, and empty ones drop out", () => {
    // "cl" prefix-matches the Claude agent (agents section) and substring-matches the
    // session's agent detail (sessions section); both pages drop out.
    const groups = filterSwitcherEntries("cl", entries, []);
    expect(groups.map((g) => g.section)).toEqual(["agents", "sessions"]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["agent:claude"]);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(["session:s-1"]);
  });

  it("ranks a title prefix above a detail hit inside the same section", () => {
    const agents = buildAgentEntries([
      { id: "codex", title: "Codex", command: "codex acp" },
      { id: "other", title: "Other agent", command: "run codex" },
    ]);
    const groups = filterSwitcherEntries("cod", agents, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["agent:codex", "agent:other"]);
  });

  it("never reorders the fixed section sequence", () => {
    expect(SWITCHER_SECTIONS).toEqual(["pages", "agents", "sessions"]);
  });
});

describe("nextSwitcherCursor", () => {
  it("advances and wraps in both directions", () => {
    expect(nextSwitcherCursor(0, 3, 1)).toBe(1);
    expect(nextSwitcherCursor(2, 3, 1)).toBe(0);
    expect(nextSwitcherCursor(0, 3, -1)).toBe(2);
    expect(nextSwitcherCursor(2, 3, -1)).toBe(1);
  });

  it("answers 0 for an empty list", () => {
    expect(nextSwitcherCursor(1, 0, 1)).toBe(0);
    expect(nextSwitcherCursor(1, 0, -1)).toBe(0);
  });
});

describe("quick switcher recents storage", () => {
  it("reads nothing stored, corrupt JSON, non-arrays, and non-string items as empty", () => {
    const storage = memStorage();
    expect(readQuickSwitcherRecents(storage)).toEqual([]);

    storage.map.set(QUICK_SWITCHER_RECENTS_KEY, "not json");
    expect(readQuickSwitcherRecents(storage)).toEqual([]);

    storage.map.set(QUICK_SWITCHER_RECENTS_KEY, JSON.stringify({ id: "page:agents" }));
    expect(readQuickSwitcherRecents(storage)).toEqual([]);

    storage.map.set(QUICK_SWITCHER_RECENTS_KEY, JSON.stringify(["page:agents", 7, null]));
    expect(readQuickSwitcherRecents(storage)).toEqual(["page:agents"]);
  });

  it("a push moves the id to the front, dedupes, caps the list, and persists", () => {
    const storage = memStorage();
    for (const id of ["a", "b", "c", "d", "e"]) pushQuickSwitcherRecent(id, storage);
    expect(storage.map.get(QUICK_SWITCHER_RECENTS_KEY)).toBe(
      JSON.stringify(["e", "d", "c", "b", "a"]),
    );
    expect(readQuickSwitcherRecents(storage)).toHaveLength(QUICK_SWITCHER_RECENTS_LIMIT);

    // Re-selecting an older entry moves it to the front instead of duplicating it.
    pushQuickSwitcherRecent("c", storage);
    expect(readQuickSwitcherRecents(storage)).toEqual(["c", "e", "d", "b", "a"]);
    // And a sixth distinct selection pushes the oldest off.
    pushQuickSwitcherRecent("f", storage);
    expect(readQuickSwitcherRecents(storage)).toEqual(["f", "c", "e", "d", "b"]);
  });

  it("a throwing storage reads as empty and a push still answers the in-memory list", () => {
    expect(readQuickSwitcherRecents(throwingStorage)).toEqual([]);
    expect(pushQuickSwitcherRecent("page:agents", throwingStorage)).toEqual(["page:agents"]);
  });
});
