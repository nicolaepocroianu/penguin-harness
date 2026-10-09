# The studio header's journey bar, and a proposal card that says how much changes

- **Date:** 2026-10-09
- **Type:** feat
- **Scope:** `web`

The activity header's progress steps are now one segmented bar with a fifth step, QA, read
from the same deploy state the Deploy section shows: deployed, deploying, deploy failed, or not
deployed. The first unfinished step stands out, and a "Next: …" button beside the bar goes
where that step is done: an unsaved script or spec to its editor, a spec that is a draft or
invalid to the Activity Spec, media without a plan or with clips still missing files to Scenes,
a module not yet built to the Stages panel, and an undeployed activity to Deploy. The Spec step
reads "draft, not validated" while the draft has not been validated.

The chat no longer shows the page context as a line of message text. A message sent after the
author moved used to end with "(I am now looking at Activity Spec.)"; that line, and the brief
the first message carries, now read as a small "Viewing …" chip above the bubble, in old
conversations too. The agent still receives the context. Beside the composer, the context is a
removable chip ("Context: Activity Spec"): taking it off sends the next message without the page
context, and it comes back for the message after.

The proposal card has a header with "Proposed changes" and how many of the changes are in
the draft already. Each change names what it touches and how much: lines changed, with the
script's scenes they fall in as links to the review, or a spec's fields changed. A change the
draft already holds carries an "In the draft" pill. While the script review is open, the card
shows a progress bar with how many changes are reviewed. The footer keeps Discard on the left,
still asking first, and "Apply N changes" on the right.
