# The Activity Spec read as scenes

- **Date:** 2026-10-09
- **Type:** feat
- **Scope:** `web`
- **PR:** [#92](https://github.com/nicolaepocroianu/penguin-harness/pull/92)

The Activity Spec opens as scenes once a spec is saved, with a Scenes | JSON switch beside its
title; the choice is remembered per browser. The scenes view shows the runtime as chips (engine,
layout, theme, resolution, assessment on or off), the description, the acceptance criteria with
an honest empty state, and one card per scene: its number, the script's name for it, how much
media it asks for, and inside, its narration lines and its media items with whether each has a
file once there is a media plan.

Each scene's narration is checked against the Activity Script: its lines are compared, word for
word and ignoring case and punctuation, with the `<audio>` lines under the same scene number in
the script. A scene says "Matches the script" or how many lines differ, and the Scenes heading
sums it up. A line that differs shows what the script says and offers "Use the script", which
writes the script's wording into the draft. A description that starts with a `usesAssessment=`
setting gets a notice with "Remove it". Both are ordinary unsaved edits: Diff shows them and
Save Spec saves them. Everything else is still edited in JSON, and Diff opens the JSON.
