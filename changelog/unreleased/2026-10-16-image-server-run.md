# Images are generated without an agent

- **Date:** 2026-10-16
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#156](https://github.com/nicolaepocroianu/penguin-harness/pull/156)

An image no longer starts a Media Agent Session. The server runs the staged `generate-image.mjs`
helper itself, in the run's workspace, with the Media Agent's Vault as the helper's only source of
provider keys, as it already did for [speech and sounds](2026-10-08-deterministic-audio.md). That
holds for each image of the Stages' images step and for a single **Generate** in the media editor.
The helper's agenthub is linked in from the install kept under `<data root>/media-helper-cache`,
the same one Gemini narrations and hub sound models use, instead of being installed again in every
image's workspace.

## Details

- The run staged what it did before: `image-input.json` with the house style, `package.json`,
  `generate-image.mjs`, `input.json` and `description.md`. The candidate was stored, previewed,
  accepted and refused as before, and a draft edited mid-run was still a conflict.
- A Media Agent Vault without `GEMINI_API_KEY` was still refused with `image_credential_missing`,
  and the Stages still skipped the images step for it.
- A failed run carried the helper's own last line. A helper that wrote no picture failed with
  "The generate-image.mjs helper ended without image.png." Stopping the run stopped the helper.
- An image run recorded no `sessionId`, and the outcome ledger named its runtime
  `helper:generate-image.mjs`. Image runs recorded with a Media Agent Session stayed readable as
  they were.
- The run time limits no longer applied to an image run (its own twenty minutes, or an admin's
  limit): like a speech or sound run, it ended at the helper's own timeouts, five minutes for the
  install and five for the helper.
- The image prompt module was removed, with its entry in the activity bench's recipe surface, and
  the image entry of the run kinds' golden fixture recorded no prompt.
- The Stages panel said the images step had no session to show, instead of waiting for one. The
  media editor's help said the server makes images with Gemini, using `GEMINI_API_KEY` from the
  Media Agent's Vault, and starts no Session. The Agents page of the docs said images start no
  Media Agent Session.
