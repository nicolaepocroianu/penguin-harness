/**
 * The Activities list's products in the modules (features/activities/activity-list.tsx): the
 * products this project has not opened are listed under its own activities, read only.
 *
 * - With no activity opened, the products still list, and the empty state does not show.
 * - A search narrows them as it does the activities; a lens or a tag, which they have no state
 *   for, leaves them out.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { ModuleProduct } from "@waterford/waf-harness-server/api";
import { ActivityList } from "../src/features/activities/activity-list";
import type { ListLens } from "../src/features/activities/activity-groups";
import { S } from "../src/lib/strings";

const PRODUCTS: ModuleProduct[] = [
  {
    moduleFolder: "waf-module-r2pt01",
    productCode: "r2pt01",
    title: "Decodable Books",
    activityType: "book",
    refNums: [150, 151, 152],
  },
  {
    moduleFolder: "waf-module-clap-syl",
    productCode: "clap-syl",
    title: "Clap the syllables",
    activityType: "standard",
    refNums: [1],
  },
];

function render(opts: { search?: string; lens?: ListLens } = {}) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ActivityList, {
        items: [],
        moduleProducts: PRODUCTS,
        loading: false,
        error: "",
        editable: true,
        available: true,
        projectId: "default_project",
        summaries: {},
        sort: "recent",
        onSort: () => {},
        search: opts.search ?? "",
        onSearch: () => {},
        tag: null,
        onTag: () => {},
        lens: opts.lens ?? "all",
        onLens: () => {},
        onRefresh: () => {},
        onOpenFromModules: () => {},
        onCreate: () => {},
        onMedia: () => {},
      }),
    ),
  );
}

describe("ActivityList products in the modules", () => {
  it("lists them when the project has opened nothing", () => {
    const html = render();
    expect(html).toContain(S.activities.openFromModules.listHeading);
    expect(html).toContain("Decodable Books");
    expect(html).toContain("Clap the syllables");
    expect(html).toContain(S.activities.openFromModules.refs(3));
    expect(html).not.toContain(S.activities.empty);
  });

  it("narrows them by the search", () => {
    const html = render({ search: "clap" });
    expect(html).toContain("Clap the syllables");
    expect(html).not.toContain("Decodable Books");
  });

  it("leaves them out under a lens", () => {
    const html = render({ lens: "attention" });
    expect(html).not.toContain(S.activities.openFromModules.listHeading);
  });
});
