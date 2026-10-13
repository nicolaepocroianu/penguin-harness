/**
 * A draft cut into the parts the ledger follows one by one: the script, the specification, each
 * asset of the media plan per language, the rest of the plan, and each module document an author
 * edited. A part is held as its canonical JSON only while a change is witnessed; what is kept is
 * its digest and size, never its text.
 */
import { canonical, type ActivityDraft } from "./domain.js";

function bytesOf(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonical(value)), "utf8");
}

/** A draft's parts by name, each as the bytes of its canonical JSON. */
export function draftParts(draft: ActivityDraft): Map<string, Buffer> {
  const parts = new Map<string, Buffer>();
  parts.set("script", bytesOf(draft.description));
  if (draft.spec) parts.set("spec", bytesOf(draft.spec));
  if (draft.mediaPlan) {
    const { manifest, ...plan } = draft.mediaPlan;
    const { assets, ...rest } = manifest;
    parts.set("media", bytesOf({ ...plan, manifest: rest }));
    for (const [language, group] of Object.entries(assets))
      for (const asset of group) parts.set(`media/${language}/${asset.key}`, bytesOf(asset));
  }
  for (const [kind, document] of Object.entries(draft.moduleDocuments ?? {}))
    if (document) parts.set(`document/${kind}`, bytesOf(document.value));
  return parts;
}

/**
 * How many bytes a change rewrote: everything between what the two versions share at their start
 * and at their end. Never less than the change in size.
 */
export function changedBytes(before: Buffer, after: Buffer): number {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end])
    end++;
  return Math.max(before.length, after.length) - start - end;
}
