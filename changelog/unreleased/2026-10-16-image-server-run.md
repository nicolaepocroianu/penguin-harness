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
- The image prompt module was removed, with its entry in the activity bench's recipe surface, and
  the image entry of the run kinds' golden fixture recorded no prompt.
- The Stages panel said the images step had no session to show, instead of waiting for one. The
  media editor's help said the server makes images with Gemini, using `GEMINI_API_KEY` from the
  Media Agent's Vault, and starts no Session, and said the same of speech: Gemini or ElevenLabs
  with their keys from that Vault, or Kokoro on the server. The Agents page of the docs said images
  start no Media Agent Session.

## Time limits

- Image, speech and sound runs answered to the run time limit, as Session runs do: twenty minutes
  for an image (its helper's install and the helper, five minutes each, and as long again), and an
  hour for speech and sounds (a model on this machine works up to thirty minutes on a clip, and may
  wait as long for its turn). An admin's limit replaced these too, for runs already working.
- A run past its limit failed with it named ("The image run was stopped after 20 minutes, its
  time limit."), and its helper, or the model on this machine, was stopped the way Stop stops it.
  The outcome ledger recorded `limit: time` on its settled fact.
- `limits` and `failed` moved from the Session run-kind contract to every kind's. The settings'
  help for **Run time limit** said images, speech and sounds have limits of their own too.

## Image helper

- `generate-image.mjs` ended each failure with a line of its own, naming what failed and what to
  do: an `image-input.json` that is not a valid request, `GEMINI_API_KEY` not set, Gemini refusing
  the key (HTTP 401 or 403), a spent quota (HTTP 429), another refused request or a provider
  failure (with its HTTP status), a request that did not complete, an answer without a picture or
  cut short, and an answer that is not one PNG within the helper's bounds. It printed nothing of
  the provider's own words. A failed image run carried that line as its error.
- The staged helper's bytes changed, and with them its digest in the run kinds' golden fixture.
  The `agent-development` plugin's version became 2026.10.16.1.

## Sandbox

- Image, speech and sound runs were no longer refused with `sandbox_unavailable` while
  confinement is on and no sandbox can confine: no agent works on them, and the server runs only
  its own bundled helper or a model on this machine. The Skills page of the docs said so.
