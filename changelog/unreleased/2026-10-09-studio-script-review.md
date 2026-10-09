# A scene-aware Activity Script, and reviewing the agent's changes one by one

- **Date:** 2026-10-09
- **Type:** feat
- **Scope:** `web`

The Activity Script now reads as narration and footage rather than markup. Away from the
cursor, an element's opening tag shows as a small mark ("Says", "Video") in that element's hue,
and its closing tag is hidden. On the line being edited, and on every line of a selection, the
tags show as written.

When a line's words match a clip in the media plan, the line ends with that clip's state: its
length if it has a file, or "Needs a file". Clicking the chip opens the clip in Scenes. Each
scene heading says how much media the scene asks for and how much still has no file. A line
that matches no clip shows nothing, so the editor never guesses. A status bar under the editor
shows the current scene and line, the word count, an estimate of the narration's length, and
how many clips have files.

The header's single draft pill becomes four progress steps: Script, Spec, Media and Module.
Each step says where it stands and opens its section. When the agent has proposed a script,
a "Proposal waiting" chip opens the review.

Comparing against the agent's proposal is now a review. Each change has Accept and Reject
where it stands. Previous and next buttons move between changes, and "Reject the rest" and
"Accept the rest" decide the remaining ones. Changes left undecided count as accepted. Applying
saves the script as the review left it. A proposal that changed only the script is then set
aside, and one with other changes stays open for them. The chat's proposal card links to the
review, and to each scene it changes, and shows how many changes are left.

The chat composer shows what the agent will be told the author is looking at as a scope chip,
and offers a few questions to start from for the script, the spec, or a media asset.
