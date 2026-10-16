/**
 * Tables that stack when narrow. A table squeezed below the width its columns need breaks
 * its words instead of its layout: an asset key one character per line, a hint as a column
 * of single words. Below that width the same entries are laid out one row per entry, each
 * row carrying what the columns said as lines of its own.
 *
 * What decides is the width of the table's own box, measured, not the window's: opening a
 * side panel beside the work narrows the box while the window stays as it was.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export type TableLayout = "table" | "stacked";

/**
 * How a table lays out in a box this wide, given the width its columns need. A box not yet
 * measured (0) keeps the table, which is what a wide screen shows and what the first paint
 * would otherwise flash away from.
 */
export function tableLayout(width: number, needs: number): TableLayout {
  if (!(width > 0)) return "table";
  return width < needs ? "stacked" : "table";
}

/** The box to measure, and how its table lays out at the width it has now. */
export function useTableLayout<T extends HTMLElement>(
  needs: number,
): [RefObject<T | null>, TableLayout] {
  const box = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, tableLayout(width, needs)];
}
