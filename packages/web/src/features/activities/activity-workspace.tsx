/**
 * The activity workspace shell: a pinned header, a rail and a detail pane that fill the
 * viewport and scroll separately, so the page itself never scrolls.
 *
 * Height comes from the app shell, which hands a page a `min-h-0 flex-1 overflow-hidden`
 * main element; this fills it with `h-full` and each pane owns its own scrolling, which
 * is the same contract the chat page keeps. The divider follows the workspace file
 * browser's: a real `separator` that drags and also moves by keyboard, with its width
 * remembered only on release rather than on every frame.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Chevron } from "../../components/ui/chevron";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  clampRailWidth,
  railWidthAfterKey,
  railWidthFor,
  readRailCollapsed,
  readRailWidth,
  writeRailCollapsed,
  writeRailWidth,
} from "./workspace-model";

export function ActivityWorkspace({
  header,
  notices,
  rail,
  children,
}: {
  header: ReactNode;
  /** Banners that belong to the whole activity, under the header and above the panes. */
  notices?: ReactNode;
  rail: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => readRailWidth());
  const [collapsed, setCollapsed] = useState(() => readRailCollapsed());
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The rail gives way on a narrow window rather than squeezing the editor past the
  // point where it can show two previews side by side.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setAvailable(body.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const applied = collapsed ? 0 : railWidthFor(width, available);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (collapsed) return;
      const body = bodyRef.current;
      if (!body) return;
      event.preventDefault();
      setDragging(true);
      const left = body.getBoundingClientRect().left;
      const move = (point: PointerEvent) => setWidth(clampRailWidth(point.clientX - left));
      const done = (point: PointerEvent) => {
        const next = clampRailWidth(point.clientX - left);
        setWidth(next);
        writeRailWidth(next);
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", done);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", done);
    },
    [collapsed],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = railWidthAfterKey(width, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    setWidth(next);
    writeRailWidth(next);
  }

  function toggle() {
    setCollapsed((current) => {
      writeRailCollapsed(!current);
      return !current;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        {header}
      </div>
      {notices && (
        <div className="shrink-0 space-y-2 border-b border-gray-200 px-4 py-2 empty:hidden dark:border-gray-800">
          {notices}
        </div>
      )}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div
          style={collapsed ? undefined : { width: `${applied}px` }}
          className={`flex min-h-0 shrink-0 flex-col border-gray-200 dark:border-gray-800 ${
            collapsed ? "w-auto border-r" : ""
          }`}
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">
                {S.activities.workspaceRail}
              </span>
            )}
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? S.activities.railExpand : S.activities.railCollapse}
              title={collapsed ? S.activities.railExpand : S.activities.railCollapse}
              onClick={toggle}
              className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Chevron
                open={false}
                size={ICON_SIZE.chevronDense}
                className={`text-gray-500 ${collapsed ? "" : "rotate-180"}`}
              />
            </button>
          </div>
          {!collapsed && rail}
        </div>
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={S.activities.railWidth}
            aria-valuenow={applied}
            aria-valuemin={RAIL_MIN_WIDTH}
            aria-valuemax={RAIL_MAX_WIDTH}
            title={S.activities.railWidth}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className={`w-1.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
              dragging
                ? "bg-gray-300 dark:bg-gray-600"
                : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          />
        )}
        {children}
      </div>
    </div>
  );
}
