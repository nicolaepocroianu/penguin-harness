import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercises the built React app with deterministic HTTP fixtures. No listening server
// or real credentials: this can run alongside someone's existing dev instance.
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "http://localhost:57321";
const projectId = "author-activities";
const base = `/api/projects/${projectId}/activities`;
/** A one-pixel PNG, small enough to hand straight to a file input. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);

const spec = {
  id: "words",
  title: "Sight words",
  activityDescription: "Practice words",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  scenes: [{ id: "intro", description: "Choose a word" }],
};

async function fixture(page) {
  let activity = null;
  let runs = [];
  let revision = 0;
  let role = "owner";
  let historyReads = 0;
  let candidateReads = 0;
  let firstCandidateGate = Promise.resolve();
  let failCandidate = false;
  let projectAvailable = true;
  let failedHistoryReads = 0;
  let activityRequests = 0;
  let deletedProjects = 0;
  const prefsWrites = [];
  const imageRequests = [];
  let imageFailure = false;
  // Media the activity workspace holds, as the upload routes would report it.
  const uploads = [];
  const audioRequests = [];
  let imageCandidateReads = 0;
  let imageCandidateFailure = false;
  let imageGenerationFailure = false;
  let mediaTextCandidateReads = 0;
  const assembleRequests = [];
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const p = url.pathname;
    if (p.startsWith(base)) activityRequests++;
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (p === "/api/me")
      return json({
        user: { userId: "author", isAdmin: false, passwordIsInitial: false },
        previewIsolated: true,
        desktopMode: false,
        companyMode: false,
        sessionVia: "password",
        uploadLimits: {
          attachmentMaxMb: 100,
          attachmentTotalMb: 120,
          attachmentMaxCount: 20,
          imageMaxMb: 20,
          attachmentLimitMinMb: 1,
          attachmentLimitMaxMb: 200,
        },
      });
    if (p === "/api/me/prefs") {
      if (request.method() === "PUT") prefsWrites.push(request.postDataJSON());
      return json({ prefs: {} });
    }
    if (p === "/api/projects")
      return json({
        projects: [
          {
            projectId,
            name: "Activities test",
            role,
            ownerUserId: "author",
            createdAt: "2026-09-19",
          },
          {
            projectId: "second-project",
            name: "Second project",
            role: "owner",
            ownerUserId: "author",
            createdAt: "2026-09-19",
          },
        ].filter((project) => projectAvailable || project.projectId !== projectId),
      });
    if (p === `/api/projects/${projectId}` && request.method() === "DELETE") {
      deletedProjects++;
      projectAvailable = false;
      return route.fulfill({ status: 204 });
    }
    if (p === `/api/projects/${projectId}` && request.method() === "PATCH") return json({});
    if (p === `/api/projects/${projectId}/agents` || p === "/api/projects/second-project/agents")
      return json({
        agents: [
          {
            agentId: "default_agent",
            name: "Default agent",
            pluginUpdates: [],
            activeSessionCount: 0,
            sessionCount: 0,
            sessionActivity: [],
            toolCount: 0,
            version: 1,
            kernelOutdated: false,
            vaultKeyCount: 0,
            scheduleCount: 0,
            skillCount: 0,
            hookCount: 0,
            memoryCount: 0,
          },
        ],
      });
    if (p === base && request.method() === "GET")
      return json({ activities: activity ? [activity] : [] });
    if (p === `${base}/module-setup`) return json({ wafRoot: "C:/WAF checkout" });
    if (p === `${base}/speech-setup`) return json({ voices: ["Kore", "Puck"] });
    if (p === `${base}/act_test/media-uploads`) {
      if (request.method() === "POST") {
        const input = request.postDataJSON();
        const stored = {
          path: `media/uploads/${input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-[^-]*$/, "")}-1234abcd.png`,
          name: `${input.name}`,
          kind: "image",
          mimeType: "image/png",
          byteLength: Buffer.from(input.dataBase64, "base64").byteLength,
          sha256: "a".repeat(64),
          updatedAt: "2026-09-21T10:00:00.000Z",
        };
        uploads.push(stored);
        return json(stored, 201);
      }
      return json({ media: uploads });
    }
    if (p === `${base}/act_test/media-upload`) {
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === `${base}/act_test/media-image`) {
      imageRequests.push(Object.fromEntries(url.searchParams));
      if (imageFailure)
        return json({ error: { code: "image_unavailable", message: "Missing image" } }, 404);
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === base && request.method() === "POST") {
      const input = request.postDataJSON();
      activity = {
        ...input,
        id: "act_test",
        collectionId: "col_test",
        createdAt: "2026-09-19",
        updatedAt: "2026-09-19",
        archived: false,
        draft: {
          draftId: "draft_test",
          activityId: "act_test",
          baseVersionId: null,
          contentRevision: String(++revision),
          status: "draft",
          description: "",
          spec: null,
          updatedAt: "2026-09-19",
        },
      };
      return json(activity, 201);
    }
    if (p === `${base}/act_test`) return json(activity);
    if (p === `${base}/act_test/runs`) {
      historyReads++;
      if (failedHistoryReads > 0) {
        failedHistoryReads--;
        return json({ error: { code: "internal", message: "Temporary history failure." } }, 503);
      }
      return json({
        runs: runs.map(({ candidate, ...run }) => ({ ...run, hasCandidate: candidate !== null })),
      });
    }
    if (p.startsWith(`${base}/act_test/runs/`) && p.endsWith("/candidate")) {
      candidateReads++;
      mediaTextCandidateReads += runs.some(
        (run) => p.includes(`/${run.runId}/`) && run.kind === "media-text",
      )
        ? 1
        : 0;
      if (p.includes("/run_test/")) await firstCandidateGate;
      if (failCandidate && p.includes("/run_second/")) {
        failCandidate = false;
        return json(
          { error: { code: "unavailable", message: "Candidate temporarily unavailable." } },
          503,
        );
      }
      return json({
        candidate: runs.find((run) => p.includes(`/${run.runId}/`))?.candidate ?? null,
      });
    }
    if (p.startsWith(`${base}/act_test/runs/`) && p.endsWith("/image")) {
      imageCandidateReads++;
      if (imageCandidateFailure) {
        imageCandidateFailure = false;
        return json(
          { error: { code: "unavailable", message: "Candidate temporarily unavailable." } },
          503,
        );
      }
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (p === "/api/projects/second-project/activities") return json({ activities: [] });
    if (p.startsWith("/api/projects/second-project/activities/"))
      return json({ error: { code: "activity_not_found", message: "Activity not found." } }, 404);
    if (p === `${base}/act_test/description`) {
      const body = request.postDataJSON();
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json(
          {
            error: {
              code: "draft_conflict",
              message: "Draft changed. Reload it before applying your edit.",
            },
          },
          409,
        );
      activity.draft = {
        ...activity.draft,
        description: body.description,
        contentRevision: String(++revision),
        status: "draft",
      };
      return json(activity.draft);
    }
    if (p === `${base}/act_test/generate-spec` || p === `${base}/act_test/assemble-module`) {
      if (p.endsWith("/assemble-module")) assembleRequests.push(request.postDataJSON());
      runs.unshift({
        kind: p.endsWith("/assemble-module") ? "module" : "spec",
        inputRevision: activity.draft.contentRevision,
        runId: "run_test",
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-audio`) {
      const body = request.postDataJSON();
      // The real server refuses a second concurrent generation for one activity.
      if (runs.some((run) => run.status === "running"))
        return json(
          {
            error: {
              code: "generation_running",
              message: "This activity already has a running generation.",
            },
          },
          409,
        );
      audioRequests.push({ assetKey: body.assetKey, language: body.language, voice: body.voice });
      runs.unshift({
        kind: "audio",
        audio: {
          language: body.language,
          assetKey: body.assetKey,
          voice: body.voice,
          script: "Hello",
        },
        runId: `run_audio_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-image`) {
      if (imageGenerationFailure) {
        imageGenerationFailure = false;
        return json({ error: { code: "unavailable", message: "Image generation failed." } }, 503);
      }
      const body = request.postDataJSON();
      runs.unshift({
        kind: "image",
        image: {
          language: body.language,
          assetKey: body.assetKey,
          prompt: body.prompt,
          model: body.model,
        },
        runId: `run_image_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p === `${base}/act_test/generate-media-text`) {
      const body = request.postDataJSON();
      const asset = activity.draft.mediaPlan.manifest.assets[body.language].find(
        (candidate) => candidate.key === body.assetKey,
      );
      runs.unshift({
        kind: "media-text",
        mediaText: {
          language: body.language,
          assetKey: body.assetKey,
          type: asset.type,
          text: asset.type === "audio" ? asset.script : asset.description,
        },
        runId: `run_media_text_${runs.length}`,
        inputRevision: activity.draft.contentRevision,
        activityId: activity.id,
        projectId,
        sessionId: "session_test",
        status: "running",
        createdAt: "2026-09-19T10:00:00Z",
        candidate: null,
        error: null,
      });
      return json(runs[0], 202);
    }
    if (p.endsWith("/accept-audio")) {
      const run = runs.find((run) => p.includes(`/${run.runId}/`));
      const asset = activity.draft.mediaPlan.manifest.assets["en-US"][0];
      asset.path = `media/generated/${run.runId}.wav`;
      asset.generatedAudio = { runId: run.runId, sha256: "test" };
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p.endsWith("/accept-image")) {
      const run = runs.find((candidate) => p.includes(`/${candidate.runId}/`));
      const asset = activity.draft.mediaPlan.manifest.assets[run.image.language].find(
        (candidate) => candidate.key === run.image.assetKey,
      );
      asset.path = `media/generated/${run.runId}.png`;
      asset.generatedImage = { runId: run.runId, sha256: "test-image" };
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p.endsWith("/accept-media-text")) {
      const body = request.postDataJSON();
      const run = runs.find((candidate) => p.includes(`/${candidate.runId}/`));
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json(
          { error: { code: "draft_conflict", message: "Draft changed. Reload it first." } },
          409,
        );
      const suggestion = JSON.parse(run.candidate);
      const asset = activity.draft.mediaPlan.manifest.assets[suggestion.language].find(
        (candidate) => candidate.key === suggestion.assetKey,
      );
      if (suggestion.type === "audio") asset.script = suggestion.text;
      else asset.description = suggestion.text;
      activity.draft.contentRevision = String(++revision);
      return json(activity.draft);
    }
    if (p === `${base}/act_test/apply-generated-spec`) {
      const body = request.postDataJSON();
      activity.draft = {
        ...activity.draft,
        spec: body.spec,
        contentRevision: String(++revision),
        status: "valid",
      };
      return json(activity.draft);
    }
    if (p === `${base}/act_test/plan-media` || p === `${base}/act_test/media`) {
      const body = request.postDataJSON();
      if (body.expectedRevision !== activity.draft.contentRevision)
        return json({ error: { code: "draft_conflict", message: "Draft changed." } }, 409);
      activity.draft = {
        ...activity.draft,
        contentRevision: String(++revision),
        mediaPlan: {
          specRevision: "spec-revision",
          manifest: body.manifest ?? {
            productCode: "words",
            refNum: 12,
            assets: {
              "en-US": [
                {
                  key: "cat",
                  type: "image",
                  description: "A cat",
                  usages: [
                    { sceneId: "intro", sourceKey: "cat", occurrence: 1, sceneOccurrenceCount: 1 },
                  ],
                },
              ],
            },
          },
        },
      };
      return json(activity.draft);
    }
    if (p === `${base}/act_test/readiness`) return json({ checks: [] });
    if (p.startsWith("/api/")) {
      if (p.endsWith("/usage/errors")) return json({ items: [], total: 0 });
      if (p.endsWith("/sessions"))
        return json({
          sessions: [],
          counts: { active: 0, archived: 0, schedule: 0, benchmark: 0 },
        });
      if (p.endsWith("/organizations")) return json({ organizations: [] });
      if (p.endsWith("/models")) return json({ models: [] });
      if (p.endsWith("/events"))
        return route.fulfill({ contentType: "text/event-stream", body: "" });
      return json({});
    }
    const asset = p.startsWith("/assets/")
      ? path.join(dist, p.slice(1))
      : path.join(dist, "index.html");
    const contentType = asset.endsWith(".js")
      ? "application/javascript"
      : asset.endsWith(".css")
        ? "text/css"
        : asset.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    return route.fulfill({ contentType, body: await fs.readFile(asset) });
  });
  return {
    completeAudio() {
      runs[0].status = "succeeded";
      runs[0].candidate = "{}";
    },
    completeImage() {
      runs[0].status = "succeeded";
      runs[0].candidate = "image";
    },
    completeMediaText(text) {
      runs[0].status = "succeeded";
      runs[0].candidate = JSON.stringify({ ...runs[0].mediaText, text });
    },
    errors,
    audioRequests,
    finishAudio() {
      for (const run of runs)
        if (run.kind === "audio" && run.status === "running") run.status = "succeeded";
    },
    imageRequests,
    setImageFailure(value) {
      imageFailure = value;
    },
    prefsWrites,
    removeProject() {
      projectAvailable = false;
    },
    failHistory() {
      failedHistoryReads++;
    },
    changeSavedDescription() {
      activity.draft.description = "Remote description";
      activity.draft.contentRevision = String(++revision);
    },
    get activityRequests() {
      return activityRequests;
    },
    get deletedProjects() {
      return deletedProjects;
    },
    get historyReads() {
      return historyReads;
    },
    get candidateReads() {
      return candidateReads;
    },
    get imageCandidateReads() {
      return imageCandidateReads;
    },
    get mediaTextCandidateReads() {
      return mediaTextCandidateReads;
    },
    assembleRequests,
    failImageCandidate() {
      imageCandidateFailure = true;
    },
    failImageGeneration() {
      imageGenerationFailure = true;
    },
    conflictMediaText(text) {
      runs[0].status = "conflict";
      runs[0].candidate = JSON.stringify({ ...runs[0].mediaText, text });
      activity.draft.contentRevision = String(++revision);
    },
    secondCandidate() {
      runs.push({
        ...runs[0],
        runId: "run_second",
        candidate: JSON.stringify({ ...spec, title: "Second candidate" }),
      });
    },
    holdFirstCandidate() {
      let release;
      firstCandidateGate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    failSecondCandidate() {
      failCandidate = true;
    },
    complete() {
      if (runs[0].kind === "module") {
        runs[0] = {
          ...runs[0],
          status: "succeeded",
          candidate: JSON.stringify({ previewPath: "preview/index.html", files: [] }),
        };
        return;
      }
      runs[0] = { ...runs[0], status: "succeeded", candidate: JSON.stringify(spec) };
      activity.draft = {
        ...activity.draft,
        spec,
        status: "valid",
        contentRevision: String(++revision),
      };
    },
    conflict() {
      runs[0] = {
        ...runs[0],
        status: "conflict",
        candidate: JSON.stringify(spec),
        error: "Draft changed. Reload it before applying your edit.",
      };
      activity.draft.description = "Changed in another tab";
      activity.draft.contentRevision = String(++revision);
    },
    member() {
      role = "member";
    },
  };
}

/**
 * The activity editor is a workspace: its parts live behind a rail rather than stacked
 * down one page, so a test opens the part it is about before touching it.
 */
