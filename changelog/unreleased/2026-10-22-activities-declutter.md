# The Activities views say each thing once

- **Date:** 2026-10-22
- **Type:** refactor
- **Scope:** `web`

The Activities views lose what repeated something already on screen, and explanations that sat under a field or graph move behind the "?" beside its title. Nothing a view did is gone. The behavior map is now drawn the way Loom's state machine viewer draws it, in the Preview and in the State machine section.

## Details

- Preview: the behavior map's header is a title with a "?", Edit machine and a show/hide chevron; zoom and the scene choice sit on a second row only while a map is drawn, and the zoom level is the Fit button. The live tap targets are listed once, under the map, not also on the map's node. The machine's name for the current state is a hint on the status line instead of a line of its own. Pick keeps its width while picking, and its instruction shows in the status line. Open in a new tab is an icon, the resolutions read as their sizes, a failed rebuild shows its build log inside the alert, and the player frame drops its shadow.
- Open activity: a finished journey step shows its tick without its state word, which is still read out and shown on hover. The "Before QA" list drops its summary line and per-item icons. The file tree drops dots beside words that already name the state. The Stages summary names the running stage without a second count. Failed player scenarios have no Status column. History lists runs as rows, and Versions fits in five columns.
- Activities home: rows drop the milestone bar and the column headers, and the status names the milestones on hover. Group headers name Book only and no attention count, Refresh is an icon beside the title, and only a running status keeps a dot. The create dialog's field explanations move behind "?", the New ref view folds an asset's type into its second line, and the ref switcher says "stable" once.
- Behavior map: Loom's state machine layout is ported (`state-machine-graph.ts`, with its tests): lanes for the main flow and its detours, state cards with their start, next and live marks and the action or service they run, right-angled edges with their events in pills, and moves out of the scene as cards of their own. The live state's card carries its tap count; the targets themselves are listed once, as chips on the Preview's status line, which outline each target in the player. The raw "Leaves the scene" list is gone. Zoom runs from 25% to 150%, the map fits its column until zoomed, and the percentage fits it again.
- State machine section: a Diagram and JSON switch beside the title, opening on the diagram, which draws the machine the editor holds, unsaved edits included. When the text does not parse or fails the check, the last version that passed stays drawn under a note.
- History: a run's actions are small ghost buttons in one row, its candidate opens from that row, and a failed run shows the provider's message first, with the full error behind a disclosure. Versions keep one deploy line, hidden while nothing was deployed, and stack below 520px; module builds fit in three columns.
- Activities home: a product with a single ref is just its row, with its product code and ref number on its second line; group headers remain for products with two or more refs.
