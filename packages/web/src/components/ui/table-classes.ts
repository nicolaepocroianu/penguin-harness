/**
 * The house table as classes, for a table laid out by hand: the same box, header strip and rules
 * the shared UI package's `Table` draws (packages/ui `data/table`), in the theme's tokens.
 */
export const TABLE_WRAP =
  "ui-frame overflow-x-auto overflow-y-clip rounded-md border border-line bg-surface";
export const TABLE = "w-full text-left text-sm";
export const TABLE_HEAD_ROW =
  "border-b border-line bg-surface-muted text-left text-xs text-fg-muted";
export const TH = "whitespace-nowrap px-3 py-2 font-medium";
export const TBODY = "[&>tr]:border-b [&>tr]:border-line-muted [&>tr:last-child]:border-b-0";
export const TD = "px-3 py-2 align-top";
/** A cell centred on its row, for a table whose rows hold controls that must line up across columns. */
export const TD_MIDDLE = "px-3 py-2 align-middle";