/** The workspace's sections, under the names the Loom-style hierarchy gives them. */
const TREE_NAMES = {
  Description: "Activity Script",
  Specification: "Activity Spec",
  "Scenes and media": "Scenes",
  "Speech coverage": "Audios",
  "Media library": "Media Library",
  "Module preview": "Module Definition",
  "Generation history": "Generation History",
};

async function openSection(page, name) {
  // Level 1: Loom's hierarchy repeats "Audios" as a group inside every scene.
  const button = page.getByRole("treeitem", {
    name: TREE_NAMES[name] ?? name,
    exact: true,
    level: 1,
  });
  // On a workspace too narrow for both panes the rail is shut over the work, so its
  // sections are not on the page until it is opened. Wait for one or the other, since
  // an absent button also means the page has not rendered the rail yet.
  const expand = page.getByRole("button", { name: "Expand the activity rail", exact: true });
  await expect(button.or(expand).first()).toBeVisible();
  const opened = !(await button.count());
  if (opened) await expand.click();
  // Clicking the section already showing re-renders the rail under the click, but a rail
  // opened just now is covering the work and has to be dismissed by choosing anyway.
  if (opened || (await button.getAttribute("aria-current")) !== "true") await button.click();
  // Scenes opens on the storyboard once there is a media plan; the media itself is one
  // step further, which is where these tests work.
  if (name === "Scenes and media") {
    const board = page.getByRole("heading", { name: "Storyboard", exact: true });
    await expect(
      board.or(page.getByRole("heading", { name: /^Media plan/ })).first(),
    ).toBeVisible();
    if (await board.count())
      await page.getByRole("button", { name: "Edit media", exact: true }).click();
  }
}

