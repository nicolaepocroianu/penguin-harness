---
name: waf-element-ids
description: Use when creating DOM elements in pipeline-generated WAF HTML modules so every meaningful element gets a stable, plain, unique id at creation time, making tap/long-press/key telemetry attributable instead of falling back to the activity root id.
---

# WAF Element IDs

Use this skill when authoring or editing any code in a pipeline-generated WAF HTML module that creates DOM elements — scene shells, backgrounds, choices, cards, characters, buttons, labels, and other hotspots.

The goal is simple: every meaningful on-screen element should carry a stable `id` so interaction telemetry can answer **"what did the learner interact with?"**.

## Why This Matters

The generated module already ships activity telemetry that timestamps and classifies every tap, long-press, and key event, then reports the target through `target.id`. That telemetry resolves the nearest id-bearing ancestor and, when nothing has an id, falls back to the activity root id.

If only the root element has an id and everything else is rendered with class names only, every in-activity interaction collapses to that single root id. Individual choices, props, and controls become indistinguishable in analytics.

Giving every meaningful element a stable id makes each interaction directly attributable end to end.

### Why not classes or `data-*`?

- **Classes are not unique.** Many elements share a class, so a class cannot identify which instance was used.
- **IDs are the natural target key.** Telemetry prefers `target.id`, and ids are unique within a document — exactly what analytics needs.
- **`data-*` is metadata, not identity.** It is fine for extra context, but the id is the primary, zero-plumbing handle.

## ID Convention

Use **plain, unprefixed names**. Do **not** namespace ids under the activity root, the module folder, or the product code. Pick names that are short, human-readable, and unique within the activity DOM at any given moment.

- **Structural / shell elements** get simple descriptive names: `scene`, `stage`, `backdrop`, `overlay`, `choices`, `prompt`.
- **Content elements** use their natural key — a value that already identifies the item, such as the displayed letter/word or a media asset key.
- **Child labels** extend the parent id, for example `${itemId}__label`.

Design rules:

- **Plain names, no prefix.** Keep ids free of the module id or product code.
- **Unique at render time.** Never duplicate an id among elements present in the DOM at the same moment. Typical activities mount one screen/round at a time, so per-screen names and distinct asset keys stay unique.
- **Case-preserving.** Treat `A` and `a` as different ids when case is semantically meaningful, such as letter activities.

> **Root exception:** The framework-provided mount point keeps the id declared in `res/layout.html` (the scaffold exposes it as the layout root id). Reference it through a single root-id constant for the mount lookup only, and do not reuse that id on other elements.

## How To Apply It

### The activity root

Keep the layout root id only for the mount lookup, then assign plain ids to everything you create inside it:

```js
view.elements.root = $('#' + ROOT_ID); // ROOT_ID matches res/layout.html
```

### Structural / shell elements

Assign a plain id as each element is created, before it is appended:

```js
scene.id = 'scene';
backdrop.id = 'backdrop';
choices.id = 'choices';
```

### Dynamic / content elements

Use the item's natural key as the id, and extend it for child labels:

```js
const itemId = choice.key; // a stable, unique value for this item
element.id = itemId;
labelElement.id = `${itemId}__label`;
```

When iterating over assessment choices or config-driven items, prefer the stable key already present on the item (an id, key, value text, or asset key) rather than an array index, so the same content keeps the same id across renders.

### Reusable helpers stay module-agnostic

Shared helpers must not hardcode activity-specific values. Pass the id (or the natural key) in rather than coupling the helper to one activity:

```js
function mountMedia(element, key) {
    element.id = key; // the caller supplies the natural key
}
```

### Telemetry resolves nested taps

Taps frequently land on a child node — an inner label, an `<img>`, an asset layer. The shipped telemetry already resolves the nearest ancestor-or-self that has an id:

```js
const idBearing = target.closest('[id]');
const id = (target.id || (idBearing && idBearing.id)) || null;
```

Your job is to make sure a sensible id exists to resolve to: give the interactive wrapper (or a close ancestor) a stable id so nested taps still attribute to a named element.

## Checklist

1. **Assign ids at creation time** — set the `id` before the element is appended.
2. **Use short, meaningful names** — descriptive for structural elements, a stable natural key for content elements.
3. **Guarantee uniqueness at render time** — never duplicate an id among elements present simultaneously.
4. **Keep reusable helpers module-agnostic** — pass ids/keys in instead of hardcoding activity-specific values.
5. **Make nested taps resolvable** — ensure interactive elements (or a close ancestor) carry an id so `target.closest('[id]')` lands on a named element.

### Do / Don't

- ✅ Do set ids the moment an element is created, before it is appended.
- ✅ Do use a stable, unique natural key where one exists.
- ✅ Do preserve case when it is semantically meaningful (letters, codes).
- ✅ Do give every interactive hotspot, choice, and control its own id.
- ❌ Don't rely on classes to identify a specific instance.
- ❌ Don't reuse the same id on two elements present at the same time.
- ❌ Don't couple shared/reusable helpers to activity-specific values.
- ❌ Don't namespace/prefix ids with the module id or product code.
- ❌ Don't leave interactive scene elements id-less, forcing telemetry to fall back to the root id.

## Final Self-Check

Before finishing:

- verify the layout root id is used only for the mount lookup
- verify every structural shell element has a plain, descriptive id
- verify every dynamic/content element has a stable natural-key id
- verify no id is duplicated among elements present at the same time
- verify every interactable (or a close id-bearing ancestor) is reachable by `target.closest('[id]')`
- verify reusable helpers receive ids/keys instead of hardcoding them
- verify no id is prefixed with the module id or product code

