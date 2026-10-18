/**
 * The wheel's zoom gesture, read here with the other modifier reads (the shortcut guard keeps
 * `ctrlKey` / `metaKey` under lib/shortcuts/). A trackpad pinch arrives as a wheel event with
 * `ctrlKey` set on every platform, and a mouse wheel turned with Ctrl or ⌘ held means the same:
 * zoom the surface under the pointer rather than scroll it. Not a chord, so nothing to rebind.
 */
export function isZoomWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}
