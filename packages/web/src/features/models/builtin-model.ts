/** What a built-in agent's card offers in each state (Models → Built-in). */
import type { BuiltinAgentInfo } from "@prismshadow/penguin-server/api";

export function builtinActions(info: BuiltinAgentInfo) {
  const installed = info.installedVersion !== null;
  const none = {
    setup: false,
    cancel: false,
    test: false,
    replaceToken: false,
    update: false,
    remove: false,
    retry: false,
    needsToken: false,
  };
  switch (info.status) {
    case "unsupported":
      return none;
    case "downloading":
      return { ...none, cancel: true };
    case "not-installed":
      return { ...none, setup: true, needsToken: true };
    case "failed":
      return {
        ...none,
        retry: true,
        needsToken: info.tokenMasked === null,
        test: installed,
        replaceToken: installed,
        remove: installed,
      };
    case "update-available":
      return { ...none, update: true, test: true, replaceToken: true, remove: true };
    case "ready":
      return { ...none, test: true, replaceToken: true, remove: true };
  }
}

export function progressPercent(info: BuiltinAgentInfo): number | null {
  const p = info.progress;
  if (p === null || p.total === null || p.total === 0) return null;
  return Math.min(100, Math.round((p.received / p.total) * 100));
}