/** Plan media from the Scenes section, then step from the storyboard into the media. */
async function planMedia(page) {
  await page.getByRole("button", { name: "Plan media", exact: true }).click();
  await page.getByRole("button", { name: "Edit media", exact: true }).click();
}

/** Switching sections unmounts the pane, so its disclosures reopen each time. */
async function openManifest(page) {
  await openSection(page, "Specification");
  const summary = page.getByText("Advanced: asset manifest JSON", { exact: true });
  // The disclosure keeps its state across sections, so only open it when it is shut.
  if (
    !(await page
      .locator("details", { has: summary })
      .first()
      .evaluate((d) => d.open))
  )
    await summary.click();
}

async function create(page, { activityType = "standard" } = {}) {
  await page.goto(`${origin}/activities`);
  // Creation lives behind the landing's action, not inline on the page.
  await page.getByRole("button", { name: "New activity", exact: true }).click();
  await page.getByRole("textbox", { name: "Product code", exact: true }).fill("words");
  await page.getByRole("spinbutton", { name: "Reference number", exact: true }).fill("12");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Sight words");
  if (activityType === "book") {
    await page.getByRole("button", { name: "Activity type", exact: true }).click();
    await page.getByRole("option", { name: "Book", exact: true }).click();
  }
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page
    .getByRole("textbox", { name: "Activity Script", exact: true })
    .fill("Practice common sight words");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toBeEnabled();
  await openSection(page, "Specification");
  await page.getByText("Advanced: specification JSON", { exact: true }).click();
}

