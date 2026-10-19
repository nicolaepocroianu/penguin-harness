# Status words, gray text and the focus ring meet WCAG AA contrast, and the page is declared English

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`
- **PR:** pending

Fixes from the 2026-10-19 technical audit of the web app. Contrast was measured in the running app in both themes on the Activities list, an activity's studio, Chat, Agents, Models, Plugins, Usage, Benchmark and Machines, and no text there falls under 4.5:1.

## Details

- The page is declared English (`<html lang="en">`), and the document's language follows the active locale. Screen readers had been reading every English string with a Chinese voice.
- Status words (Saved, Validated, Blocked, Built, errors, warnings) are drawn in the 700 shades in light mode: emerald, amber and red now measure 5.4, 5.1 and 6.4:1 on white, up from 3.7, 3.2 and 4.8. A new `toneText` gives a muted status word the secondary text colour, and the hand-written exceptions for muted text at five call sites were removed.
- Error lines across the app take the danger tone instead of spelling `text-red-600` or `text-red-500` themselves.
- Gray text that used `text-gray-400` in light mode (2.6:1) or `dark:text-gray-500` in dark mode (4.0:1) uses the secondary text pair, gray-500 / gray-400. Icon-only buttons keep their lighter gray.
- Gray-500 text on gray-100 pills and tags, and the inactive options of chip groups and segmented controls, are gray-600 (6.9:1, up from 4.4). The counts beside the chip labels are no longer dimmed.
- The keyboard focus ring is a solid 2px gray-500 (gray-400 in dark mode), clearing 3:1 on every surface; the translucent ring it replaced measured 1.7:1. Seven resize handles and controls with their own faint ring use the same colours.
- On a phone, the Activities list shows each activity's status under its name instead of in a column that left the name a few pixels wide, and the page's buttons wrap instead of running off the screen.
- Opening a link straight to an activity shows the loading skeleton while the Project list loads, instead of "Select a Project to author activities."
- Every page except Chat loads its code on first visit. The main script went from 3.1 MB (949 KB gzipped) to 1.9 MB (576 KB).
- The 182 fixed pixel text sizes became `text-2xs` (11px) and `text-3xs` (10px), new steps of the type scale, or the existing `text-xs` and `text-sm`. They follow the font-size setting like the rest of the text, and the small and default settings render the two new steps at the same size as before. Two 9px counters inside fixed 14px badges stay in pixels.
