# Opening or saving a Loom product keeps everything Loom wrote

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `server`
- **PR:** [#166](https://github.com/nicolaepocroianu/penguin-harness/pull/166)

Opening a product Loom authored, and saving it afterwards, no longer loses Loom's data. Books suffered most. Their asset manifests lost the reader's own assets (intro video, page-turn sound, vocabulary, sound-out and inspector clips), the image labels and segment timings, and the keys of their word pronunciations. Every book's tags were wiped as well.

## Details

- `asset_manifest.json` is merged on every save instead of being rebuilt. Penguin reads only the assets it holds (those with `usages`) and the fields it uses, and writes its own back over them. Everything else goes back where it was: Loom's own assets, a book-reader role (kept even when Penguin plans an asset with the same key), `imageLabels`, `vocabulary`, `boldWords`, `segmentTimings`, `preserveSourceLayout`, `manifestOwned`, an image's `customized` and a word's `sourceKey`.
- What Penguin removes from the plan stays removed, and an asset Loom removes is never brought back. Loom's copy in `asset_manifest.loom.json`, taken when the ref was opened, only fills in Loom's fields on assets Penguin still holds. A key the file lists twice is read and written as its first entry.
- Opening a Loom ref also carries each narration's voice, each asset's description, and the keys Loom gave word pronunciations, which the module's configuration names. It also carries an image or clip the plan does not make, such as one only a scene's own fields name.
- A ref made from a template takes the template's Loom-only assets with it, moved to the new ref's media folder.
- A product's `activity_metadata.json` and a ref's are merged too, so `templateStable`, `runtime`, `deploymentName` and `deploymentSource` stay. Loom's tags stay in the file exactly as Loom wrote them until an author changes the product's tags. Penguin itself keeps the first 20 it accepts. A ref's `runtime` is removed when Penguin's specification for it is cleared.
- A ref made in Penguin now has what Loom needs to list it: an `activity_spec.json` (`{}` until there is a specification), an `asset_manifest.json`, and the module's `configurations/<pc>-<ref>.json`. Penguin no longer deletes an empty spec or manifest. A create that fails removes the configuration it made, and leaves one the module already had.
- A configuration edit is written to the module's file. The file's earlier content is kept, as text, and a discard puts it back exactly, even when it was not valid JSON. Edits saved before this change get the same treatment from their next save. The file is read and written under the draft's lock.
- An accepted narration's sidecar carries Loom's `generationFingerprint` for ElevenLabs and Gemini voices, made with the model and voice that actually spoke the clip. Loom keeps an ElevenLabs clip when its own model and voice match. It remakes a Penguin Gemini clip, because Penguin's Gemini model is not Loom's. Kokoro clips and the unresolved default ElevenLabs voice get no fingerprint.
- Deploy git commands refuse a module folder that is not the root of its own repository, as Loom does, so they never stage, stash, check out or clean a shared repository such as waf-modules (409 `module_shared_repository`). When git cannot answer, for example because it timed out, they refuse too (503 `module_repository_unknown`) and ask again next time. Penguin never makes a module repository inside another repository, in its own workspace or in an existing checkout.
- Still dropped when a ref is opened: the recording timings of a word pronunciation that do not match its script. The author is told when that happens, as before.