test("plans media, preserves unsaved bindings on navigation, and saves paths for assembly", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const plan = page.getByRole("button", { name: "Plan media", exact: true });
  await openSection(page, "Scenes and media");
  await expect(plan).toBeDisabled();
  const withMedia = {
    ...spec,
    scenes: [
      {
        id: "intro",
        description: "Look",
        media: { images: [{ key: "cat", description: "A cat" }] },
      },
    ],
  };
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(withMedia));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await plan.click();
  await openManifest(page);
  const editor = page.getByRole("textbox", { name: /^Asset manifest/ });
  await expect(editor).toBeVisible();
  await expect(page.getByText(/1 assets, 0 paths assigned, 1 unbound/)).toBeVisible();
  const manifest = JSON.parse(await editor.inputValue());
  manifest.assets["en-US"][0].path = "media/images/cat.png";
  await editor.fill(JSON.stringify(manifest));
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Specification");
  await expect(editor).toHaveValue(JSON.stringify(manifest));
  const request = page.waitForRequest(
    (request) => request.url().endsWith("/media") && request.method() === "PUT",
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  expect((await request).postDataJSON().manifest).toEqual(manifest);
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await openManifest(page);
  await expect(editor).toHaveValue(JSON.stringify(manifest, null, 2));
  await expect(page.getByText(/1 assets, 1 paths assigned, 0 unbound/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reviews specification edits against the saved specification before saving", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const editor = page.getByRole("textbox", { name: "Specification JSON", exact: true });
  await openSection(page, "Specification");
  await editor.fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();

  // Nothing edited yet, so there is nothing to review.
  const show = page.getByRole("button", { name: "Show changes", exact: true });
  await expect(show).toBeDisabled();

  const edited = {
    ...spec,
    title: "Sight words, revised",
    scenes: [
      { id: "intro", description: "Choose a different word" },
      { id: "quiz", description: "Answer" },
    ],
  };
  await editor.fill(JSON.stringify(edited, null, 2));
  await show.click();

  // The scenes that moved are named, and both layouts render the same change.
  await expect(page.getByRole("button", { name: /^intro · changed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^quiz · added/ })).toBeVisible();
  await expect(page.getByText("Choose a different word", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  const diff = page.getByLabel("Changes since the last save", { exact: true });
  await expect(diff.getByText("Saved specification", { exact: true })).toBeVisible();
  await expect(diff.getByText("Your edit", { exact: true })).toBeVisible();

  // Reverting is confirmed, and puts the saved specification back in the box.
  await page.getByRole("button", { name: "Revert all changes", exact: true }).click();
  await expect(page.getByText(/Discard every edit/)).toBeVisible();
  await page.getByRole("button", { name: "Revert all changes", exact: true }).last().click();
  await expect(editor).toHaveValue(JSON.stringify(spec, null, 2));
  await expect(page.getByText("No changes since the last save.")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reports speech coverage and generates every missing narration at once", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Three narrations: one already bound, one ready to generate, one still without a script.
  const narration = (key, extra) => ({
    key,
    type: "audio",
    description: `${key} line`,
    usages: [{ sceneId: "intro", sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...extra,
  });
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          narration("greeting", { script: "Hello there", path: "media/audio/greeting.wav" }),
          narration("welcome", { script: "Welcome along" }),
          narration("prompt", { script: "Pick a word" }),
          narration("silent", {}),
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();

  await openSection(page, "Speech coverage");
  await expect(page.getByText("1 of 4 narrations bound")).toBeVisible();
  await expect(page.getByText("2 can be generated now")).toBeVisible();
  await expect(page.getByText(/1 need a script of 1.5000 characters first/)).toBeVisible();

  // The button names the same count the summary does, and asks before spending runs.
  await page.getByRole("button", { name: "Generate 2 missing", exact: true }).click();
  await expect(page.getByText(/Start 2 speech runs for en-US/)).toBeVisible();
  await page.getByRole("button", { name: "Generate 2 missing", exact: true }).last().click();

  // The server runs one generation per activity, so the queue waits rather than
  // firing both at once and having the second refused.
  await expect(page.getByText(/1 narration queued/)).toBeVisible();
  expect(f.audioRequests.map((request) => request.assetKey)).toEqual(["welcome"]);
  expect(f.audioRequests.every((request) => request.language === "en-US")).toBe(true);
  expect(f.audioRequests.every((request) => request.voice === "Kore")).toBe(true);

  // Once the first run finishes, the next narration is asked for.
  f.finishAudio();
  await expect
    .poll(() => f.audioRequests.map((request) => request.assetKey))
    .toEqual(["welcome", "prompt"]);
  await expect(page.getByRole("button", { name: "Stop queue", exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("uploads media into the activity workspace and binds it from the library", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);

  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await expect(binding).toHaveValue("");
  await openSection(page, "Description");
  await expect(page.getByText("Read from the WAF checkout.")).toHaveCount(0);

  // Uploading binds the asset to the stored reference the server chose.
  await openSection(page, "Scenes and media");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: PIXEL });
  await expect(binding).toHaveValue(/^media\/uploads\/cat-[a-f0-9]{8}\.png$/);
  await expect(page.getByText("Stored with this activity.")).toBeVisible();

  // Clearing and rebinding from the library reaches the same file.
  await page.getByRole("button", { name: "Clear media path", exact: true }).click();
  await expect(binding).toHaveValue("");
  await page.getByRole("button", { name: "Choose from media library", exact: true }).click();
  await expect(page.getByText("Choose a file to see it here.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search by file name", exact: true }).fill("zebra");
  await expect(page.getByText("No uploaded file matches this search.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search by file name", exact: true }).fill("cat");
  await page.getByRole("button", { name: /^cat\.png/ }).click();
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use this file", exact: true }).click();
  await expect(binding).toHaveValue(/^media\/uploads\/cat-[a-f0-9]{8}\.png$/);
  await expect(page.getByText("Stored with this activity.")).toBeVisible();

  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await openSection(page, "Specification");
  await expect(page.getByText(/1 assets, 1 paths assigned, 0 unbound/)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("previews only saved images and resets previews across edits, checkout changes and failures", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await expect(page.getByText("Assign and save a media path to preview this image.")).toBeVisible();
  const binding = page.getByRole("textbox", { name: /^Media path/ });
  await binding.fill("media/images/cat.png");
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.imageRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByRole("img", { name: "A cat", exact: true })).toBeVisible();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  expect(f.imageRequests[0]).toMatchObject({
    language: "en-US",
    assetKey: "cat",
    wafRoot: "C:/WAF checkout",
  });
  expect(f.imageRequests[0].expectedRevision).toBeTruthy();
  await expect(page.getByRole("link", { name: "Open full-size image" })).toHaveAttribute(
    "href",
    /media-image\?/,
  );
  await binding.fill("media/images/different.png");
  await expect(page.getByRole("img", { name: "A cat", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Save or reload the draft before previewing its saved image."),
  ).toBeVisible();
  expect(f.imageRequests).toHaveLength(1);
  await binding.fill("media/images/cat.png");
  await openSection(page, "Module preview");
  await page.getByRole("textbox", { name: /^WAF checkout/ }).fill("C:/Other WAF");
  f.setImageFailure(true);
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(page.getByText(/^Image unavailable\./)).toBeVisible();
  f.setImageFailure(false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("1 × 1 pixels", { exact: true })).toBeVisible();
  expect(f.imageRequests.at(-1).wafRoot).toBe("C:/Other WAF");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  f.member();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preview image", exact: true })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("assembles a saved spec and links to the Harness-isolated WAF preview", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const assemble = page.getByRole("button", { name: "Assemble WAF module", exact: true });
  // Nothing to assemble from yet, so the Build stage is not open to choose.
  await expect(
    page.getByRole("treeitem", { name: "Module Definition", exact: true, level: 1 }),
  ).toHaveAttribute("aria-disabled", "true");
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Module preview");
  await expect(assemble).toBeEnabled();
  await expect(page.getByRole("textbox", { name: /^WAF checkout/ })).toHaveValue("C:/WAF checkout");
  const sent = page.waitForRequest((request) => request.url().endsWith("/assemble-module"));
  await assemble.click();
  const payload = (await sent).postDataJSON();
  expect(payload).toMatchObject({
    wafRoot: "C:/WAF checkout",
    agentId: "default_agent",
  });
  expect(payload).not.toHaveProperty("bookMode");
  await openSection(page, "Generation history");
  await expect(page.getByText("Module assembly", { exact: true })).toBeVisible();
  f.complete();
  await page.reload();
  await openSection(page, "Module preview");
  await expect(
    page.getByRole("link", { name: "Open WAF preview", exact: true }).first(),
  ).toHaveAttribute(
    "href",
    "/api/sessions/session_test/files/preview-redirect?path=preview%2Findex.html",
  );
  await openSection(page, "Generation history");
  await page.getByText("View candidate JSON", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy candidate into editor", exact: true }),
  ).toHaveCount(0);
  await openSection(page, "Description");
  await page.getByRole("textbox", { name: "Activity Script", exact: true }).fill("A new revision");
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  // The runs list and the embedded preview both carry the staleness notice.
  await openSection(page, "Module preview");
  await expect(
    page.getByText("Built from an earlier draft", { exact: true }).first(),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("requires an explicit reading mode for book assembly and sends it per run", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page, { activityType: "book" });
  await openSection(page, "Specification");
  await page.getByRole("textbox", { name: "Specification JSON", exact: true }).fill(
    JSON.stringify({
      ...spec,
      scenes: [
        {
          id: "story",
          role: "story",
          description: "A penguin story",
          media: { images: [{ key: "cover", description: "A penguin walking" }] },
        },
      ],
    }),
  );
  await openSection(page, "Specification");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  const assemble = page.getByRole("button", { name: "Assemble WAF module", exact: true });
  await openSection(page, "Module preview");
  await expect(assemble).toBeDisabled();
  const readingMode = page.getByRole("button", { name: "Reading mode", exact: true });
  await expect(readingMode).toHaveText("Choose a reading mode");
  await readingMode.scrollIntoViewIfNeeded();
  await readingMode.click();
  await page.getByRole("option", { name: "Read-along", exact: true }).click();
  await expect(assemble).toBeDisabled();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openSection(page, "Module preview");
  await expect(assemble).toBeEnabled();
  await expect(page.getByText("Validated", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/assemble-module") && request.method() === "POST",
  );
  await assemble.click();
  expect((await sent).postDataJSON()).toMatchObject({
    agentId: "default_agent",
    bookMode: "readAlong",
  });
  expect(f.assembleRequests).toEqual([expect.objectContaining({ bookMode: "readAlong" })]);
  expect(f.errors).toEqual([]);
});

test("edits scripts and explicitly accepts speech while regeneration keeps the accepted player", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "welcome",
          type: "audio",
          description: "Greeting",
          script: "Hello",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("textbox", { name: /^Speech script/ }).fill("Hello there");
  await expect(page.getByRole("button", { name: "Generate speech", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Speech script/ })).toHaveValue("Hello there");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Generate speech", exact: true }).click();
  f.completeAudio();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.locator('audio[aria-label="Accepted audio"]')).toHaveCount(0);
  await expect(page.locator('audio[aria-label="Speech candidate"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Accept this audio", exact: true }).click();
  const accepted = page.locator('audio[aria-label="Accepted audio"]');
  const source = await accepted.getAttribute("src");
  await page.getByRole("button", { name: "Regenerate speech", exact: true }).click();
  await expect(accepted).toHaveAttribute("src", source);
  f.completeAudio();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(accepted).toHaveAttribute("src", source);
  await expect(page.locator('audio[aria-label="Speech candidate"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Accept this audio", exact: true })).toBeEnabled();
  expect(f.errors).toEqual([]);
});

test("edits image descriptions and explicitly accepts images while failed regeneration preserves the accepted image", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A friendly orange cat",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const description = page.getByRole("textbox", { name: /^Image description/ });
  await openSection(page, "Scenes and media");
  await description.fill("A friendly orange cat wearing a blue scarf");
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("button", { name: "Generate image", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Scenes and media");
  await expect(description).toHaveValue("A friendly orange cat wearing a blue scarf");
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const generated = page.waitForRequest(
    (request) => request.url().endsWith("/generate-image") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  expect((await generated).postDataJSON()).toMatchObject({
    agentId: "default_agent",
    expectedRevision: expect.any(String),
    language: "en-US",
    assetKey: "cat",
  });
  f.completeImage();
  await page.reload();
  const candidates = page.getByRole("region", { name: "Image candidates", exact: true });
  await openSection(page, "Scenes and media");
  await expect(candidates).toBeVisible();
  await openSection(page, "Scenes and media");
  await candidates.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(
    candidates.getByRole("img", { name: "A friendly orange cat wearing a blue scarf" }),
  ).toBeVisible();
  expect(f.imageCandidateReads).toBe(1);
  await candidates.getByRole("button", { name: "Accept this image", exact: true }).click();
  const acceptedPath = page.getByRole("textbox", { name: /^Media path/ });
  await openSection(page, "Scenes and media");
  await expect(acceptedPath).toHaveValue("media/generated/run_image_0.png");
  const accepted = page.getByRole("region", { name: "Accepted image", exact: true });
  await accepted.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(accepted.locator("img")).toBeVisible();
  const acceptedSource = await accepted.locator("img").getAttribute("src");
  await expect(page.getByRole("button", { name: "Regenerate image", exact: true })).toBeVisible();
  f.failImageGeneration();
  await page.getByRole("button", { name: "Regenerate image", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Image generation failed.");
  await expect(acceptedPath).toHaveValue("media/generated/run_image_0.png");
  await expect(accepted.locator("img")).toHaveAttribute("src", acceptedSource);
  f.member();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("button", { name: "Regenerate image", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept this image", exact: true })).toHaveCount(0);
  await accepted.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(accepted.locator("img")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("reviews and accepts an improved image prompt without changing its saved media", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A cat",
          path: "media/images/cat.png",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const description = page.getByRole("textbox", { name: /^Image description/ });
  const improve = page.getByRole("button", { name: "Improve image prompt", exact: true });
  await openSection(page, "Scenes and media");
  await description.fill("Unsaved prompt");
  await openSection(page, "Scenes and media");
  await expect(improve).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await openSection(page, "Scenes and media");
  await expect(description).toHaveValue("Unsaved prompt");
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/generate-media-text") && request.method() === "POST",
  );
  await improve.click();
  expect((await sent).postDataJSON()).toMatchObject({
    agentId: "default_agent",
    expectedRevision: expect.any(String),
    language: "en-US",
    assetKey: "cat",
  });
  f.completeMediaText("A friendly orange cat wearing a blue scarf");
  await page.reload();
  await openSection(page, "Scenes and media");
  const suggestions = page.getByRole("region", { name: "Text suggestions", exact: true });
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole("button", { name: "Review text", exact: true }).click();
  await expect(suggestions).toContainText("Unsaved prompt");
  await expect(suggestions).toContainText("A friendly orange cat wearing a blue scarf");
  expect(f.mediaTextCandidateReads).toBe(1);
  await suggestions.getByRole("button", { name: "Use this text", exact: true }).click();
  await expect(description).toHaveValue("A friendly orange cat wearing a blue scarf");
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/images/cat.png",
  );
  expect(f.errors).toEqual([]);
});

test("reviews narration suggestions, preserves existing audio provenance, and blocks stale acceptance", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "welcome",
          type: "audio",
          description: "Greeting",
          script: "Hello",
          path: "media/generated/run_audio_accepted.wav",
          generatedAudio: { runId: "run_audio_accepted", sha256: "test" },
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  const improve = page.getByRole("button", { name: "Improve narration script", exact: true });
  await improve.click();
  f.completeMediaText("Hello there, sight word friends.");
  await page.reload();
  await openSection(page, "Scenes and media");
  const suggestions = page.getByRole("region", { name: "Text suggestions", exact: true });
  await suggestions.getByRole("button", { name: "Review text", exact: true }).click();
  await expect(suggestions).toContainText("Hello");
  await expect(suggestions).toContainText("Hello there, sight word friends.");
  await suggestions.getByRole("button", { name: "Use this text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Speech script/ })).toHaveValue(
    "Hello there, sight word friends.",
  );
  await expect(page.getByRole("textbox", { name: /^Media path/ })).toHaveValue(
    "media/generated/run_audio_accepted.wav",
  );

  const regenerate = page.getByRole("button", { name: "Improve narration script", exact: true });
  await regenerate.click();
  f.completeMediaText("A conflicting narration candidate.");
  f.conflictMediaText("A conflicting narration candidate.");
  await page.reload();
  await openSection(page, "Scenes and media");
  const conflicted = page.getByRole("region", { name: "Text suggestions", exact: true });
  await conflicted.getByRole("button", { name: "Review text", exact: true }).first().click();
  await expect(conflicted).toContainText("A conflicting narration candidate.");
  await expect(conflicted.getByRole("button", { name: "Use this text", exact: true })).toHaveCount(
    0,
  );
  expect(f.errors).toEqual([]);
});

test("members cannot edit media text", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(
    JSON.stringify({
      productCode: "words",
      refNum: 12,
      assets: {
        "en-US": [
          {
            key: "cat",
            type: "image",
            description: "A cat",
            usages: [{ sceneId: "intro" }],
          },
        ],
      },
    }),
  );
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  f.member();
  await page.reload();
  await openSection(page, "Scenes and media");
  await expect(page.getByRole("textbox", { name: /^Image description/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Improve image prompt", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Improve narration script", exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("image candidates from a conflicting run remain view-only", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Scenes and media");
  await planMedia(page);
  await openManifest(page);
  const manifest = {
    productCode: "words",
    refNum: 12,
    assets: {
      "en-US": [
        {
          key: "cat",
          type: "image",
          description: "A cat",
          usages: [{ sceneId: "intro" }],
        },
      ],
    },
  };
  await page.getByRole("textbox", { name: /^Asset manifest/ }).fill(JSON.stringify(manifest));
  await openSection(page, "Scenes and media");
  await page.getByRole("button", { name: "Validate and save media", exact: true }).click();
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  f.conflict();
  await page.reload();
  const candidates = page.getByRole("region", { name: "Image candidates", exact: true });
  await openSection(page, "Scenes and media");
  await expect(candidates).toBeVisible();
  await expect(
    candidates.getByRole("button", { name: "Accept this image", exact: true }),
  ).toHaveCount(0);
  await openSection(page, "Scenes and media");
  await candidates.getByRole("button", { name: "Preview image", exact: true }).click();
  await expect(candidates.locator("img")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("create, save, generate, leave and reopen a completed specification", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await openSection(page, "Generation history");
  await expect(page.getByRole("link", { name: "Open Session / approvals" })).toHaveAttribute(
    "href",
    "/chat/session_test",
  );
  await page.reload();
  await openSection(page, "Generation history");
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  f.complete();
  await openSection(page, "Specification");
  await page.getByText("Advanced: specification JSON", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Specification JSON", exact: true })).toHaveValue(
    JSON.stringify(spec, null, 2),
  );
  await page.reload();
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Practice common sight words",
  );
  await openSection(page, "Generation history");
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("polling preserves unsaved edits and exposes conflicting output for review", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await openSection(page, "Generation history");
  await expect(page.getByRole("button", { name: "Cancel generation" })).toBeVisible();
  await openSection(page, "Description");
  await page.getByRole("textbox", { name: "Activity Script", exact: true }).fill("My unsaved edit");
  f.conflict();
  await openSection(page, "Generation history");
  await expect(
    page.getByText("Draft changed — candidate preserved", { exact: true }),
  ).toBeVisible();
  await openSection(page, "Description");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "My unsaved edit",
  );
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "My unsaved edit",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveText(
    "Changed in another tab",
  );
  await openSection(page, "Generation history");
  await page.getByText("View candidate JSON", { exact: true }).click();
  await page.getByRole("button", { name: "Copy candidate into editor" }).click();
  await openSection(page, "Specification");
  await page.getByRole("button", { name: "Validate and save" }).click();
  await expect(page.getByText("Validated", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("member view is read-only and mobile layout does not overflow", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  f.member();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Only the Project owner can edit activities.")).toBeVisible();
  // Too narrow to hold a rail beside the work, so the rail starts shut and the editor
  // keeps the width rather than being squeezed into a sliver beside a menu.
  await expect(page.locator('nav[aria-label="Activity hierarchy"]')).toHaveCount(0);
  await openSection(page, "Description");
  // Choosing a section hands the workspace back instead of leaving the menu over it.
  await expect(page.locator('nav[aria-label="Activity hierarchy"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Activity Script", exact: true })).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Opening the rail here is a temporary answer to having no room for both, so a wider
  // window and back must not leave it covering the editor again. The emulated viewport
  // change does not notify the page the way a real window resize does, so the
  // notification is sent by hand.
  const sections = page.locator('nav[aria-label="Activity hierarchy"]');
  const resize = async (width) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  };
  await page.getByRole("button", { name: "Expand the activity rail", exact: true }).click();
  await expect(sections).toHaveCount(1);
  await resize(1280);
  await expect(sections).toHaveCount(1);
  await resize(390);
  await expect(sections).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("dirty drafts block sidebar, Session, browser back, and project switches", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this edit");
  let prompts = 0;
  const decline = (dialog) => {
    prompts++;
    return dialog.dismiss();
  };
  page.on("dialog", decline);
  await openSection(page, "Generation history");
  await page.getByRole("link", { name: "Open Session / approvals" }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await page.goBack();
  await expect(page).toHaveURL(/activities\/act_test$/);
  await openSection(page, "Description");
  await expect(description).toHaveText("Keep this edit");
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activities test", exact: true })).toBeVisible();
  await expect(description).toHaveText("Keep this edit");
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).not.toBe(
    "second-project",
  );
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  expect(prompts).toBe(4);
  page.off("dialog", decline);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/activities$/);
  await page.getByRole("link", { name: /Sight words/ }).click();
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Another edit");
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Second project", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("penguin.lastProjectId"))).toBe(
    "second-project",
  );
  await expect
    .poll(() => f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project"))
    .toBe(true);
  expect(f.errors).toEqual([]);
});

test("idle history polls slowly and candidate text is fetched only on expansion", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const reads = f.historyReads;
  await page.waitForTimeout(2500);
  expect(f.historyReads).toBe(reads);
  await openSection(page, "Description");
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await expect.poll(() => f.historyReads).toBeGreaterThan(reads);
  f.complete();
  f.secondCandidate();
  await openSection(page, "Generation history");
  await expect(page.getByText("Applied", { exact: true })).toHaveCount(2);
  expect(f.candidateReads).toBe(0);
  const candidates = page.getByText("View candidate JSON", { exact: true });
  const release = f.holdFirstCandidate();
  f.failSecondCandidate();
  await candidates.nth(0).click();
  await candidates.nth(1).click();
  await expect(page.getByRole("alert")).toContainText("Candidate temporarily unavailable.");
  const reviews = page
    .locator("details")
    .filter({ has: page.getByText("View candidate JSON", { exact: true }) });
  await reviews.nth(1).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(reviews.nth(1).locator("pre")).toContainText('"title":"Second candidate"');
  await expect(reviews.nth(0).locator("pre")).toContainText("Loading");
  release();
  await expect(page.locator("details pre").nth(0)).toContainText('"title":"Sight words"');
  await expect(page.locator("details pre").nth(1)).toContainText('"title":"Second candidate"');
  expect(f.candidateReads).toBe(3);
  await candidates.nth(0).click();
  await candidates.nth(0).click();
  expect(f.candidateReads).toBe(3);
  const settledReads = f.historyReads;
  await page.waitForTimeout(2500);
  expect(f.historyReads).toBe(settledReads);
  expect(f.errors).toEqual([]);
});

test("polling errors recover without clearing a save conflict or unsaved edits", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  f.failHistory();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("The server hit an internal error");
  await page.clock.fastForward(30_000);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Description");
  await expect(description).toHaveText("Practice common sight words");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep this unsaved edit");
  f.changeSavedDescription();
  await page.getByRole("button", { name: "Save script", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  f.failHistory();
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("alert")).toHaveCount(2);
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("Draft changed");
  await expect(description).toHaveText("Keep this unsaved edit");
  expect(f.errors).toEqual([]);
});

test("collapsed rail keeps Activities reachable through the page manifest", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const activities = page.getByRole("link", { name: "Activities", exact: true });
  await expect(activities).toBeVisible();
  await activities.click();
  await expect(page).toHaveURL(/\/activities$/);
  expect(f.errors).toEqual([]);
});

async function projectSettings(page) {
  await page.getByRole("button", { name: "Activities test", exact: true }).click();
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Project settings", exact: true });
}

test("canceling the dirty-editor guard prevents Project deletion and remount", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Keep before deletion");
  const original = await description.elementHandle();
  const settings = await projectSettings(page);
  await settings.getByRole("button", { name: "Delete", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("dialog", { name: "Delete Project", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Delete Project", exact: true })).toHaveCount(0);
  expect(f.deletedProjects).toBe(0);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(description).toHaveText("Keep before deletion");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("declining a refresh fallback preserves detached text without retaining Project access", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  const description = page.getByRole("textbox", { name: "Activity Script", exact: true });
  await openSection(page, "Scenes and media");
  await openSection(page, "Description");
  await description.fill("Copy this before leaving");
  const original = await description.elementHandle();
  const settings = await projectSettings(page);
  await settings.getByRole("textbox").fill("Refresh the project list");
  f.removeProject();
  page.once("dialog", (dialog) => dialog.dismiss());
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("This Project is no longer available.", { exact: false }),
  ).toBeVisible();
  await expect(description).toHaveText("Copy this before leaving");
  await expect(description).toBeEnabled();
  await expect(description).toHaveAttribute("aria-readonly", "true");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  await expect(page.getByRole("button", { name: "Save script", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate specification", exact: true }),
  ).toHaveCount(0);
  const requests = f.activityRequests;
  await page.clock.fastForward(60_000);
  expect(f.activityRequests).toBe(requests);
  expect(f.prefsWrites.some((prefs) => prefs.lastProjectId === "second-project")).toBe(false);
  await page.getByRole("button", { name: "Select a Project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activities test owner", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(description).toHaveText("Copy this before leaving");
  expect(await description.evaluate((element, before) => element === before, original)).toBe(true);
  await page.getByRole("button", { name: "Select a Project", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Second project owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Second project", exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("the script editor folds scenes, diffs against the last save and shows an agent's proposal", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await openSection(page, "Description");
  const script = [
    "Description",
    "",
    "Scene 1: Intro",
    "<video>An island.</video>",
    "Scene 2: Rocks",
    "The narrator says <audio>Find d.</audio>",
  ].join("\n");
  const box = page.getByRole("textbox", { name: "Activity Script", exact: true });
  const save = page.getByRole("button", { name: "Save script", exact: true });
  await box.fill(script);
  await save.click();
  await expect(save).toBeDisabled();
  await expect(box.locator(".cm-media-tag").first()).toHaveText("<video>");

  // Scenes fold to their headings and open again.
  const scenes = page.getByRole("button", { name: "Scenes", exact: true });
  await scenes.click();
  await expect(box).not.toContainText("An island.");
  await expect(box).toContainText("Scene 2: Rocks");
  await scenes.click();
  await expect(box).toContainText("An island.");

  // An edit reads against the last save, names its scene, and reverts where it stands.
  await box.fill(script.replace("Find d.", "Find lowercase d."));
  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByRole("option", { name: "Diff: Since last save", exact: true }).click();
  await expect(page.getByText("+1 −1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scene 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to the change at line 6" })).toBeVisible();
  await page.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(page.getByText("No changes", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  // A conversation's proposal marks the scenes it changes and reads as a diff until accepted.
  const proposed = script.replace("Scene 1: Intro", "Scene 1: Welcome");
  await page.route("**/*", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === `${base}/act_test/runs`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          runs: [
            {
              kind: "assist",
              inputRevision: "1",
              runId: "run_assist",
              activityId: "act_test",
              projectId,
              sessionId: "session_assist",
              status: "succeeded",
              createdAt: "2026-09-19T11:00:00Z",
              hasCandidate: false,
              error: null,
            },
          ],
        }),
      });
    if (p === `${base}/act_test/runs/run_assist/proposal`)
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          proposal: {
            summary: "A warmer opening",
            changes: [{ target: "description", text: proposed }],
          },
          error: null,
        }),
      });
    return route.fallback();
  });
  await page.reload();
  await openSection(page, "Description");
  await expect(box.locator(".cm-proposed-hint")).toHaveText("proposed, not applied");
  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByRole("option", { name: "Diff: Agent proposal", exact: true }).click();
  await expect(
    page.getByText("This is the agent's proposed script", { exact: false }),
  ).toBeVisible();
  await expect(box).toContainText("Scene 1: Welcome");
  await expect(box).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Accept the proposed script", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept the proposed script" })).toHaveCount(0);
  await expect(box).toHaveAttribute("contenteditable", "true");
  await expect(box).toContainText("Scene 1: Welcome");
  await expect(box.locator(".cm-proposed-hint")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("runs every stage from the hierarchy and follows the run in its panel", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const posts = [];
  let reads = 0;
  const steps = (statuses) =>
    ["spec", "media", "speech", "images", "module"].map((step, index) => ({
      step,
      status: statuses[index],
      detail: step === "images" && statuses[index] === "skipped" ? "No image is missing." : null,
      done: step === "speech" ? 2 : 0,
      total: step === "speech" ? 2 : 0,
      runIds: [],
    }));
  const state = (status, statuses, error = null) => ({
    pipelineId: "pipeline_1",
    projectId,
    activityId: "act_test",
    selection: "all",
    status,
    steps: steps(statuses),
    currentRunId: null,
    currentSessionId: null,
    error,
    startedAt: "2026-09-23T12:00:00Z",
    finishedAt: status === "running" ? null : "2026-09-23T12:05:00Z",
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    if (p !== `${base}/act_test/pipeline`) return route.fallback();
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (request.method() === "POST") {
      posts.push(request.postDataJSON());
      return json(state("running", ["running", "pending", "pending", "pending", "pending"]), 202);
    }
    reads++;
    if (!posts.length) return json({ pipeline: null });
    return json({
      pipeline: state("succeeded", ["succeeded", "succeeded", "succeeded", "skipped", "succeeded"]),
    });
  });
  await page.reload();
  const stage = page.getByRole("button", { name: "Stage", exact: true });
  await expect(stage).toContainText("All stages");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ stage: "all", agentId: "default_agent" });
  const panel = page.getByRole("complementary", { name: "Stages", exact: true });
  await expect(panel).toBeVisible();
  // The page keeps reading the run while it is in flight, and shows how it ended.
  await expect(panel.getByText("All chosen stages finished.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Generate speech", { exact: true })).toBeVisible();
  await expect(panel.getByText("No image is missing.", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(0);

  // One stage on its own is the same control.
  await stage.click();
  await page.getByRole("option", { name: "Generate images", exact: true }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ stage: "images" });
  expect(f.errors).toEqual([]);
});

test("the storyboard shows every scene, and walks into its media scene by scene", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const withScenes = {
    ...spec,
    scenes: [
      {
        id: "intro",
        description: "An island appears.",
        media: { images: [{ key: "island", description: "An island" }] },
      },
      { id: "quiet", description: "A pause with no media." },
      {
        id: "rocks",
        description: "Find the letter d.",
        media: { images: [{ key: "rock", description: "A rock" }] },
      },
    ],
  };
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(withScenes));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  // This fixture plans media from a manifest the request carries, so plan this spec's.
  const asset = (key, sceneId) => ({
    key,
    type: "image",
    description: key,
    usages: [{ sceneId, sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });
  await page.route(`**${base}/act_test/plan-media`, (route) =>
    route.fallback({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: { "en-US": [asset("island", "intro"), asset("rock", "rocks")] },
        },
      }),
    }),
  );
  await openSection(page, "Scenes and media");
  await planMedia(page);

  // Scenes opens on the board: one frame per scene, in order, marked while media is missing.
  await page.getByRole("treeitem", { name: "Scenes", exact: true, level: 1 }).click();
  await expect(page.getByRole("heading", { name: "Storyboard", exact: true })).toBeVisible();
  await expect(page.getByText("3 scenes", { exact: true })).toBeVisible();
  const intro = page.getByRole("button", { name: "Scene 1, intro. 1 without media" });
  await expect(page.getByRole("button", { name: "Scene 2, quiet", exact: true })).toBeVisible();
  await intro.click();
  await expect(intro).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Scene 1, intro", exact: true })).toBeVisible();

  // Opening a scene opens its media, and the editor steps over the scene with none.
  await page.getByRole("button", { name: /^island/ }).click();
  await expect(page.getByRole("heading", { name: "island", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next scene: Scene 3, rocks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "rock", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page
    .getByRole("navigation", { name: "Storyboard" })
    .getByRole("button", {
      name: "Storyboard",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Scene 3, rocks. 1 without media" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(f.errors).toEqual([]);
});

test("the script saves itself after a pause, and waits while a run is in flight", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.clock.install();
  await openSection(page, "Description");
  const box = page.getByRole("textbox", { name: "Activity Script", exact: true });
  const saves = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`${base}/act_test/description`)) saves.push(request.postDataJSON());
  });
  await box.fill("Scene 1: Intro");
  await expect(page.getByText("Unsaved, saves in a moment", { exact: true })).toBeVisible();
  await page.clock.fastForward(5_500);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  expect(saves.map((body) => body.description)).toEqual(["Scene 1: Intro"]);

  // A run moves the draft, so the script holds its edits until the run ends.
  await page.getByRole("button", { name: "Generate specification", exact: true }).click();
  await box.fill("Scene 1: Welcome");
  await expect(
    page.getByText("Unsaved, saves when the running work ends", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(10_000);
  expect(saves).toHaveLength(1);
  await expect(box).toHaveText("Scene 1: Welcome");
  expect(f.errors).toEqual([]);
});

test("the player draws the module's behavior map and follows the phase it reports", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  const machine = {
    version: "1.1",
    id: "letters",
    initial: "rocks",
    states: {
      rocks: {
        initial: "prompt",
        states: {
          prompt: { invoke: { src: "say", onDone: "waiting" } },
          waiting: { on: { CORRECT: "correct", WRONG: "retry" } },
          retry: { invoke: { src: "say", onDone: "waiting" } },
          correct: { invoke: { src: "chest", onDone: "#next" } },
        },
      },
    },
  };
  // A stand-in for the played module: it reports its state the way the real bridge does.
  const playerPage = `<!doctype html><body><script>
    setInterval(() => parent.postMessage({
      type: "penguin-sandbox:activity-state",
      detail: { index: 1, phase: "waiting", sceneId: "rocks", state: "rocks.waiting" },
      interactables: [],
    }, "*"), 100);
  </script></body>`;
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/sandbox/payload`)
      return json({ configuration: { stateMachine: machine } });
    if (p === `${base}/act_test/sandbox/play`)
      return route.fulfill({ contentType: "text/html", body: playerPage });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify({ ...spec, scenes: [{ id: "rocks", description: "Find d" }] }));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.getByRole("button", { name: "Player", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Player", exact: true });
  await panel.getByRole("button", { name: "Play", exact: true }).click();

  const map = panel.getByRole("img", { name: "Behavior of rocks", exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator('[aria-current="step"]')).toContainText("waiting");
  await expect(panel.getByText("correct, on done, to next", { exact: true })).toBeVisible();

  const toggle = panel.getByRole("button", { name: "Behavior map", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(map).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("the Build stage lists what stands between the draft and a module", async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  const asked = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== `${base}/act_test/readiness`) return route.fallback();
    asked.push(url.searchParams.get("wafRoot"));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        checks: [
          { id: "spec", level: "ok" },
          { id: "plan", level: "fail", state: "stale" },
          { id: "speech", level: "warn", language: "en-US", bound: 3, total: 5 },
          { id: "coverage", level: "warn", language: "es-MX", covered: 4, total: 5 },
          { id: "checkout", level: "ok", found: true },
        ],
      }),
    });
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openSection(page, "Module preview");
  const checks = page.getByRole("list", { name: "Build", exact: true });
  await expect(
    checks.getByText("The media plan is older than the specification. Rebuild it in Scenes."),
  ).toBeVisible();
  await expect(checks.getByText("Speech in en-US: 3 of 5 bound.")).toBeVisible();
  await expect(
    checks.getByText("es-MX has 4 of 5 narrations of the default language."),
  ).toBeVisible();
  await expect(checks.getByRole("img", { name: "Blocks assembly" })).toHaveCount(1);
  // Assembly would be refused on a stale plan, so it is not offered.
  await expect(
    page.getByRole("button", { name: "Assemble WAF module", exact: true }),
  ).toBeDisabled();
  await expect(checks.getByText("No unsaved edits.")).toBeVisible();
  await expect(page.getByText("This activity has not been assembled yet.")).toBeVisible();
  // The checkout an author types is the one checked.
  await page.getByRole("textbox", { name: /^WAF checkout/ }).fill("D:/waf");
  await expect.poll(() => asked.at(-1)).toBe("D:/waf");
  expect(f.errors).toEqual([]);
});

test("shows the module's configuration and assessment, read-only, as Loom's documents", async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.route("**/*", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (value) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (p === `${base}/act_test/sandbox/status`)
      return json({
        state: "ready",
        playable: true,
        buildable: true,
        message: "Ready.",
        buildLog: null,
      });
    if (p === `${base}/act_test/module-documents`)
      return json({
        source: "checkout",
        configuration: { file: "configurations/words-12.json", value: { maxRounds: 3 } },
        assessment: {
          file: "assessments/words-12.json",
          value: { items: [{ id: "q1" }, { id: "q2" }] },
        },
      });
    return route.fallback();
  });
  await openSection(page, "Specification");
  await page
    .getByRole("textbox", { name: "Specification JSON", exact: true })
    .fill(JSON.stringify(spec));
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.reload();
  await openSection(page, "Configuration Data");
  await expect(
    page.getByText("configurations/words-12.json, from the module in the WAF checkout."),
  ).toBeVisible();
  await expect(page.getByText('"maxRounds": 3')).toBeVisible();
  await openSection(page, "Assessment Data");
  await expect(
    page.getByText("assessments/words-12.json, from the module in the WAF checkout. 2 items."),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: "Implementation Features", exact: true, level: 1 }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(f.errors).toEqual([]);
});
