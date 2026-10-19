# Opening or saving a Loom product keeps everything Loom wrote

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `server`
- **PR:** pending

Opening a product Loom authored, and saving it afterwards, no longer loses Loom's data. Books suffered most. Their asset manifests lost the reader's own assets (intro video, page-turn sound, vocabulary, sound-out and inspector clips), the image labels and segment timings, and the keys of their word pronunciations. Every book's tags were wiped as well.

## Details

- `asset_manifest.json` is merged on every save instead of being rebuilt. Penguin reads only the assets and fields it uses, and writes its own back over them. It puts every asset role and field it does not use back where it was, so that includes `imageLabels`, `vocabulary`, `boldWords`, `segmentTimings`, `preserveSourceLayout`, `manifestOwned`, an image's `customized` and a word's `sourceKey`. Loom's copy in `asset_manifest.loom.json` is still kept.
- Opening a Loom ref also carries each narration's voice, each asset's description, and the keys Loom gave word pronunciations, which the module's configuration names. It also carries an image or clip the plan does not make, such as one only a scene's own fields name.
- A product's `activity_metadata.json` and a ref's are merged too, so `templateStable`, `runtime`, `deploymentName` and `deploymentSource` stay. Loom's tags become the product's when it is opened.
- A ref made in Penguin now has what Loom needs to list it: an `activity_spec.json` (`{}` until there is a specification), an `asset_manifest.json`, and the module's `configurations/<pc>-<ref>.json`. Penguin no longer deletes an empty spec or manifest. A configuration edit is written to the module's file, and discarding the edit puts the file back as it was.
- An accepted narration's sidecar carries Loom's `generationFingerprint` for ElevenLabs and Gemini voices, so Loom no longer remakes those clips. Kokoro clips have none, since Penguin and Loom run Kokoro through different engines.
- Deploy git commands refuse a module folder that is not the root of its own repository, as Loom does, so they never stage, stash, check out or clean a shared repository such as waf-modules (409 `module_shared_repository`). Penguin also never makes a module repository inside another repository.
- Still dropped when a ref is opened: the recording timings of a word pronunciation that do not match its script. The author is told when that happens, as before.
