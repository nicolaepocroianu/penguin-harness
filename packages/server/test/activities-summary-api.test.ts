import { afterEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("activity list summaries", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("adds a summary per activity only when asked", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "summary_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "summary_owner-p", name: "P" });
    const first = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const firstId = ((await first.json()) as { id: string }).id;
    const secondId = ((await second.json()) as { id: string }).id;

    const plain = (await (await client.get("/api/projects/summary_owner-p/activities")).json()) as {
      summaries?: Record<string, unknown>;
    };
    expect(plain.summaries).toBeUndefined();

    const withSummary = (await (
      await client.get("/api/projects/summary_owner-p/activities?summary=1")
    ).json()) as { summaries: Record<string, { canonical: boolean }> };
    expect(withSummary.summaries[firstId]).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
      poster: null,
    });
    // The product's first ref is canonical; the second is not.
    expect(withSummary.summaries[secondId]!.canonical).toBe(false);
  });

  it("calls a ref with no product row (it predates the product level) canonical", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "legacy_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "legacy_owner-p", name: "P" });
    await client.post("/api/projects/legacy_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/legacy_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const secondId = ((await second.json()) as { id: string }).id;
    // Ref 2 is not canonical while it belongs to the product; written the way a
    // pre-product-level build left it (no product), it is the only ref it could build on.
    t.deps.db.prepare("UPDATE activities SET product_id = NULL WHERE id = ?").run(secondId);

    const response = await client.get("/api/projects/legacy_owner-p/activities?summary=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activities: { id: string }[];
      summaries: Record<string, { canonical: boolean }>;
    };
    expect(body.activities.map((activity) => activity.id)).toContain(secondId);
    expect(body.summaries[secondId]!.canonical).toBe(true);
  });

  it("says the number a product's next activity takes, deleted refs included", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "refnum_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "refnum_owner-p", name: "P" });
    const next = async (code: string) =>
      (await (
        await client.get(
          `/api/projects/refnum_owner-p/activities/ref-number?productCode=${encodeURIComponent(code)}`,
        )
      ).json()) as { refNum: number; taken: number[] };

    // Before the project has any activity, every product starts at 0.
    expect(await next("ants")).toEqual({ refNum: 0, taken: [] });
    await client.post("/api/projects/refnum_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/refnum_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const secondId = ((await second.json()) as { id: string }).id;
    expect(await next("ants")).toEqual({ refNum: 3, taken: [1, 2] });
    // A deleted ref keeps its number, so the next one is still after it.
    await client.delete(`/api/projects/refnum_owner-p/activities/${secondId}`);
    expect(await next("ants")).toEqual({ refNum: 3, taken: [1, 2] });
    expect(await next("bees")).toEqual({ refNum: 0, taken: [] });

    const bad = await client.get(
      "/api/projects/refnum_owner-p/activities/ref-number?productCode=..%2Fup",
    );
    expect(bad.status).toBe(400);
  });

  it("starts the script with what the author says the learner does", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "described_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "described_owner-p", name: "P" });
    const created = (await (
      await client.post("/api/projects/described_owner-p/activities", {
        productCode: "hunt",
        refNum: 1,
        title: "Letter hunt",
        description: "  Five letters sit on stones; the learner finds the one named.  ",
      })
    ).json()) as { draft: { description: string } };
    expect(created.draft.description).toBe(
      "Five letters sit on stones; the learner finds the one named.\n",
    );
    const plain = (await (
      await client.post("/api/projects/described_owner-p/activities", {
        productCode: "hunt",
        refNum: 2,
        title: "Letter hunt 2",
      })
    ).json()) as { draft: { description: string } };
    expect(plain.draft.description).toBe("");
  });
});
