/**
 * Playing an imported Loom activity, over HTTP.
 *
 * An author asks the API to play an activity and is sent to Loom's dev-sandbox address on
 * the sandbox origin, `/player.html?module=…&ref=…`; everything the learner runtime then
 * fetches -- its configuration, the module's files, the media, the assessment -- hangs off the
 * activity's play key. What this proves is the whole path from a checkout on disk to the
 * payload a runtime would load, that the link is the same every time, as Loom's are, and that
 * off the sandbox host the page only runs sandboxed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activitySpec, createCheckoutActivity } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout holding one Loom product whose module Loom finished generating. */
async function checkout(options: { usesAssessment?: boolean } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-play-"));
  await write(path.join(root, "framework", "package.json"), { version: "9.9.9" });
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await write(path.join(root, "framework", "res", "common", "css", "style.css"), "body{}");
  await write(path.join(root, "media", "loom", CODE, "intro.mp3"), "intro sound");

  const spec = {
    ...activitySpec,
    runtime: { ...activitySpec.runtime, usesAssessment: options.usesAssessment ?? false },
  };
  const product = path.join(root, "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    title: "Sight Words",
    canonicalRefNum: 1,
    activityType: "standard",
    moduleFolder: FOLDER,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  await write(path.join(ref, "activity_metadata.json"), { refNum: 1, title: "Sight Words 1" });
  await write(path.join(ref, "activity_spec.json"), spec);
  await write(path.join(ref, "asset_manifest.json"), { assets: { "en-US": [] } });
  await write(path.join(ref, "activity_description.txt"), "Ref 1");

  const module = path.join(root, "modules", FOLDER);
  await write(path.join(module, "definition.json"), {
    id: "sightWords",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
    },
    themes: { park: { assets: {}, properties: {} } },
  });
  await write(path.join(module, "package.json"), { version: "1.0.0" });
  await write(path.join(module, "res", "layout.html"), "<div>layout</div>");
  await write(path.join(module, "configurations", `${CODE}-1.json`), {
    sightWords: { intro: "{{MEDIA}}/loom/sight-words/intro.mp3" },
  });
  await write(path.join(module, "assessments", `${CODE}-1.json`), {
    configuration: { nextItemsSize: 1 },
    items: [{ title: "first", configuration: { simpleChoice: [] } }, { title: "second" }],
  });
  return root;
}

