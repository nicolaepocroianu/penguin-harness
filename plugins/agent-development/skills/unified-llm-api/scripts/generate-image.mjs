import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";

// Draws one image candidate from image-input.json and writes it to image.png.
// A failure ends with one line of its own: what failed, and what to do about it. Whoever runs
// the helper shows that line as the failure. Never print upstream responses or error objects:
// they can contain request headers or credentials. Of a provider's error, only its HTTP status
// is printed.

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MODEL = "gemini-3.1-flash-image";

/** A failure whose message is the helper's last line. */
class Failure extends Error {
  constructor(reason) {
    super(`Image generation failed. ${reason} No candidate was accepted.`);
  }
}

function badOutput() {
  return new Failure(
    `Gemini's answer was not one PNG of at most 8 MiB and ${MAX_DIMENSION} × ${MAX_DIMENSION} pixels. Generate again.`,
  );
}

/** The line for an error the provider client threw while asking: of its words, only a status. */
function providerFailure(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  if (status === 401 || status === 403)
    return new Failure(
      `Gemini refused the Agent Vault GEMINI_API_KEY (HTTP ${status}). Check the key, and that its plan includes image generation, then generate again.`,
    );
  if (status === 429)
    return new Failure(
      "Gemini refused the request (HTTP 429): the key's quota or rate limit was reached. Wait, or raise the plan's limits, then generate again.",
    );
  if (status !== null && status >= 400 && status < 500)
    return new Failure(
      `Gemini refused the request (HTTP ${status}). Check the Agent Vault GEMINI_API_KEY and the image's description, then generate again.`,
    );
  if (status !== null)
    return new Failure(`Gemini failed to answer (HTTP ${status}). Generate again later.`);
  return new Failure(
    "The request to Gemini did not complete. Check this machine's network access to Gemini, then generate again.",
  );
}

function decodeInlineData(data) {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data, "base64");
  throw new Error("invalid image data");
}

function validatePng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) throw new Error("invalid png");
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("invalid png");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new Error("invalid dimensions");
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] || bytes[27] || bytes[28] > 1)
    throw new Error("invalid png header");
  let offset = 8;
  let data = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + size + 12;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("invalid png chunk");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if ((kind === "IHDR" && offset !== 8) || kind === "acTL") throw new Error("invalid png chunk");
    if (kind === "IDAT" && size) data = true;
    if (kind === "IEND") {
      if (size || !data || end !== bytes.length) throw new Error("invalid png end");
      ended = true;
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw new Error("incomplete png");
  return { width, height };
}

// Whether the provider is being asked: an error then is the provider's, told by its status.
let asking = false;
try {
  const input = await fs
    .readFile("image-input.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (
    input?.model !== MODEL ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 5000 ||
    !/^[a-z]{2}-[A-Z]{2}$/.test(input.language) ||
    typeof input.assetKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.assetKey) ||
    (input.style !== undefined && (typeof input.style !== "string" || input.style.length > 2000))
  )
    throw new Failure(
      "image-input.json is not a valid image request. Check that the image's description is 1 to 5000 characters, then generate again.",
    );
  if (!process.env.GEMINI_API_KEY)
    throw new Failure("GEMINI_API_KEY is not set. Add it to the Agent Vault, then generate again.");
  // Do not spend another provider request on a workspace that already has output.
  const existing = await fs.lstat("image.png").then(
    () => true,
    (error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  );
  if (existing)
    throw new Failure(
      "image.png is already in this workspace, so no request was sent. Generate again in a new workspace.",
    );
  const { AutoLLMClient } = await import("@prismshadow/agenthub").catch(() => {
    throw new Failure(
      "The provider client, @prismshadow/agenthub, is not installed here. Install package.json's dependencies, then generate again.",
    );
  });

  const client = new AutoLLMClient({ model: MODEL });
  const images = [];
  let completed = false;
  asking = true;
  for await (const event of client.streamingResponse({
    messages: [
      {
        role: "user",
        content_items: [
          {
            type: "text",
            // The asset key names the file, not the picture: left out so it is never drawn.
            text: `Create this image; any words in it are in ${input.language}:
${input.prompt}${input.style?.trim() ? `\n\nDraw it in this style:\n${input.style}` : ""}`,
          },
        ],
      },
    ],
    config: { image_config: { aspect_ratio: "1:1", image_size: "1K" } },
  })) {
    completed = event.finish_reason === "stop" && event.usage_metadata != null;
    for (const item of event.content_items ?? []) {
      if (item.type !== "inline_data") continue;
      if (!/^image\/png(?:;|$)/i.test(item.mime_type ?? "")) throw badOutput();
      try {
        images.push(decodeInlineData(item.data));
      } catch {
        throw badOutput();
      }
      if (images.length > 1 || images[0].length > MAX_BYTES) throw badOutput();
    }
  }
  asking = false;
  if (!images.length)
    throw new Failure(
      "Gemini answered without a picture, as it does when it declines a description. Reword the image's description, then generate again.",
    );
  if (!completed)
    throw new Failure("Gemini's answer ended before it was complete. Generate again.");
  try {
    validatePng(images[0]);
  } catch {
    throw badOutput();
  }
  await fs.writeFile("image.png", images[0], { flag: "wx" }).catch(() => {
    throw new Failure(
      "image.png could not be written to this workspace. Check its disk space and permissions, then generate again.",
    );
  });
  process.stdout.write("Image candidate written to image.png. Inspect before accepting.\n");
} catch (error) {
  let failure;
  if (error instanceof Failure) failure = error;
  else if (asking) failure = providerFailure(error);
  else failure = new Failure("The helper stopped unexpectedly. Generate again.");
  process.stderr.write(`${failure.message}\n`);
  process.exitCode = 1;
}
