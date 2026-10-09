import { describe, expect, it } from "vitest";
import type { ModuleDocument } from "@prismshadow/penguin-server/api";
import {
  assessmentItemCount,
  documentChanged,
  documentOrigin,
  documentText,
  definitionSummary,
  filePresence,
  moduleFileUrl,
  modulePath,
  hasUnsavedText,
  parseDocument,
  readDefinition,
} from "../src/features/activities/module-document";

const document: ModuleDocument = {
  file: "configurations/words-12.json",
  value: { maxRounds: 3 },
  edited: false,
  stale: false,
  editable: true,
};

describe("a module document in the editor", () => {
  it("shows as indented JSON, and is unchanged until what it says changes", () => {
    const text = documentText({ maxRounds: 3 });
    expect(text).toBe('{\n  "maxRounds": 3\n}');
    expect(documentChanged(text, { maxRounds: 3 })).toBe(false);
    expect(documentChanged('{"maxRounds":3}', { maxRounds: 3 })).toBe(false);
    expect(documentChanged('{"maxRounds":4}', { maxRounds: 3 })).toBe(true);
    expect(documentChanged("{", { maxRounds: 3 })).toBe(true);
  });

  it("parses to an object, or says why it cannot be saved", () => {
    expect(parseDocument('{"a": 1}')).toEqual({ value: { a: 1 } });
    const broken = parseDocument("{ a: 1 }");
    expect("error" in broken && broken.error).toMatch(/^This is not valid JSON: /);
    expect(parseDocument("[1, 2]")).toEqual({ error: "The document must be a JSON object." });
    expect(parseDocument("null")).toEqual({ error: "The document must be a JSON object." });
  });

  it("says where it came from", () => {
    expect(documentOrigin("checkout", document)).toBe(
      "configurations/words-12.json, from the module in the WAF checkout.",
    );
    expect(documentOrigin("run", document)).toBe(
      "configurations/words-12.json, from the module this activity assembled.",
    );
    expect(documentOrigin("draft", { ...document, edited: true })).toBe(
      "Edited in this activity; no module has been assembled yet.",
    );
  });

  it("counts an assessment's items", () => {
    expect(assessmentItemCount({ items: [{}, {}] })).toBe(2);
    expect(assessmentItemCount({ maxRounds: 3 })).toBeNull();
    expect(assessmentItemCount(null)).toBeNull();
  });
});

describe("the definition summary", () => {
  it("reads what the assembled definition says", () => {
    const summary = definitionSummary({
      id: "words",
      schemaVersion: "2.0.0",
      specificationVersion: "2.0.0",
      engine: "html",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        layout: { type: "html", url: "./res/layout.html?v=2" },
        style: { type: "css", url: "https://cdn.example.org/style.css" },
      },
      assets: {},
      properties: { a: 1 },
      themes: {
        park: {
          properties: { key: "park", title: "Words", flags: { loud: true } },
        },
      },
    });
    expect(summary).toEqual({
      engine: "html",
      schemaVersion: "2.0.0",
      specificationVersion: "2.0.0",
      assets: 0,
      properties: 1,
      themes: [
        {
          name: "park",
          properties: [
            { key: "key", value: "park" },
            { key: "title", value: "Words" },
            { key: "flags", value: '{"loud":true}' },
          ],
        },
      ],
      files: [
        { role: "entry", url: "entry.js", type: "javascript", path: "entry.js" },
        {
          role: "layout",
          url: "./res/layout.html?v=2",
          type: "html",
          path: "res/layout.html",
        },
        {
          role: "style",
          url: "https://cdn.example.org/style.css",
          type: "css",
          path: null,
        },
      ],
    });
  });

  it("tolerates missing and odd fields", () => {
    expect(
      definitionSummary({
        engine: 3,
        schemaVersion: "",
        require: { entry: "entry.js", broken: { type: 7 }, list: [1] },
        themes: ["park"],
        assets: [1, 2],
      }),
    ).toEqual({
      engine: "3",
      schemaVersion: null,
      specificationVersion: null,
      themes: [],
      assets: 0,
      properties: 0,
      files: [
        { role: "entry", url: "entry.js", type: null, path: "entry.js" },
        { role: "broken", url: null, type: "7", path: null },
        { role: "list", url: null, type: null, path: null },
      ],
    });
    expect(definitionSummary({}).files).toEqual([]);
    expect(definitionSummary({ themes: { bare: null } }).themes).toEqual([
      { name: "bare", properties: [] },
    ]);
  });

  it("says why text is not a definition", () => {
    expect(readDefinition("{ nope")).toHaveProperty("error");
    expect(readDefinition("[1]")).toHaveProperty("error");
    expect(readDefinition('{"engine":"html"}')).toHaveProperty("summary.engine", "html");
  });

  it("only treats module-relative URLs as module files", () => {
    expect(modulePath("entry.js")).toBe("entry.js");
    expect(modulePath("././dist/entry.js#x")).toBe("dist/entry.js");
    expect(modulePath("/entry.js")).toBeNull();
    expect(modulePath("//cdn/entry.js")).toBeNull();
    expect(modulePath("data:text/css,")).toBeNull();
    expect(modulePath("../other/entry.js")).toBeNull();
    expect(modulePath("  ")).toBeNull();
  });

  it("decodes an escaped file name once and links it encoded once", () => {
    expect(modulePath("res/my%20layout.html")).toBe("res/my layout.html");
    expect(moduleFileUrl("/api/a", modulePath("res/my%20layout.html")!)).toBe(
      "/api/a/sandbox/module/res/my%20layout.html",
    );
    // A malformed escape, or an escaped step out, names no file rather than throwing.
    expect(modulePath("bad%E0%A4%A.js")).toBeNull();
    expect(modulePath("%2e%2e/secret.js")).toBeNull();
  });

  it("drops harmless dot segments, as the browser does", () => {
    expect(modulePath("res/./style.css")).toBe("res/style.css");
    expect(modulePath("./entry.js")).toBe("entry.js");
    expect(modulePath("a/../b")).toBeNull();
    expect(modulePath("a//b.js")).toBeNull();
  });

  it("reads a file's presence from the preview's status", () => {
    expect(filePresence(200)).toBe("found");
    expect(filePresence(404)).toBe("missing");
    expect(filePresence(400)).toBe("unknown");
    expect(filePresence(409)).toBe("unknown");
  });
});

describe("hasUnsavedText", () => {
  it("compares with the last read, ignoring layout", () => {
    expect(hasUnsavedText('{"a":1}', { a: 1 })).toBe(false);
    expect(hasUnsavedText('{"a":2}', { a: 1 })).toBe(true);
    expect(hasUnsavedText("{ nope", { a: 1 })).toBe(true);
  });

  it("treats text just saved as saved before the next read shows it", () => {
    expect(hasUnsavedText('{"a":2}', { a: 1 }, { a: 2 })).toBe(false);
    expect(hasUnsavedText('{"a":3}', { a: 1 }, { a: 2 })).toBe(true);
  });
});