describe("playing an imported activity", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    // Last in, first out: a second setup restores the WAF_ROOT_DIR the first one set, and the
    // first one's cleanup then restores what was there before either.
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup(options: Parameters<typeof checkout>[0] = {}) {
    const root = await checkout(options);
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = root;
    const t = await createTestApp();
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });
    const owner = await provisionUser(t.app, "play_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "play_owner-play";
    await client.post("/api/projects", { projectId, name: "Play" });
    const activityId = await createCheckoutActivity(client, projectId, root, CODE);

    const redirect = await client.get(
      `/api/projects/${projectId}/activities/${activityId}/sandbox/play?language=en-US`,
    );
    const location = new URL(redirect.headers.get("location")!);
    const base = `/preview/activity/${projectId}~${activityId}/`;
    /** A request on the preview host, with no cookie at all. */
    const onPreview = (pathname: string, init: RequestInit = {}) =>
      t.app.request(new URL(pathname, location.origin).toString(), {
        ...init,
        headers: { host: location.host, ...(init.headers ?? {}) },
      });
    return { t, client, redirect, location, base, onPreview, projectId, activityId };
  }

  it("sends an author to Loom's dev-sandbox address on the sandbox origin", async () => {
    const { redirect, location, client, projectId, activityId } = await setup();
    expect(redirect.status).toBe(302);
    expect(location.hostname).toBe("127.0.0.1");
    expect(location.pathname).toBe("/player.html");
    // Named as Loom names it; the older `language` is carried on under Loom's name.
    expect(Object.fromEntries(location.searchParams)).toEqual({
      module: CODE,
      ref: "1",
      source: "legacy",
      languageCode: "en-US",
      parent: "http://localhost",
    });
    // The same link every time.
    const again = await client.get(
      `/api/projects/${projectId}/activities/${activityId}/sandbox/play?language=en-US`,
    );
    expect(again.headers.get("location")).toBe(location.toString());
  });

  it("names the App origin that asked as the parent the page reports its state to", async () => {
    const { location } = await setup();
    expect(location.searchParams.get("parent")).toBe("http://localhost");
  });

  it("answers the framework's configuration request with the activity, under the link", async () => {
    const { base, onPreview } = await setup();
    const response = await onPreview(
      `${base}activity/v3/configuration/activities/sightWords/version/1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { attributes: { activity: Record<string, any> } };
    };
    const activity = body.data.attributes.activity;
    expect(activity.layout.compartments.main.require.entry.url).toBe(`${base}module/entry.js`);
    expect(activity.configuration.sightWords.intro).toBe(`${base}media/loom/sight-words/intro.mp3`);
    // No navbar module in this checkout: declared empty, never omitted.
    expect(activity.layout.compartments.navBar).toEqual({ id: "navBar" });
  });

  it("serves the module's files and the checkout's media without a session", async () => {
    const { base, onPreview } = await setup();
    const layout = await onPreview(`${base}module/layout.html`);
    expect(layout.status).toBe(200);
    expect(await layout.text()).toBe("<div>layout</div>");
    const media = await onPreview(`${base}media/loom/sight-words/intro.mp3`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("audio/mpeg");
    expect(await media.text()).toBe("intro sound");
    const css = await onPreview(`${base}css/style.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("does not hand out Loom's authoring files through the module route", async () => {
    const { base, onPreview } = await setup();
    const response = await onPreview(`${base}module/generated/${CODE}/spec/activity_metadata.json`);
    expect(response.status).toBe(400);
  });

  it("serves the page sandboxed anywhere but the preview host, and refuses what is no key", async () => {
    const { base, t, location, onPreview } = await setup();
    const onApp = (pathname: string) =>
      t.app.request(new URL(pathname, "http://localhost").toString(), {
        headers: { host: "localhost" },
      });
    expect((await onApp(`${base}play`)).headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts",
    );
    expect((await onPreview(`${base}play`)).headers.get("content-security-policy")).toBeNull();
    const page = `${location.pathname}${location.search}`;
    expect((await onPreview(page)).headers.get("content-security-policy")).toBeNull();
    // On the App's host, Loom's address sends the visitor to the sandbox origin instead.
    const fromApp = await onApp(page);
    expect(fromApp.status).toBe(302);
    expect(new URL(fromApp.headers.get("location")!).host).toBe(location.host);
    expect((await onApp(`${base}module/layout.html`)).status).toBe(200);
    for (const key of ["forged.token", "only-one-part", "a~b~c~d"])
      expect((await onPreview(`/preview/activity/${key}/module/layout.html`)).status).toBe(404);
  });

  it("allows the sandboxed page's cross-origin requests, which carry no credential", async () => {
    const { base, onPreview } = await setup();
    const preflight = await onPreview(`${base}activity/v3/configuration/activities/x/version/1`, {
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const layout = await onPreview(`${base}module/layout.html`);
    expect(layout.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("shows why there is nothing to play when the module does not build", async () => {
    // The fixture has no webpack anywhere; the page says so with the build's own output.
    const { location, onPreview } = await setup();
    const page = await onPreview(`${location.pathname}${location.search}`);
    expect(page.status).toBe(500);
    expect(await page.text()).toContain("did not build");
  });

  describe("Loom's player.html query", () => {
    /** Where the authenticated entry sends this query, or its refusal. */
    async function play(
      s: Awaited<ReturnType<typeof setup>>,
      query: string,
      at = `/api/projects/${s.projectId}/activities/${s.activityId}/sandbox/play`,
    ) {
      const response = await s.client.get(`${at}?${query}`);
      if (response.status !== 302)
        return { status: response.status, error: ((await response.json()) as any).error };
      const location = new URL(response.headers.get("location")!);
      // Every link names the ref as Loom does and carries the App origin that asked; what is
      // checked here is the rest.
      const named = {
        module: location.searchParams.get("module"),
        ref: location.searchParams.get("ref"),
        source: location.searchParams.get("source"),
      };
      for (const name of ["parent", "module", "ref", "source"]) location.searchParams.delete(name);
      return {
        status: 302,
        named,
        query: Object.fromEntries(location.searchParams),
      };
    }

    it("keeps a listed languageCode, takes any other as the default, and reads `language` too", async () => {
      const s = await setup();
      expect((await play(s, "languageCode=es-MX")).query).toEqual({ languageCode: "es-MX" });
      expect((await play(s, "languageCode=fr-FR")).query).toEqual({ languageCode: "en-US" });
      expect((await play(s, "language=ro-RO")).query).toEqual({ languageCode: "ro-RO" });
      expect((await play(s, "")).query).toEqual({});
      expect((await play(s, "languageCode=")).query).toEqual({});
    });

    it("carries startSceneId, read from `scene` on older links", async () => {
      const s = await setup();
      expect((await play(s, "startSceneId=intro")).query).toEqual({ startSceneId: "intro" });
      expect((await play(s, "scene=outro")).query).toEqual({ startSceneId: "outro" });
    });

    it("carries a resolution of the form WxH, and drops any other", async () => {
      const s = await setup();
      expect((await play(s, "resolution=1024x768")).query).toEqual({ resolution: "1024x768" });
      for (const bad of ["1024", "9x9", "123456x10", "20000x100", "1024x768px"])
        expect((await play(s, `resolution=${bad}`)).query).toEqual({});
    });

    it("refuses a ref that is not a non-negative whole number, as Loom does", async () => {
      const s = await setup();
      for (const bad of ["-1", "1.5", "x"])
        expect(await play(s, `ref=${bad}`)).toMatchObject({
          status: 400,
          error: { code: "play_ref_invalid", message: expect.stringContaining(`"${bad}"`) },
        });
      expect((await play(s, "ref=1")).named).toEqual({ module: CODE, ref: "1", source: "legacy" });
    });

    it("never lets module, ref or source switch the activity a link plays", async () => {
      const s = await setup();
      expect(await play(s, "ref=2")).toMatchObject({
        status: 400,
        error: { code: "play_link_mismatch", message: `This link plays ${CODE} ref 1, not ref 2.` },
      });
      expect(await play(s, "module=other")).toMatchObject({
        status: 400,
        error: { code: "play_link_mismatch" },
      });
      // The product is in the checkout's own modules, Loom's `legacy` root.
      expect((await play(s, `module=${CODE}&ref=1&source=legacy`)).named).toEqual({
        module: CODE,
        ref: "1",
        source: "legacy",
      });
      expect(await play(s, "source=monorepo")).toMatchObject({
        status: 400,
        error: { code: "play_link_mismatch" },
      });
      expect(await play(s, "source=elsewhere")).toMatchObject({
        status: 400,
        error: { code: "play_source_invalid" },
      });
    });

    it("finds the activity a Loom link names by module and ref, in this project", async () => {
      const s = await setup();
      const at = `/api/projects/${s.projectId}/activities/sandbox/play`;
      const found = await play(s, `module=${CODE}&ref=1&languageCode=es-MX`, at);
      expect(found).toMatchObject({
        status: 302,
        named: { module: CODE, ref: "1", source: "legacy" },
        query: { languageCode: "es-MX" },
      });
      expect(await play(s, `module=${CODE}&ref=1&source=legacy`, at)).toMatchObject({
        status: 302,
      });
      expect(await play(s, `module=${CODE}&ref=1&source=monorepo`, at)).toMatchObject({
        status: 404,
        error: { code: "play_source_mismatch" },
      });
      expect(await play(s, `module=${CODE}&ref=7`, at)).toMatchObject({
        status: 404,
        error: { code: "play_ref_not_open" },
      });
      expect(await play(s, `module=${CODE}`, at)).toMatchObject({
        status: 400,
        error: { code: "play_ref_invalid", message: expect.stringContaining("Ref is required") },
      });
      expect(await play(s, "ref=1", at)).toMatchObject({
        status: 400,
        error: { code: "play_module_required" },
      });
    });

    it("refuses under a play key too a query that names another ref", async () => {
      const { base, onPreview } = await setup();
      const page = await onPreview(`${base}play?ref=3`);
      expect(page.status).toBe(400);
      expect(await page.text()).toBe(`This link plays ${CODE} ref 1, not ref 3.`);
      const bad = await onPreview(`${base}play?ref=abc`);
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain('Invalid ref "abc"');
    });

    it("plays the configuration at the resolution the request carries, as Loom does", async () => {
      const { base, onPreview } = await setup();
      const at = `${base}activity/v3/configuration/activities/sightWords/version/1`;
      const resolution = async (query: string) =>
        (
          (await (await onPreview(`${at}${query}`)).json()) as {
            data: { attributes: { activity: { configuration: { resolution: string } } } };
          }
        ).data.attributes.activity.configuration.resolution;
      expect(await resolution("?resolution=1280x720")).toBe("1280x720");
      expect(await resolution("?resolution=huge")).toBe("640x480");
      expect(await resolution("")).toBe("640x480");
    });
  });

  describe("Loom's /player.html address", () => {
    /** What /player.html answers this client with: where it sends them, or the page's words. */
    async function player(get: (url: string) => Response | Promise<Response>, query: string) {
      const response = await get(`/player.html?${query}`);
      if (response.status === 302) {
        const location = new URL(response.headers.get("location")!, "http://localhost");
        location.searchParams.delete("parent");
        return {
          status: 302,
          pathname: location.pathname,
          query: Object.fromEntries(location.searchParams),
        };
      }
      const html = await response.text();
      return { status: response.status, message: /<p id="activity">([^<]*)<\/p>/.exec(html)?.[1] };
    }

    it("sends a Loom link on the App's host to the same address on the sandbox origin", async () => {
      const s = await setup();
      const sent = await player(
        (url) => s.client.get(url),
        `module=${CODE}&ref=1&languageCode=es-MX&startSceneId=intro&resolution=800x600&source=legacy`,
      );
      expect(sent).toMatchObject({
        status: 302,
        pathname: "/player.html",
        query: {
          module: CODE,
          ref: "1",
          languageCode: "es-MX",
          startSceneId: "intro",
          resolution: "800x600",
          source: "legacy",
        },
      });
      // The page it leads to plays that ref, the query and all.
      const page = await s.onPreview(
        `${sent.pathname}?${new URLSearchParams(sent.query as Record<string, string>)}`,
      );
      // Past every check of the query: this fixture has no webpack, so the page says so.
      expect(page.status).toBe(500);
      expect(await page.text()).toContain("The module did not build.");
      // An empty languageCode is absent here as on the API's own entry.
      expect(
        (await player((url) => s.client.get(url), `module=${CODE}&ref=1&languageCode=`)).query,
      ).toEqual({ module: CODE, ref: "1" });
    });

    it("asks for no sign-in, as Loom's does", async () => {
      const s = await setup();
      expect(await player((url) => s.t.app.request(url), `module=${CODE}&ref=1`)).toMatchObject({
        status: 302,
        pathname: "/player.html",
      });
    });

    it("answers a bad ref and an unknown module with Loom's player's words", async () => {
      const s = await setup();
      const get = (url: string) => s.client.get(url);
      expect(await player(get, `module=${CODE}`)).toEqual({
        status: 400,
        message: "Ref is required. Use a non-negative whole number.",
      });
      expect(await player(get, `module=${CODE}&ref=-2`)).toEqual({
        status: 400,
        message: "Invalid ref &quot;-2&quot;. Use a non-negative whole number.",
      });
      expect(await player(get, "module=rpa02233&ref=1")).toEqual({
        status: 404,
        message: "Failed to load module metadata for &quot;rpa02233&quot;.",
      });
      expect(await player(get, `module=${CODE}&ref=4`)).toEqual({
        status: 404,
        message: `Ref #4 is not available for &quot;${CODE}&quot;.`,
      });
      // The product's module is in the checkout's own modules, not a monorepo.
      expect(await player(get, `module=${CODE}&ref=1&source=monorepo`)).toMatchObject({
        status: 404,
      });
    });

    it("finds refs in every project, and only in the one project= names", async () => {
      const s = await setup();
      const outsider = apiClient(s.t.app, (await provisionUser(s.t.app, "play_outsider")).cookie);
      expect(await player((url) => outsider.get(url), `module=${CODE}&ref=1`)).toMatchObject({
        status: 302,
      });
      const get = (url: string) => s.client.get(url);
      expect(await player(get, `module=${CODE}&ref=1&project=${s.projectId}`)).toMatchObject({
        status: 302,
      });
      expect(await player(get, `module=${CODE}&ref=1&project=elsewhere`)).toMatchObject({
        status: 404,
      });
    });
  });

  it("plays an assessment through, one part at a time", async () => {
    const { base, onPreview } = await setup({ usesAssessment: true });
    const at = `${base}assessment/v3/apps/a/assessments/sightWords/versions/1/orgs/o/students/s/assess`;
    const post = (url: string, data: unknown[] = []) =>
      onPreview(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data }),
      });
    const first = (await (await post(at)).json()) as Record<string, any>;
    expect(first.status).toBe("IN_PROGRESS");
    expect(first.nextItems[0].title).toBe("first");
    const second = (await (
      await post(`${at}/${first.assessmentScoreId}`, [{ item_score_id: 1 }])
    ).json()) as Record<string, any>;
    expect(second.nextItems[0].title).toBe("second");
    const done = (await (await post(`${at}/${first.assessmentScoreId}`)).json()) as Record<
      string,
      any
    >;
    expect(done.status).toBe("FINISHED");
    // A finished session is gone.
    expect((await post(`${at}/${first.assessmentScoreId}`)).status).toBe(404);
  });
});
