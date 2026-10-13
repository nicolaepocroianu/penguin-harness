/**
 * `pnpm bench seal`: proves a folder of cases, then seals it. People only — the person who
 * wrote the cases, with the passphrase they will type for every evaluation.
 *
 * The proofs, run by the evaluator's own check runner: every hidden check fails on an empty
 * page (a check that passes on nothing checks nothing), and every one passes on the case's
 * gold module. A case that is not a placeholder must have a gold module to be sealed.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { passedCriteria } from "./checks.js";
import type { CheckRunner } from "./types.js";
import { sealCases, type PlainVault } from "./vault.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
};

/** Serves a folder (or, with none, an empty page) on loopback until closed. */
export async function serveFolder(
  dir: string | null,
): Promise<{ url: string; close(): Promise<void> }> {
  const root = dir ? path.resolve(dir) : null;
  const server = http.createServer((request, response) => {
    if (!root) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Empty</title>");
      return;
    }
    const wanted = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    const file = path.resolve(root, `.${wanted.endsWith("/") ? `${wanted}index.html` : wanted}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Why a case's hidden checks are not proven, or null when they are. The checks run with what
 * they print kept: the person sealing them wrote them, and needs it to fix one.
 */
export async function proveCase(
  source: PlainVault,
  caseId: string,
  checks: CheckRunner,
): Promise<string | null> {
  const hidden = await source.hidden(caseId);
  const summary = (await source.describe()).cases.find((item) => item.id === caseId)!;
  const empty = await serveFolder(null);
  try {
    const run = await checks.run(hidden, empty.url);
    if (!run.ran) return `${caseId}: its hidden checks could not run: ${run.reason}`;
    const passing = passedCriteria(hidden.criteria, run);
    if (passing.size)
      return `${caseId}: a hidden check passes on an empty page: ${[...passing][0]}`;
  } finally {
    await empty.close();
  }
  const gold = source.gold(caseId);
  if (!gold)
    return summary.placeholder ? null : `${caseId}: no gold module to prove its hidden checks on.`;
  const served = await serveFolder(gold);
  try {
    const run = await checks.run(hidden, served.url);
    if (!run.ran)
      return `${caseId}: its hidden checks could not run on its gold module: ${run.reason}`;
    const passing = passedCriteria(hidden.criteria, run);
    const failing = hidden.criteria.filter((criterion) => !passing.has(criterion));
    if (failing.length) return `${caseId}: a hidden check fails on its gold module: ${failing[0]}`;
  } finally {
    await served.close();
  }
  return null;
}

/** Proves every case, then seals them all into `out`; throws on the first case not proven. */
export async function proveAndSeal(
  source: PlainVault,
  checks: CheckRunner,
  passphrase: string,
  out: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  for (const item of (await source.describe()).cases) {
    log(`Proving ${item.id}.`);
    const problem = await proveCase(source, item.id, checks);
    if (problem) throw new Error(problem);
  }
  const set = await sealCases(source, passphrase, out);
  log(
    `Sealed ${set.cases.length} cases of ${set.bench} (revision ${set.revision.slice(0, 12)}) into ${out}.`,
  );
}
