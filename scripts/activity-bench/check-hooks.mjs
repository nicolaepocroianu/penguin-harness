// Module hooks for check-child.mjs: serve the harness, the runner and the check file from
// memory, so no check's text reaches the disk. The payload arrives through `initialize`.
import { isBuiltin } from "node:module";

/** @type {{ base: string, resolveFrom: string, files: Record<string, string>, shim: string }} */
let payload;
const SHIM = "bench-virtual:fs";

export function initialize(data) {
  payload = data;
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  if (specifier.startsWith(payload.base)) return { url: specifier, shortCircuit: true };
  if (!parent.startsWith(payload.base)) return nextResolve(specifier, context);
  // Imported by the harness, the runner or the check: only the harness and Node's own modules.
  if (specifier === "node:fs" || specifier === "fs") return { url: SHIM, shortCircuit: true };
  if (specifier === "playwright-core")
    return nextResolve(specifier, { ...context, parentURL: payload.resolveFrom });
  if (isBuiltin(specifier)) return nextResolve(specifier, context);
  if (specifier.startsWith("./")) {
    const url = new URL(specifier, parent).href;
    if (Object.hasOwn(payload.files, url.slice(payload.base.length)))
      return { url, shortCircuit: true };
  }
  throw new Error(`A check may import only the harness and Node's own modules: ${specifier}`);
}

export async function load(url, context, nextLoad) {
  if (url === SHIM) return { format: "module", source: payload.shim, shortCircuit: true };
  if (url.startsWith(payload.base)) {
    const name = url.slice(payload.base.length);
    if (Object.hasOwn(payload.files, name))
      return { format: "module", source: payload.files[name], shortCircuit: true };
  }
  return nextLoad(url, context);
}
