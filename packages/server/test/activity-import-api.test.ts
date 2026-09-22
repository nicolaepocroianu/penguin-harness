/**
 * Importing a Loom activity end to end: a real checkout on disk, over HTTP, into the real
 * store. The mapping and the ordering have their own unit tests; what this proves is that
 * an imported activity is an ordinary Penguin activity afterwards.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

/** A checkout `findWafRoot` accepts, holding one Loom product. */
async function loomCheckout(product: {
  moduleFolder: string;
  productCode: string;
  metadata: Record<string, unknown>;
  refs: {
    refNum: number;
    metadata?: Record<string, unknown>;
    spec?: unknown;
    manifest?: unknown;
  }[];
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-checkout-"));
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await fs.writeFile(path.join(root, "framework", "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(root, "media"), { recursive: true });
  const productDir = path.join(
    root,
    "modules",
    product.moduleFolder,
    "generated",
    product.productCode,
  );
  await fs.mkdir(path.join(productDir, "spec"), { recursive: true });
  await fs.writeFile(
    path.join(productDir, "spec", "activity_metadata.json"),
    JSON.stringify(product.metadata),
    "utf8",
  );
  for (const ref of product.refs) {
    const refSpec = path.join(productDir, "refs", `${product.productCode}-${ref.refNum}`, "spec");
    await fs.mkdir(refSpec, { recursive: true });
    await fs.writeFile(
      path.join(refSpec, "activity_metadata.json"),
      JSON.stringify({ refNum: ref.refNum, ...ref.metadata }),
      "utf8",
    );
    await fs.writeFile(
      path.join(refSpec, "activity_spec.json"),
      JSON.stringify(ref.spec ?? activitySpec),
      "utf8",
    );
    await fs.writeFile(
      path.join(refSpec, "asset_manifest.json"),
      JSON.stringify(ref.manifest ?? { assets: { "en-US": [] } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(refSpec, "activity_description.txt"),
      `Ref ${ref.refNum} description`,
      "utf8",
    );
  }
  return root;
}

describe("importing a Loom activity", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(refNums: number[], canonicalRefNum: number | null = refNums[0]!) {
    const checkout = await loomCheckout({
      moduleFolder: "waf-module-sight-words",
      productCode: "sight-words",
      metadata: {
        title: "Sight Words",
        canonicalRefNum,
        activityType: "standard",
        moduleFolder: "waf-module-sight-words",
      },
      refs: refNums.map((refNum) => ({
        refNum,
        metadata: { title: `Sight Words ${refNum}`, displayName: `Round ${refNum}` },
      })),
    });
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = checkout;
    const t = await createTestApp();
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(checkout, { recursive: true, force: true });
    });
    const owner = await provisionUser(t.app, "import_owner");
    const client = apiClient(t.app, owner.cookie);
    const created = await client.post("/api/projects", {
      projectId: "import_owner-import",
      name: "Import project",
    });
    if (created.status !== 201)
      throw new Error(`project create: ${created.status} ${await created.text()}`);
    return { client, projectId: "import_owner-import" };
  }

  it("lists what the checkout offers without importing any of it", async () => {
    const { client, projectId } = await setup([1]);
    const listed = await client.get(`/api/projects/${projectId}/activities/import-sources`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      products: { product: { productCode: string }; refs: { refNum: number }[] }[];
    };
    expect(body.products.map((entry) => entry.product.productCode)).toEqual(["sight-words"]);

    const activities = await client.get(`/api/projects/${projectId}/activities`);
    expect(((await activities.json()) as { activities: unknown[] }).activities).toEqual([]);
  });

  it("creates the refs, their drafts and their specifications", async () => {
    const { client, projectId } = await setup([1, 2]);
    const imported = await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: "waf-module-sight-words",
      productCode: "sight-words",
    });
    expect(imported.status).toBe(200);
    const body = (await imported.json()) as { outcome: { created: number[]; failed: unknown[] } };
    expect(body.outcome.created).toEqual([1, 2]);
    expect(body.outcome.failed).toEqual([]);

    const activities = (await (
      await client.get(`/api/projects/${projectId}/activities`)
    ).json()) as { activities: { id: string; refNum: number; displayName: string | null }[] };
    expect(activities.activities.map((activity) => activity.refNum)).toEqual([1, 2]);
    expect(activities.activities[0]!.displayName).toBe("Round 1");

    const detail = (await (
      await client.get(`/api/projects/${projectId}/activities/${activities.activities[0]!.id}`)
    ).json()) as { draft: { spec: { id: string } | null; description: string; status: string } };
    expect(detail.draft.spec!.id).toBe("sight-words");
    expect(detail.draft.description).toBe("Ref 1 description");
    expect(detail.draft.status).toBe("valid");
  });

  it("gives the module to the ref Loom named, not the lowest one", async () => {
    // Three real products name a canonical ref that is not their lowest; the canonical ref
    // is the only one allowed to change the shared module.
    const { client, projectId } = await setup([3, 5], 5);
    const imported = await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: "waf-module-sight-words",
      productCode: "sight-words",
    });
    // Creation order is the assertion: Penguin makes the first ref of a product canonical.
    const body = (await imported.json()) as { outcome: { created: number[] } };
    expect(body.outcome.created).toEqual([5, 3]);

    const activities = (await (
      await client.get(`/api/projects/${projectId}/activities`)
    ).json()) as { activities: { refNum: number }[] };
    expect(activities.activities.map((activity) => activity.refNum)).toEqual([3, 5]);
  });

  it("can be run again without creating anything twice", async () => {
    const { client, projectId } = await setup([1, 2]);
    const body = { moduleFolder: "waf-module-sight-words", productCode: "sight-words" };
    await client.post(`/api/projects/${projectId}/activities/import`, body);
    const again = await client.post(`/api/projects/${projectId}/activities/import`, body);
    const { outcome } = (await again.json()) as {
      outcome: { created: number[]; skipped: number[] };
    };
    expect(outcome.created).toEqual([]);
    expect(outcome.skipped).toEqual([1, 2]);

    const activities = (await (
      await client.get(`/api/projects/${projectId}/activities`)
    ).json()) as { activities: unknown[] };
    expect(activities.activities).toHaveLength(2);
  });

  it("reports a product the checkout does not have", async () => {
    const { client, projectId } = await setup([1]);
    const missing = await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: "waf-module-sight-words",
      productCode: "nothing-here",
    });
    expect(missing.status).toBe(404);
  });

  it("imports a ref whose specification Penguin refuses, without its specification", async () => {
    const checkout = await loomCheckout({
      moduleFolder: "waf-module-sight-words",
      productCode: "sight-words",
      metadata: { title: "Sight Words", canonicalRefNum: 1, activityType: "standard" },
      refs: [{ refNum: 1 }, { refNum: 2, spec: { id: "sight-words", title: "" } }],
    });
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = checkout;
    const t = await createTestApp();
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(checkout, { recursive: true, force: true });
    });
    const owner = await provisionUser(t.app, "import_partial");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", {
      projectId: "import_partial-import",
      name: "Import project",
    });
    const imported = await client.post("/api/projects/import_partial-import/activities/import", {
      moduleFolder: "waf-module-sight-words",
      productCode: "sight-words",
    });
    const body = (await imported.json()) as {
      outcome: { created: number[]; failed: unknown[]; partial: unknown[] };
      mapping: { dropped: string[] };
    };
    // Refused before anything was written, so the ref is created cleanly with no spec
    // rather than created and then left half-finished.
    expect(body.outcome.created).toEqual([1, 2]);
    expect(body.outcome.failed).toEqual([]);
    expect(body.outcome.partial).toEqual([]);
    expect(body.mapping.dropped.join(" ")).toContain("will not accept");

    const activities = (await (
      await client.get("/api/projects/import_partial-import/activities")
    ).json()) as { activities: { id: string; refNum: number }[] };
    expect(activities.activities).toHaveLength(2);
    const refused = activities.activities.find((activity) => activity.refNum === 2)!;
    const detail = (await (
      await client.get(`/api/projects/import_partial-import/activities/${refused.id}`)
    ).json()) as { draft: { spec: unknown; status: string } };
    expect(detail.draft.spec).toBeNull();
    expect(detail.draft.status).toBe("draft");
  });
});
