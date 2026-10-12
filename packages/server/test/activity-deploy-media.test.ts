/**
 * Publishing a QA deploy's media: authored media is written straight into the media clone, so
 * a file the data names that is new or changed in the clone's working tree is to publish, one
 * the repository already has as it is is present, one outside the working tree but in the
 * repository's trees is present, and one found nowhere is named. The clone is the media
 * repository, so the data's `media/loom/...` is `loom/...` in it. The clone's git is a fake
 * that answers from memory; its folder is a temp dir.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncMedia } from "../src/activities/deploy-media.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function put(root: string, relative: string, content: string) {
  const file = path.join(root, ...relative.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/**
 * A media clone whose HEAD tree holds `tracked`, and whose working tree has `dirty` new or
 * changed; it records what it is asked.
 */
function fakeClone(tracked: string[], dirty: string[] = []) {
  const calls: string[][] = [];
  return {
    calls,
    clone: {
      async inHead(file: string) {
        calls.push(["inHead", file]);
        return tracked.includes(file);
      },
      async changed(file: string) {
        calls.push(["changed", file]);
        return dirty.includes(file);
      },
    },
  };
}

describe("deploy media", () => {
  it("publishes what is new or changed in the clone, keeps what the repository has, and names what is nowhere", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    // Untracked (a new take), modified (a take accepted again), and committed as it is.
    await put(clone, "loom/words/words-1/audios/english/new.mp3", "new sound");
    await put(clone, "loom/words/words-1/images/english/changed.png", "fixed");
    await put(clone, "loom/words/words-1/images/english/same.png", "same");
    const git = fakeClone(
      ["loom/words/words-1/images/english/same.png", "common/click.mp3"],
      [
        "loom/words/words-1/audios/english/new.mp3",
        "loom/words/words-1/images/english/changed.png",
      ],
    );
    const lines: string[] = [];
    const result = await syncMedia(
      {
        dir: clone,
        references: [
          "media/loom/words/words-1/audios/english/new.mp3",
          "media/loom/words/words-1/images/english/changed.png",
          "media/loom/words/words-1/images/english/same.png",
          // Outside the partial clone's folders, but in the repository's tree.
          "media/common/click.mp3",
          "media/loom/words/words-1/audios/english/gone.mp3",
        ],
      },
      { clone: git.clone, log: (text) => lines.push(text) },
    );
    expect(result).toEqual({
      copied: [
        "loom/words/words-1/audios/english/new.mp3",
        "loom/words/words-1/images/english/changed.png",
      ],
      missing: ["media/loom/words/words-1/audios/english/gone.mp3"],
      present: 2,
    });
    // A file in the working tree is asked about its status; one outside it, about HEAD's tree.
    expect(git.calls).toEqual([
      ["changed", "loom/words/words-1/audios/english/new.mp3"],
      ["changed", "loom/words/words-1/images/english/changed.png"],
      ["changed", "loom/words/words-1/images/english/same.png"],
      ["inHead", "common/click.mp3"],
      ["inHead", "loom/words/words-1/audios/english/gone.mp3"],
    ]);
    expect(lines.at(-1)).toBe("Media: 2 already in the repository, 2 to publish, 1 missing.");
    // Nothing in the clone is written or moved.
    expect(
      await fs.readFile(path.join(clone, "loom/words/words-1/audios/english/new.mp3"), "utf8"),
    ).toBe("new sound");
  });

  it("publishes an accepted file's sidecar with it, and a sidecar changed on its own", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    const audio = "loom/words/words-1/audios/english/hello";
    const image = "loom/words/words-1/images/english/cat";
    await put(clone, `${audio}.mp3`, "hello");
    await put(clone, `${audio}.json`, '{"text":"hello"}');
    await put(clone, `${image}.png`, "cat");
    await put(clone, `${image}.json`, '{"text":"a cat, redrawn"}');
    const git = fakeClone(
      [`${image}.png`, `${image}.json`],
      [`${audio}.mp3`, `${audio}.json`, `${image}.json`],
    );
    const result = await syncMedia(
      { dir: clone, references: [`media/${audio}.mp3`, `media/${image}.png`] },
      { clone: git.clone, log: () => {} },
    );
    expect(result).toEqual({
      copied: [`${audio}.mp3`, `${audio}.json`, `${image}.json`],
      missing: [],
      present: 1,
    });
  });

  it("counts a folder, not a file, in the working tree as not there", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    await fs.mkdir(path.join(clone, "loom", "words", "words-1", "images"), { recursive: true });
    const git = fakeClone([]);
    const result = await syncMedia(
      { dir: clone, references: ["media/loom/words/words-1/images"] },
      { clone: git.clone, log: () => {} },
    );
    expect(result.missing).toEqual(["media/loom/words/words-1/images"]);
  });

  it("names a reference outside the media folder or the clone as missing", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    await put(path.dirname(clone), "outside.mp3", "outside");
    dirs.push(path.join(path.dirname(clone), "outside.mp3"));
    const git = fakeClone([]);
    const result = await syncMedia(
      { dir: clone, references: ["media/../../outside.mp3", "other/a.mp3", "media/"] },
      { clone: git.clone, log: () => {} },
    );
    expect(result).toEqual({
      copied: [],
      missing: ["media/../../outside.mp3", "other/a.mp3", "media/"],
      present: 0,
    });
    // No status is asked of a file outside the clone.
    expect(git.calls.some((call) => call[0] === "changed")).toBe(false);
  });
});
