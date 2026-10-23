/**
 * Where the cases are kept (CaseVault), in two forms.
 *
 * PlainVault reads a folder of cases as people write them: fit to try the bench and to be
 * sealed, never to score a recipe — its hidden checks lie on disk for anyone to read.
 *
 * SealedVault reads one sealed file: AES-256-GCM under a key derived (scrypt) from a passphrase
 * a person types, held in this process only and never in a child's environment. The requests
 * and each case's hidden checks are sealed separately, so a case's checks are unsealed into
 * memory only when it is scored. Every sealed part is bound to the file's public header, so a
 * header that was changed opens nothing.
 *
 * A case folder (PlainVault, and what `pnpm bench seal` reads):
 *   bench.json            { "bench": "<id>", "canary": "<a string no agent would write>" }
 *   CASE-<nnn>-<name>/
 *     case.json           { title, split: "dev" | "heldOut", weight?, placeholder?,
 *                           request: { productCode, refNum, activityType?, bookMode?, sequences? },
 *                           hidden: { criteria, scenes?, viewport? } }
 *     script.md           the activity script
 *     spec.json           a frozen specification (optional)
 *     media.json          a media manifest with every asset bound (optional)
 *     hidden.test.mjs     the hidden checks, written against the acceptance harness; must
 *                         contain the canary
 *     gold/               a built module the hidden checks pass on (for sealing proofs)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CaseRequest, CaseSet, CaseSummary, CaseVault, HiddenChecks, Split } from "./types.js";

export const SEALED_FORMAT = "wafh-activity-bench/1";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

interface PlainCase {
  summary: CaseSummary;
  request: CaseRequest;
  hidden: HiddenChecks;
}

function readJson(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${file} must hold a JSON object.`);
  return value as Record<string, unknown>;
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))
    throw new Error(`${what} must be a list of non-empty strings.`);
  return value as string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Reads one case folder; throws saying what is wrong with it. */
function readCase(dir: string, id: string, canary: string): PlainCase {
  const at = (name: string) => path.join(dir, name);
  const json = readJson(at("case.json"));
  const split = json.split as Split;
  if (split !== "dev" && split !== "heldOut")
    throw new Error(`${id}: split must be dev or heldOut.`);
  const weight = json.weight === undefined ? 1 : Number(json.weight);
  if (!(weight > 0)) throw new Error(`${id}: weight must be above 0.`);
  if (typeof json.title !== "string" || !json.title.trim())
    throw new Error(`${id}: title is required.`);
  const request = (json.request ?? {}) as Record<string, unknown>;
  const hidden = (json.hidden ?? {}) as Record<string, unknown>;
  if (typeof request.productCode !== "string" || typeof request.refNum !== "number")
    throw new Error(`${id}: request needs a productCode and a refNum.`);
  const script = fs.readFileSync(at("script.md"), "utf8");
  if (!script.trim()) throw new Error(`${id}: script.md is empty.`);
  const test = fs.readFileSync(at("hidden.test.mjs"), "utf8");
  if (!test.includes(canary)) throw new Error(`${id}: hidden.test.mjs must contain the canary.`);
  const optional = (name: string) => (fs.existsSync(at(name)) ? readJson(at(name)) : undefined);
  const spec = optional("spec.json");
  const media = optional("media.json");
  const viewport = (hidden.viewport ?? DEFAULT_VIEWPORT) as { width: number; height: number };
  return {
    summary: {
      id,
      split,
      weight,
      title: json.title.trim(),
      placeholder: json.placeholder === true,
    },
    request: {
      title: json.title.trim(),
      productCode: request.productCode,
      refNum: request.refNum,
      ...(request.activityType === "book" || request.activityType === "standard"
        ? { activityType: request.activityType }
        : {}),
      ...(request.bookMode === "readAlong" || request.bookMode === "decodable"
        ? { bookMode: request.bookMode }
        : {}),
      script,
      ...(spec !== undefined ? { spec } : {}),
      ...(media !== undefined ? { media } : {}),
      sequences:
        request.sequences === undefined
          ? ["all"]
          : strings(request.sequences, `${id}: request.sequences`),
    },
    hidden: {
      test,
      criteria: strings(hidden.criteria, `${id}: hidden.criteria`),
      scenes: hidden.scenes === undefined ? [] : strings(hidden.scenes, `${id}: hidden.scenes`),
      viewport: { width: Number(viewport.width), height: Number(viewport.height) },
    },
  };
}

/** A folder of cases, read as it is. */
export class PlainVault implements CaseVault {
  readonly sealed = false;
  private readonly bench: string;
  private readonly canary: string;
  private readonly cases: PlainCase[];

