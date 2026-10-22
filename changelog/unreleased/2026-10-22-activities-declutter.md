# The Activities views say each thing once

- **Date:** 2026-10-22
- **Type:** refactor
- **Scope:** `web`

The Activities views lose what repeated something already on screen, and explanations that sat under a field or graph move behind the "?" beside its title. Nothing a view did is gone.

## Details

- Preview: the behavior map's header is a title with a "?", Edit machine and a show/hide chevron; zoom and the scene choice sit on a second row only while a map is drawn, and the zoom level is the Fit button. The live tap targets are listed once, under the map, not also on the map's node. The machine's name for the current state is a hint on the status line instead of a line of its own. Pick keeps its width while picking, and its instruction shows in the status line. Open in a new tab is an icon, the resolutions read as their sizes, a failed rebuild shows its build log inside the alert, and the player frame drops its shadow.
- Open activity: a finished journey step shows its tick without its state word, which is still read out and shown on hover. The "Before QA" list drops its summary line and per-item icons. The file tree drops dots beside words that already name the state. The Stages summary names the running stage without a second count. Failed player scenarios have no Status column. History lists runs as rows, and Versions fits in five columns.
- Activities home: rows drop the milestone bar and the column headers, and the status names the milestones on hover. Group headers name Book only and no attention count, Refresh is an icon beside the title, and only a running status keeps a dot. The create dialog's field explanations move behind "?", the New ref view folds an asset's type into its second line, and the ref switcher says "stable" once.
