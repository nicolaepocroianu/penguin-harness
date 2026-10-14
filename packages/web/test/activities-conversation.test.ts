import { describe, expect, it } from "vitest";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import {
  composerDraftKey,
  conversationThreads,
  focusFor,
  focusLabel,
  followUpText,
  sameFocus,
  splitMovedTo,
  splitStudioBrief,
  splitStudioContext,
  shownConversation,
  threadTime,
} from "../src/features/activities/conversation";
import { sessionDraftKey } from "../src/features/chat/draft-cache";
import { indexRuns } from "../src/features/activities/runs-index";
import { runTitle } from "../src/features/activities/sessions-panel";
import { STUDIO_PANELS, readSidePanel } from "../src/features/activities/workspace-model";

const run = (
  runId: string,
  kind: ActivityRunSummary["kind"],
  createdAt: string,
  sessionId: string | null,
) => ({ runId, kind, createdAt, sessionId, status: "succeeded" }) as ActivityRunSummary;

describe("conversation panel", () => {
  it("lists every conversation with a session, newest first, as threads", () => {
    const runs = indexRuns([
      run("spec", "spec", "2026-09-23T10:00:00Z", "s-spec"),
      run("old", "assist", "2026-09-20T10:00:00Z", "s-old"),
      run("new", "assist", "2026-09-22T10:00:00Z", "s-new"),
      run("unstarted", "assist", "2026-09-23T11:00:00Z", null),
    ]);
    expect(conversationThreads(runs).map((thread) => thread.runId)).toEqual(["new", "old"]);
    expect(conversationThreads(indexRuns([]))).toEqual([]);
  });

  it("keeps unsent text in the Session's own slot, or the activity's before there is one", () => {
    const activity = { projectId: "p1", activityId: "act_1" };
    // The same slot the chat page reads for that Session, so the text follows it there.
    expect(composerDraftKey("u1", "s-1", activity)).toBe(sessionDraftKey("u1", "s-1"));
    expect(composerDraftKey("u1", null, activity)).toBe("penguin.chatDraft.activity.u1.p1.act_1");
    expect(composerDraftKey("u2", null, activity)).not.toBe(composerDraftKey("u1", null, activity));
    expect(composerDraftKey(null, "s-1", activity)).toBeNull();
  });

  it("follows the newest conversation unless the composer holds text for the one shown", () => {
    const follow = { choice: undefined, newest: "s-new", shown: "s-old", holding: false };
    expect(shownConversation(follow)).toBe("s-new");
    // Text written for the conversation shown keeps it, a new one included.
    expect(shownConversation({ ...follow, holding: true })).toBe("s-old");
    expect(shownConversation({ ...follow, shown: null, holding: true })).toBeNull();
    // A choice the author made stands either way.
    expect(shownConversation({ ...follow, choice: "s-mid", holding: true })).toBe("s-mid");
    expect(shownConversation({ ...follow, choice: null })).toBeNull();
  });

  it("focuses an asset only while the scenes section shows it", () => {
    const selection = { sceneId: "intro", key: "cat" };
    expect(focusFor("scenes", selection, "en-US")).toEqual({
      section: "scenes",
      sceneId: "intro",
      assetKey: "cat",
      language: "en-US",
    });
    expect(focusFor("description", selection, "en-US")).toEqual({ section: "description" });
    expect(focusFor("scenes", null, "en-US")).toEqual({ section: "scenes" });
    // An asset in no scene has no scene to name.
    expect(focusFor("scenes", { sceneId: "", key: "lost" }, "en-US")).toEqual({
      section: "scenes",
      assetKey: "lost",
      language: "en-US",
    });
  });

  it("names the focus the way the tree does", () => {
    expect(focusLabel(null)).toBe("the whole activity");
    expect(focusLabel({ section: "scenes", sceneId: "intro", assetKey: "cat" })).toBe(
      "cat in intro",
    );
    expect(focusLabel({ section: "scenes", assetKey: "lost" })).toBe("lost");
    expect(focusLabel({ section: "specification" })).toBe("Specification");
  });

  it("repeats where the author is only after they have moved", () => {
    const cat = { section: "scenes" as const, sceneId: "intro", assetKey: "cat" };
    expect(sameFocus(cat, { ...cat })).toBe(true);
    expect(followUpText("Shorter?", cat, { ...cat })).toBe("Shorter?");
    expect(followUpText("And this?", { section: "description" }, cat)).toBe(
      "And this?\n\n(I am now looking at Script.)",
    );
    // A resumed conversation has no remembered focus, so the first follow-up says it.
    expect(followUpText("Hi", cat, null)).toContain("cat in intro");
  });

  it("titles a conversation run and remembers the panel", () => {
    expect(runTitle("assist")).toBe("Conversation");
    expect(runTitle("assessment")).toBe("Assessment");
    expect(STUDIO_PANELS).toContain("conversation");
    expect(readSidePanel({ getItem: () => "conversation" })).toBe("conversation");
  });
});

describe("the studio brief", () => {
  it("folds the context the server appends to the first message", () => {
    const text = [
      "What is this activity about?",
      "",
      "---",
      "Context from the activity studio: the author is looking at the activity script.",
      "Read them.",
    ].join("\n");
    expect(splitStudioBrief(text)).toEqual({
      body: "What is this activity about?",
      context:
        "Context from the activity studio: the author is looking at the activity script.\nRead them.",
      viewing: "the activity script",
    });
  });

  it("reads the moved-to line off a follow-up, as the panel wrote it", () => {
    const sent = followUpText("And this?", { section: "specification" }, null);
    expect(splitMovedTo(sent)).toEqual({ body: "And this?", viewing: "Specification" });
    expect(splitStudioContext(sent)).toEqual({ body: "And this?", viewing: "Specification" });
    expect(splitMovedTo("And this?")).toBeNull();
    // A line the author typed in the middle of a message is theirs.
    expect(splitMovedTo("(I am now looking at X.)\n\nMore")).toBeNull();
  });

  it("leaves a rule the author typed alone", () => {
    expect(splitStudioBrief("Part one\n\n---\nPart two")).toBeNull();
    expect(splitStudioBrief("Just a question")).toBeNull();
  });
});

describe("thread times", () => {
  const now = new Date(2026, 9, 9, 18, 0);

  it("says Today for a conversation started today, to the minute", () => {
    const label = threadTime(new Date(2026, 9, 9, 9, 12, 45).toISOString(), now);
    expect(label.startsWith("Today ")).toBe(true);
    expect(label).not.toMatch(/45/);
  });

  it("gives the date for an older conversation", () => {
    expect(threadTime(new Date(2026, 9, 8, 23, 58).toISOString(), now).startsWith("Today")).toBe(
      false,
    );
  });
});
