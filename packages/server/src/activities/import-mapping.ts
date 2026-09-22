/**
 * Turning what Loom authored into what Penguin stores.
 *
 * #43 reads a Loom activity and reports what is there. This decides what Penguin would
 * make of it — and, as importantly, what it would have to drop.
 *
 * The dropping is the part that matters. An import that silently loses a ref's display
 * name, or quietly renames a language group it does not recognise, produces an activity
 * that looks imported and is not the one that was authored. Everything this cannot carry
 * is named, so the round-trip trial in this phase compares like with like rather than
 * discovering the gaps by eye.
 */
import { DEFAULT_LANGUAGE_CODE, findLanguage } from "./languages.js";

/** A Loom product, as the reader found it. */
export interface SourceProduct {
  productCode: string;
  moduleFolder: string;
  title: string | null;
  canonicalRefNum: number | null;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
}

/** A Loom ref, as the reader found it. */
export interface SourceRef {
  refNum: number;
  title: string | null;
  displayName: string | null;
  stable: boolean;
  spec: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  description: string;
  languages: string[];
}

/** What Penguin would create for the product. */
export interface MappedProduct {
  productCode: string;
  moduleFolder: string;
  canonicalRefNum: number;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
}

/** What Penguin would create for one ref. */
export interface MappedActivity {
  refNum: number;
  title: string;
  displayName: string | null;
  stable: boolean;
  description: string;
  spec: Record<string, unknown> | null;
  /** Language groups carried across, in order. */
  languages: string[];
}

export interface ImportMapping {
  product: MappedProduct;
  activities: MappedActivity[];
  /** What could not be carried, in an author's words. Empty means a clean import. */
  dropped: string[];
  /** What was repaired rather than dropped, so nobody mistakes it for fidelity. */
  repaired: string[];
}

/** A title Penguin can store, since it requires one and Loom does not. */
function titleFor(product: SourceProduct, ref: SourceRef): string {
  return ref.title?.trim() || product.title?.trim() || `${product.productCode}-${ref.refNum}`;
}

/**
 * What Penguin would make of a Loom product and its refs.
 *
 * Two repairs are applied rather than refused, because refusing would make most of the
 * real corpus unimportable, and both are recorded:
 *
 * A product naming a canonical ref that does not exist gets its lowest ref instead — the
 * same repair migration 18 makes for existing Penguin rows, and three real products need
 * it.
 *
 * A product with no title at all takes the ref's, or its address, because Penguin requires
 * one.
 */
export function mapImport(product: SourceProduct, refs: readonly SourceRef[]): ImportMapping {
  const dropped: string[] = [];
  const repaired: string[] = [];

  const numbers = refs.map((ref) => ref.refNum).sort((a, b) => a - b);
  let canonical = product.canonicalRefNum;
  if (canonical === null || !numbers.includes(canonical)) {
    const fallback = numbers[0] ?? 0;
    repaired.push(
      canonical === null
        ? `The product named no canonical ref; ref ${fallback} was taken as canonical.`
        : `The product named ref ${canonical} as canonical, which does not exist; ref ${fallback} was taken instead.`,
    );
    canonical = fallback;
  }

  const activities: MappedActivity[] = [];
  for (const ref of refs) {
    const languages: string[] = [];
    for (const code of ref.languages) {
      if (findLanguage(code)) languages.push(code);
      else
        dropped.push(
          `Ref ${ref.refNum} has a "${code}" language group, which this product does not support; its assets were not carried.`,
        );
    }
    if (!languages.includes(DEFAULT_LANGUAGE_CODE) && ref.manifest)
      dropped.push(
        `Ref ${ref.refNum} has no ${DEFAULT_LANGUAGE_CODE} group, so there is nothing to translate from.`,
      );
    if (!ref.spec) dropped.push(`Ref ${ref.refNum} has no specification to import.`);
    if (!ref.manifest) dropped.push(`Ref ${ref.refNum} has no asset manifest to import.`);
    if (!ref.description.trim())
      dropped.push(`Ref ${ref.refNum} has no description, so nothing records what it is for.`);

    const title = titleFor(product, ref);
    if (!ref.title?.trim() && !product.title?.trim())
      repaired.push(`Ref ${ref.refNum} had no title; "${title}" was used.`);

    activities.push({
      refNum: ref.refNum,
      title,
      displayName: ref.displayName,
      stable: ref.stable,
      description: ref.description,
      spec: ref.spec,
      languages,
    });
  }

  return {
    product: {
      productCode: product.productCode,
      moduleFolder: product.moduleFolder,
      canonicalRefNum: canonical,
      activityType: product.activityType,
      // Reported rather than invented: a book with no reading mode cannot be assembled,
      // and guessing one produces the wrong kind of book.
      bookMode: product.bookMode,
    },
    activities: activities.sort((a, b) => a.refNum - b.refNum),
    dropped,
    repaired,
  };
}

/** Whether this import would produce an activity faithful to what Loom held. */
export function importIsFaithful(mapping: ImportMapping): boolean {
  return mapping.dropped.length === 0;
}

/**
 * Whether a book product can actually be assembled after import.
 *
 * Asked separately because it is not a fidelity question: a book with no reading mode
 * imports perfectly and then cannot be built, and an author should learn that at import
 * rather than at assembly.
 */
export function assemblyBlockers(mapping: ImportMapping): string[] {
  if (mapping.product.activityType !== "book") return [];
  if (mapping.product.bookMode) return [];
  return [
    `${mapping.product.productCode} is a book with no reading mode recorded; choose decodable or read-along before assembling it.`,
  ];
}

/** One line about what an import would do. */
export function describeImport(mapping: ImportMapping): string {
  const count = mapping.activities.length;
  const parts = [
    `Importing ${mapping.product.productCode} with ${count} ${count === 1 ? "ref" : "refs"}, ref ${mapping.product.canonicalRefNum} canonical.`,
  ];
  if (mapping.repaired.length)
    parts.push(
      `${mapping.repaired.length} ${mapping.repaired.length === 1 ? "thing was" : "things were"} repaired: ${mapping.repaired.join(" ")}`,
    );
  if (mapping.dropped.length)
    parts.push(
      `${mapping.dropped.length} ${mapping.dropped.length === 1 ? "thing" : "things"} could not be carried: ${mapping.dropped.join(" ")}`,
    );
  else parts.push("Nothing was dropped.");
  return parts.join(" ");
}
