# Scene video fixes from review

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `activities`

Fixes for the review of the scene video pipeline:

- Cancelling a step of Improve stops it. Before, a cancelled composition or critique was started
  again, as if it had failed, which started another paid agent run.
- A timeline cut that ends after its recording is reported and stops a render. FFmpeg would have
  stopped at the recording's end while later cuts and fades counted on the time asked for.
- Refining a timeline gives the agent the storyboard frames where the edited timeline shows them,
  after its trims, cuts and fades, rather than where the recording had them.
- A saved version keeps a finished video's captions beside it, so restoring it brings them back.
- While a time field in the timeline editor does not read as seconds, the timeline cannot be
  saved, rendered or refined. Before, the last valid number could be saved instead.
- Improve stays available while the newest recording has not scored well. A good score for an
  older recording no longer disables it.
- A video whose check passed with warnings reads "Checked: some things are worth a look", and the
  Media step counts it among the videos that need a look.
