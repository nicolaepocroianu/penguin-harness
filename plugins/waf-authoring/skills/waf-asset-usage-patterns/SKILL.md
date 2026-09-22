---
name: waf-asset-usage-patterns
description: Use when implementing or reviewing pipeline-generated WAF HTML modules that should render scene artwork from declared configuration-backed image, animation, and video assets instead of recreating those visuals with HTML or CSS.
---

# WAF Asset Usage Patterns

Use this skill when authoring or reviewing visual scene behavior in generated WAF HTML modules.

The goal is simple: scene artwork should come from the module's declared assets. HTML and CSS should provide structure, positioning, interaction, and lightweight state styling, not substitute illustrations.

## Source Of Truth

Treat the prepared activity spec, configuration-backed image/animation/video keys, and hydrated `data.assets` entries as the source of truth for scene visuals.

If a stage already has image, video, or animation asset keys:

- render those assets directly
- keep those keys stable
- in State machine modules, resolve the scene through `data.sceneCatalog.scene(sceneId)`;
  never copy its asset keys into TypeScript constants
- in legacy sequence modules only, reuse scaffolded stage metadata constants when present

Placeholder-backed assets created earlier in the pipeline still count as real assets. Use image, animation, and video placeholders through the real configuration key, even if the final generated media file will be replaced later.

## Core Rule

If a visual asset exists for a scene element, use the asset.

Do not recreate that same visual using:

- gradients
- borders as artwork
- box shadows as artwork
- pseudo-elements
- layered decorative divs
- generated labels or text standing in for image art
- CSS motion that pretends to be a provided animation or video

Use HTML and CSS only for:

- scene structure
- layout
- positioning
- hit targets
- spacing
- visibility toggles
- z-index layering
- highlight states
- simple overlays that sit on top of real artwork

## Backgrounds

When a stage has a background image asset, apply it as the background with a real asset-backed pattern such as:

```js
setMediaBackground(view.elements.root, resolveMediaAsset(data, 'background'));
```

or, in a legacy sequence module, with scaffolded stage metadata:

```js
setMediaBackground(view.elements.root, resolveMediaAsset(data, stage.backgroundAssetKey));
```

Do not build scenic backgrounds out of CSS gradients, rounded panels, cloud shapes, stripes, or decorative pseudo-elements when a background asset key already exists.

## Preloaded Definition / Theme Assets (do not re-hydrate)

Some assets are declared at the **definition / theme** level (for example the
activity cover / background such as `activity-cover`) rather than in the
per-stage configuration. These are **preloaded by the player** and delivered as
already-resolved entries in `data.assets`. Resolve and render them directly:

```js
// Background / cover: resolve + render directly, no hydration.
data.backgroundImageSource = resolveImageSource(
    resolveMediaAsset(data, data.backgroundAssetKey)
);
setMediaBackground(view.elements.root, resolveMediaAsset(data, data.backgroundAssetKey));
```

Do **not** pass definition/theme asset keys (e.g. the cover/background key) to
`data.hydrateSelectedAssets`. That function is only for **configuration-backed
stage asset keys**. Re-hydrating an already-resolved definition asset submits a
preloaded element (with no `type`/`url`) back to the typed asset loader and
produces a `No loader for type undefined ... at undefined` error and a
`Some assets failed to load.` failure.

Rules:

- Only hydrate **configuration-backed per-stage** asset keys.
- Hydrate one canonical representation for each logical asset, in this order:
  selected language, default language, definition asset. Do not pass every
  alias for the same URL to `data.hydrateSelectedAssets`.
- Keep an in-flight map in activity data so concurrent requests for the same
  logical asset share the same in-flight hydration promise. Remove failed or
  completed promises from that map, and mark an asset hydrated only on success.
- Cache reusable raw media operations by resolved media URL plus playback options,
  rather than by logical asset key, so two aliases cannot start duplicate loads.
- Prefer the scaffolded `hydrateStageAssets(data, stageMetadata,
  ACTIVITY_MANAGED_AUDIO_KEYS)` helper from `src/adapters/assets.ts` (or the
  legacy `.js` equivalent) for
  stage assets; do not invent an activity-shell hydration step that pushes the
  cover/background key through `hydrateSelectedAssets`.
- Render the theme cover/background via `resolveMediaAsset` +
  `setBackground` / a direct `<img src>` only.

## Scene Objects And Props

If the activity includes assets for characters, props, frames, buttons, cards, or other scene objects:

- create a structural element
- apply the real asset to that element
- keep CSS focused on sizing and placement

Preferred:

```js
const frogCard = htmlToElement('<div class="frog-card"></div>');
setMediaBackground(frogCard, resolveMediaAsset(data, 'frogCard'));
```

When a scene needs an actual `<img>` element, use a helper that accepts the
value returned by `resolveMediaAsset` as a URL string, a preloaded image
element, or an asset-like object with `url` or `src`. Do not assume image assets
are always preloaded `HTMLImageElement` instances.

Forbidden when `frogCard` exists as an asset:

```js
const frogCard = htmlToElement('<div class="frog-card">Frog</div>');
```

with CSS that draws the card, frame, and illustration through colors, borders, or gradients.

## Animations And Video

If a stage has animation or video assets:

- use the real configuration-backed image, animation, or video key
- wire it through the existing WAF animation or media helpers

Do not fake a provided animation with CSS keyframes, transform loops, or placeholder shimmer effects.

Do not fake a provided video with a static painted frame plus CSS transitions.

## Missing Asset Behavior

If the prose clearly requires a visual element but the available module inputs do not expose a matching asset or config key:

- stop and surface that mismatch in the implementation or review output
- do not invent replacement artwork in HTML/CSS

It is acceptable to leave structural hooks in place for a real asset that should exist, but it is not acceptable to draw a substitute scene illustration.

## Review Checklist

Before finishing, verify:

- every major scene visual maps to a real declared configuration-backed visual key when one exists
- backgrounds are asset-backed instead of CSS-simulated
- props and characters use image assets instead of decorative DOM art
- images, animations, and videos use their real keys from configuration
- CSS is structural and interactive, not illustrative
- definition/theme assets (e.g. the cover/background) are rendered directly and are NOT passed through `data.hydrateSelectedAssets`
