// Runs one check file against a played module with the evaluator's frozen harness and runner,
// served from memory by the module hooks below, so no check's text reaches the disk.
//
// It runs under Node's permission model (checks.ts starts it): it reads only this file and
// playwright-core, writes nothing, starts no process or worker and loads no addon. A trial's
// own tests are its agent's code; whatever they try is refused. The browser runs in the
// evaluator, which hands over its address; the payload comes over IPC, never through the
// environment or the command line, and the runner's results go back the same way.
import { isBuiltin, registerHooks } from "node:module";

const SHIM = "bench-virtual:fs";

/** @param {{ base: string, playwright: string, files: Record<string, string>, shim: string }} payload */
function hooks(payload) {
  return {
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? "";
      if (specifier.startsWith(payload.base)) return { url: specifier, shortCircuit: true };
      if (!parent.startsWith(payload.base)) return nextResolve(specifier, context);
      // Imported by the harness, the runner or the check: the harness and Node's own modules.
      if (specifier === "node:fs" || specifier === "fs") return { url: SHIM, shortCircuit: true };
      if (specifier === "playwright-core") return { url: payload.playwright, shortCircuit: true };
      if (isBuiltin(specifier)) return nextResolve(specifier, context);
      if (specifier.startsWith("./")) {
        const url = new URL(specifier, parent).href;
        if (Object.hasOwn(payload.files, url.slice(payload.base.length)))
          return { url, shortCircuit: true };
      }
      throw new Error(`A check may import only the harness and Node's own modules: ${specifier}`);
    },
    load(url, context, nextLoad) {
      if (url === SHIM) return { format: "module", source: payload.shim, shortCircuit: true };
      if (url.startsWith(payload.base)) {
        const name = url.slice(payload.base.length);
        if (Object.hasOwn(payload.files, name))
          return { format: "module", source: payload.files[name], shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  };
}

process.once("message", async (payload) => {
  let failure = null;
  try {
    registerHooks(hooks(payload));
    await import(`${payload.base}run-acceptance.mjs`);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  // Sent after the results the runner posted, so the parent has both before the exit.
  process.send({ type: "done", failure }, () => process.exit(failure ? 1 : 0));
});