  constructor(readonly dir: string) {
    const config = readJson(path.join(dir, "bench.json"));
    if (typeof config.bench !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(config.bench))
      throw new Error("bench.json needs a bench id: lowercase letters, digits and dashes.");
    if (typeof config.canary !== "string" || config.canary.length < 16)
      throw new Error("bench.json needs a canary of at least 16 characters.");
    this.bench = config.bench;
    this.canary = config.canary;
    this.cases = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("CASE-"))
      .map((entry) => entry.name)
      .sort()
      .map((id) => readCase(path.join(dir, id), id, this.canary));
    if (!this.cases.length) throw new Error(`${dir} holds no CASE- folders.`);
  }

  async describe(): Promise<CaseSet> {
    return {
      bench: this.bench,
      revision: digest({ bench: this.bench, canary: this.canary, cases: this.cases }),
      cases: this.cases.map((item) => item.summary),
    };
  }

  async request(caseId: string): Promise<CaseRequest> {
    return this.find(caseId).request;
  }

  async hidden(caseId: string): Promise<HiddenChecks> {
    return this.find(caseId).hidden;
  }

  tripwires(): string[] {
    return [this.canary, path.resolve(this.dir)];
  }

  /** The gold module a case's hidden checks must pass on, when the case has one. */
  gold(caseId: string): string | null {
    this.find(caseId);
    const dir = path.join(this.dir, caseId, "gold");
    return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
  }

  private find(caseId: string): PlainCase {
    const found = this.cases.find((item) => item.summary.id === caseId);
    if (!found) throw new Error(`No case ${caseId}.`);
    return found;
  }
}

interface SealedPart {
  iv: string;
  tag: string;
  data: string;
}

interface SealedFile {
  format: string;
  bench: string;
  revision: string;
  kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  cases: CaseSummary[];
  requests: SealedPart;
  tripwire: SealedPart;
  hidden: Record<string, SealedPart>;
}

const KDF = { N: 2 ** 15, r: 8, p: 1 };

function deriveKey(passphrase: string, kdf: SealedFile["kdf"]): Buffer {
  return scryptSync(passphrase.normalize("NFC"), Buffer.from(kdf.salt, "base64"), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * 1024 * 1024,
  });
}

/** The public header every sealed part is bound to. */
function header(file: Omit<SealedFile, "requests" | "tripwire" | "hidden">, part: string): Buffer {
  return Buffer.from(
    canonical({
      format: file.format,
      bench: file.bench,
      revision: file.revision,
      kdf: file.kdf,
      cases: file.cases,
      part,
    }),
  );
}

function seal(key: Buffer, aad: Buffer, plaintext: string): SealedPart {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function unseal(key: Buffer, aad: Buffer, part: SealedPart): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(part.iv, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(part.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(part.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Seals every case of a folder into one file, written owner-only. */
export async function sealCases(
  source: PlainVault,
  passphrase: string,
  out: string,
): Promise<CaseSet> {
  if (passphrase.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
  const set = await source.describe();
  const [canary] = source.tripwires();
  const requests: Record<string, CaseRequest> = {};
  const hidden: Record<string, HiddenChecks> = {};
  for (const item of set.cases) {
    requests[item.id] = await source.request(item.id);
    hidden[item.id] = await source.hidden(item.id);
  }
  const kdf = { name: "scrypt" as const, salt: randomBytes(16).toString("base64"), ...KDF };
  const key = deriveKey(passphrase, kdf);
  const head = {
    format: SEALED_FORMAT,
    bench: set.bench,
    revision: set.revision,
    kdf,
    cases: set.cases,
  };
  const file: SealedFile = {
    ...head,
    requests: seal(key, header(head, "requests"), JSON.stringify(requests)),
    tripwire: seal(key, header(head, "tripwire"), canary!),
    hidden: Object.fromEntries(
      set.cases.map((item) => [
        item.id,
        seal(key, header(head, `hidden:${item.id}`), JSON.stringify(hidden[item.id])),
      ]),
    ),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return set;
}

/** One sealed file, opened with its passphrase. */
export class SealedVault implements CaseVault {
  readonly sealed = true;
  private readonly file: SealedFile;
  private readonly key: Buffer;
  private readonly requests: Record<string, CaseRequest>;
  private readonly canary: string;

  /** Throws when the passphrase is wrong or the file was changed. */
  constructor(
    readonly store: string,
    passphrase: string,
  ) {
    const file = JSON.parse(fs.readFileSync(store, "utf8")) as SealedFile;
    if (file.format !== SEALED_FORMAT) throw new Error(`${store} is not a sealed activity bench.`);
    this.file = file;
    this.key = deriveKey(passphrase, file.kdf);
    try {
      this.requests = JSON.parse(unseal(this.key, header(file, "requests"), file.requests));
      this.canary = unseal(this.key, header(file, "tripwire"), file.tripwire);
    } catch {
      throw new Error("The passphrase does not open this bench, or the sealed file was changed.");
    }
  }

  async describe(): Promise<CaseSet> {
    return { bench: this.file.bench, revision: this.file.revision, cases: this.file.cases };
  }

  async request(caseId: string): Promise<CaseRequest> {
    const found = this.requests[caseId];
    if (!found) throw new Error(`No case ${caseId}.`);
    return found;
  }

  async hidden(caseId: string): Promise<HiddenChecks> {
    const part = this.file.hidden[caseId];
    if (!part) throw new Error(`No case ${caseId}.`);
    return JSON.parse(unseal(this.key, header(this.file, `hidden:${caseId}`), part));
  }

  tripwires(): string[] {
    return [this.canary, path.resolve(this.store)];
  }
}
