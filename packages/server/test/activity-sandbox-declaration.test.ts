import { describe, expect, it } from "vitest";
import {
  ModuleDeclarationError,
  moduleDeclaration,
  rewriteRelativeUrls,
  type ModuleDefinition,
} from "../src/activities/sandbox-declaration.js";

const ROUTE = "/api/preview/act_1/module/";

describe("pointing a module's own URLs at a route", () => {
  it("rewrites a relative URL, which would otherwise resolve against the harness", () => {
    expect(rewriteRelativeUrls({ main: { url: "entry.js" } }, ROUTE)).toEqual({
      main: { url: `${ROUTE}entry.js` },
    });
  });

  it("leaves media, shared layouts and external addresses alone", () => {
    // All three are already reachable; prefixing them breaks all three.
    const value = {
      a: { url: "/media/intro.mp3" },
      b: { url: "/layouts/mainOnly.html" },
      c: { url: "https://example.test/x.js" },
      d: { url: "http://example.test/x.js" },
    };
    expect(rewriteRelativeUrls(value, ROUTE)).toEqual(value);
  });

  it("is harmless to apply twice", () => {
    const once = rewriteRelativeUrls({ main: { url: "entry.js" } }, ROUTE);
    expect(rewriteRelativeUrls(once, ROUTE)).toEqual(once);
  });

  it("keeps everything else the entry said", () => {
    expect(rewriteRelativeUrls({ main: { url: "entry.js", type: "script" } }, ROUTE)).toEqual({
      main: { url: `${ROUTE}entry.js`, type: "script" },
    });
  });

  it("reaches URLs nested deeper and inside arrays", () => {
    expect(rewriteRelativeUrls({ group: [{ inner: { url: "a.css" } }] }, ROUTE)).toEqual({
      group: [{ inner: { url: `${ROUTE}a.css` } }],
    });
  });

  it("leaves values that are not entries with a URL", () => {
    expect(rewriteRelativeUrls({ count: 3, name: "x", url: "entry.js" }, ROUTE)).toEqual({
      count: 3,
      name: "x",
      url: "entry.js",
    });
  });
});

describe("the declaration for one theme", () => {
  const definition = (overrides: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
    id: "sightWords",
    engine: "html",
    engineVersion: "3",
    specificationVersion: "2",
    schemaVersion: 1,
    type: "activity",
    require: { main: { url: "entry.js" } },
    themes: {
      park: { assets: { backdrop: { url: "res/park.png" } }, properties: { hue: "green" } },
      city: { assets: { backdrop: { url: "res/city.png" } } },
    },
    ...overrides,
  });

  it("carries the module's identity and engine", () => {
    const declaration = moduleDeclaration({
      definition: definition(),
      packageVersion: "2.1.0",
      theme: "park",
      routePrefix: ROUTE,
    });
    expect(declaration.id).toBe("sightWords");
    expect(declaration.version).toBe("2.1.0");
    expect(declaration.engine).toBe("html");
    expect(declaration.engineVersion).toBe("3");
  });

  it("takes the chosen theme's assets and properties", () => {
    const declaration = moduleDeclaration({
      definition: definition(),
      theme: "park",
      routePrefix: ROUTE,
    });
    expect(declaration.assets).toEqual({ backdrop: { url: `${ROUTE}res/park.png` } });
    expect(declaration.properties).toEqual({ hue: "green" });
  });

  it("routes what the module requires", () => {
    const declaration = moduleDeclaration({
      definition: definition(),
      theme: "park",
      routePrefix: ROUTE,
    });
    expect(declaration.require).toEqual({ main: { url: `${ROUTE}entry.js` } });
  });

  it("refuses a theme the module does not have, and says which it has", () => {
    // Themes differ in the assets they provide, so quietly picking another one produces an
    // activity that plays with the wrong pictures and reports nothing.
    expect(() =>
      moduleDeclaration({ definition: definition(), theme: "space", routePrefix: ROUTE }),
    ).toThrow(ModuleDeclarationError);
    expect(() =>
      moduleDeclaration({ definition: definition(), theme: "space", routePrefix: ROUTE }),
    ).toThrow("It has: park, city.");
  });

  it("refuses a definition with no id", () => {
    expect(() =>
      moduleDeclaration({
        definition: definition({ id: "  " }),
        theme: "park",
        routePrefix: ROUTE,
      }),
    ).toThrow("no id");
  });

  it("treats a theme with no properties as having none", () => {
    const declaration = moduleDeclaration({
      definition: definition(),
      theme: "city",
      routePrefix: ROUTE,
    });
    expect(declaration.properties).toEqual({});
  });

  it("defaults the version when the package has none", () => {
    expect(
      moduleDeclaration({ definition: definition(), theme: "park", routePrefix: ROUTE }).version,
    ).toBe(1);
  });
});
