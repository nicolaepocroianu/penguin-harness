import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  protectedWrite,
  protectedWriteMessage,
  type ProtectedRoot,
} from "../src/environment/tools/path-guard.js";

let base: string;
let workspace: string;
let checkout: string;
let roots: ProtectedRoot[];

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "path-guard-"));
  workspace = path.join(base, "workspace");
  checkout = path.join(base, "waf");
  await fs.mkdir(path.join(checkout, "framework", "src"), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(checkout, "framework", "package.json"), "{}");
  roots = [{ root: checkout, label: "the shared WAF checkout" }];
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("protectedWrite", () => {
  it("allows a write inside the workspace", async () => {
    expect(await protectedWrite(path.join(workspace, "module", "a.ts"), roots)).toBeNull();
  });

  it("refuses a write inside a protected root", async () => {
    const blocked = await protectedWrite(path.join(checkout, "framework", "src", "x.ts"), roots);
    expect(blocked?.label).toBe("the shared WAF checkout");
  });

  it("refuses a write to the root itself", async () => {
    expect(await protectedWrite(checkout, roots)).not.toBeNull();
  });

  it("judges a path that does not exist yet, which is the normal case for a write", async () => {
    const target = path.join(checkout, "framework", "does", "not", "exist", "yet.ts");
    expect(await protectedWrite(target, roots)).not.toBeNull();
  });

  it("is not fooled by a sibling whose name merely starts with the root", async () => {
    // `<base>/waf-other` must not read as being inside `<base>/waf`.
    expect(await protectedWrite(path.join(`${checkout}-other`, "a.ts"), roots)).toBeNull();
  });

  it("is not fooled by a traversal back into the root", async () => {
    const sneaky = path.join(workspace, "..", "waf", "framework", "src", "x.ts");
    expect(await protectedWrite(sneaky, roots)).not.toBeNull();
  });

  it("allows everything when no roots are declared", async () => {
    expect(await protectedWrite(path.join(checkout, "anything.ts"), undefined)).toBeNull();
    expect(await protectedWrite(path.join(checkout, "anything.ts"), [])).toBeNull();
  });

  it("ignores a declared root that is not there", async () => {
    const missing = [{ root: path.join(base, "gone"), label: "a tree that moved" }];
    expect(await protectedWrite(path.join(workspace, "a.ts"), missing)).toBeNull();
  });

  it("follows a link out of the workspace into a protected root", async () => {
    const link = path.join(workspace, "framework-link");
    try {
      await fs.symlink(path.join(checkout, "framework"), link, "junction");
    } catch {
      // Creating links can need a privilege this machine does not grant; the lexical
      // checks above still stand, so skip rather than fail for an unrelated reason.
      return;
    }
    // Lexically this sits inside the workspace; only resolving the link reveals it does not.
    const blocked = await protectedWrite(path.join(link, "src", "x.ts"), roots);
    expect(blocked?.label).toBe("the shared WAF checkout");
  });
});

describe("protectedWriteMessage", () => {
  it("names the tree, the path and what to do instead", () => {
    const message = protectedWriteMessage("framework/src/x.ts", roots[0]!);
    expect(message).toContain("framework/src/x.ts");
    expect(message).toContain("the shared WAF checkout");
    expect(message).toContain("read-only");
    expect(message).toContain("inside the workspace");
  });
});
