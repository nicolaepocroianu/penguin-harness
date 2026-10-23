/**
 * The shared UI package's accessibility fallbacks in the app's words. The package never reads the
 * app's dictionaries; `LocaleProvider` hands it these instead, so a close cross or a "Copied"
 * announcement speaks the words the rest of the page does. The `a2ui`
 * group is the one stretch of visible copy among them: the words around the blocks a reply
 * draws, which render inside Markdown where no caller can pass them down.
 *
 * Each value is read from the dictionary itself rather than from the live `S`, so the object is
 * built once and keeps its identity across renders.
 */
import type { UiStrings } from "@waterford/waf-harness-ui";
import type { Strings } from "./strings";
import { en } from "./strings-en";

/** One dictionary's words for every `UiStrings` key. */
export function uiStringsOf(dict: Strings): UiStrings {
  return {
    close: dict.common.close,
    copied: dict.common.copied,
    loading: dict.common.loading,
    showPassword: dict.auth.showPassword,
    hidePassword: dict.auth.hidePassword,
    clearSearch: dict.chat.searchClear,
    moreInfo: dict.common.moreInfo,
    moreInfoAbout: dict.common.moreInfoAbout,
    notifications: dict.common.notifications,
    dismiss: dict.common.dismiss,
    copyCode: dict.chat.copyCode,
    expand: dict.nav.expandGroup,
    collapse: dict.nav.collapseGroup,
    more: dict.chat.loadMore,
    fewer: dict.chat.showLess,
    previous: dict.common.previousPage,
    next: dict.common.nextPage,
    pagePosition: dict.chat.groupPagePosition,
    a2ui: dict.chat.a2ui,
    reader: {
      outline: dict.find.outline,
      find: dict.find.inDocument,
      findPlaceholder: dict.find.documentPlaceholder,
      previousMatch: dict.find.prev,
      nextMatch: dict.find.next,
      closeFind: dict.find.close,
      noResults: dict.find.noResults,
    },
  };
}

const UI_STRINGS = { en: uiStringsOf(en) } as const;

/** The package's words for an interface language (English is the only one). */
export function uiStringsFor(locale: "en"): UiStrings {
  return UI_STRINGS[locale];
}
