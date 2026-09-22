/** Pure helpers behind the Import from Loom dialog. */

/** One product the WAF checkout offers, as far as the dialog shows it. */
export interface ImportSource {
  product: { productCode: string; moduleFolder: string; title: string | null };
  refs: { refNum: number }[];
  problems: string[];
}

export interface ImportSources {
  /** Null when there is no WAF checkout to read. */
  modulesDir: string | null;
  products: ImportSource[];
}

/** The products matching a search over title, product code and module folder, in order. */
export function filterImportSources(items: readonly ImportSource[], query: string): ImportSource[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.product.title ?? "", item.product.productCode, item.product.moduleFolder].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}
