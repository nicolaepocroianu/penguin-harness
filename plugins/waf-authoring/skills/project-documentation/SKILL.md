---
name: project-documentation
description: Use when implementing activities/modules
---

# AGENTS.md — WAF (Waterford Activity Framework)

## Architecture Overview

WAF is a **monorepo** for educational activity delivery:

| Directory | Role |
|---|---|
| `framework/` | Core activity player — loads modules into layouts, manages lifecycle and assessment |
| `modules/waf-module-*` | Individual activity modules loaded at runtime by the framework |
| `media/` | Git LFS repo of images, audio, video, fonts shared via `{{MEDIA}}` URL tokens |
| `dev-sandbox/` | Local preview server at `localhost:4100` — bundles framework + modules |
| `waf-loom/` | AI-assisted activity creation pipeline (FastAPI + Angular) |

---

## Module System

### Module File Structure

```
modules/waf-module-<name>/
├── definition.json       # Module manifest (id, engine, require, themes, assets)
├── package.json
├── src/
│   ├── index.js          # Entry point: bootstraps sequence
│   ├── sequence.js       # Activity flow as middleware pipeline
│   └── helpers.js        # Optional helper utilities
├── res/
│   ├── layout.html       # Module's HTML template
│   └── style.scss        # Source styles
├── configurations/       # Activity-variant configs (JSON with {{MEDIA}} tokens)
└── assessments/          # Assessment definitions (items, scoring)
```

### Module `definition.json`

Key fields:

| Field | Purpose | Example |
|---|---|---|
| `id` | Module identifier (used as config key) | `"vt1amphibians"` |
| `specificationVersion` | Always `"2.0.0"` for current modules | |
| `engine` | `"html"` | |
| `require` | Assets loaded before init: `entry` (JS), `layout` (HTML), `style` (CSS) | |
| `themes` | Named themes with `assets` containing `{{MEDIA}}` URLs | |

Example:
```json
{
    "id": "vt1amphibians",
    "specificationVersion": "2.0.0",
    "require": {
        "entry": { "type": "javascript", "url": "entry.js" },
        "layout": { "type": "html", "url": "layout.html" },
        "style": { "type": "css", "url": "style.css" }
    },
    "themes": {
        "park": {
            "ids": ["park"],
            "assets": {
                "background": { "type": "image", "url": "{{MEDIA}}/images/modules/vt1amphibians/background.png" },
                "click": { "type": "audio", "url": "{{MEDIA}}/audio/modules/vt1amphibians/click.mp3" }
            }
        }
    }
}
```

### Internal NPM Packages

- `waf-sequence` — Step-based sequence runner (`bootstrapSequence`, `waitingForInput`, `endActivity`)
- `waf-utils` — DOM helpers (`$`, `htmlToElement`, `setBackground`, `show`, `hide`), audio helpers (`createAudioEvents`, `setRepeatAudio`)
- `pubsubsingleton` — Shared PubSub instance
- `input-manager-system` — `Interactable`, `inputManager`, `inputEventTypes` for user input

---

## Activity Bootstrap Patterns

New machine-driven modules use TypeScript and the internal
`waf-state-machine` package. Legacy modules continue to use `waf-sequence`.

**Machine entry point (`src/index.ts`):**
```typescript
import { bootstrapStateMachine } from 'waf-state-machine';
import { createStateMachineImplementations } from './activity';
bootstrapStateMachine({
    createImplementations: createStateMachineImplementations,
    rootId: 'module-example',
});
```

The machine graph comes from the active ref configuration. Do not import a
module-level machine JSON file.

Legacy `waf-sequence` bootstrap:

**Entry point (`src/index.js`):**
```javascript
import { bootstrapSequence } from 'waf-sequence';
import sequence from './sequence';
bootstrapSequence(sequence);
```

`bootstrapSequence()` handles registration, asset loading, readiness signaling, then runs the exported `Sequence`.

**Sequence definition (`src/sequence.js`):**

Each step is a function with signature `({ data, next, exit }) => { ... }`. Steps compose into `new Sequence([...])`:

```javascript
export default new Sequence([
    initialize,
    renderBackground,
    playIntro,
    [                                  // ← Loop (repeats until exit() called)
        playQuestion,
        waitingForInput,
        processAnswer,
        exitIfCompleted,
    ],
    playOutro,
    endActivity,
]);
```

### Sequence Composition

| Syntax | Meaning |
|---|---|
| `[step1, step2, step3]` at top level | Flat sequential steps |
| Nested array inside top-level array | **Loop**: repeats until a step calls `exit()` |
| `{ check: fn, true: [...], false: [...] }` | **Conditional branch** |

### The `data` Object

Shared mutable state passed to every step. Populated by `waf-sequence` with:
- `pubSub` — PubSub instance
- `configuration` — module config from `configurations/*.json`
- `assets` — preloaded theme assets from `definition.json`
- `user` — student info
- `assessmentItem` — current assessment item (if assessed)
- `isCompleted` — set when assessment signals complete

Steps add their own fields (e.g., `userAnswers`, `score`, `choiceItems`).

### Key waf-sequence Helpers

| Helper | Purpose |
|---|---|
| `awaitAssessmentItemOrComplete` | Pauses until an assessment item arrives or assessment completes |
| `waitingForInput` | Publishes `activity:waitingForInput`, pauses until `next()` called from interaction |
| `endActivity` | Publishes `end:nextActivity` to signal completion |
| `exitIfCompleted` | Calls `exit()` if `data.isCompleted`, else `next()` |
| `view` | DOM manager: `view.render('root', { element })`, `view.remove('el')`, `view.removeAsMiddleware('el')` |
| `handleTimeoutSubscribe` / `timeoutUnsubscribe` | Subscribe/unsubscribe to timeout events for scaffolding |

---

## Common Step Function Patterns

### initialize
```javascript
function initialize({ data, next }) {
    Object.assign(view.elements, { root: $('#module-<id>') });
    Object.assign(data, { userAnswers: [], score: 0 });
    next();
}
```

### renderBackground
```javascript
function renderBackground({ data, next }) {
    setBackground(view.elements.root, data.assets.background);
    next();
}
```

### renderChoices (Interactive Elements)
```javascript
function renderChoices({ data, next }) {
    const { simpleChoice } = data.assessmentItem.itemConfiguration;
    const items = simpleChoice.map(({ id, isCorrect, score, value }) => {
        const element = htmlToElement('<div class="choice"></div>');
        setBackground(element, value.image);
        const interactable = new Interactable(element, inputEventTypes.SELECT_CLICK);
        interactable.onSelect = async () => {
            inputManager.lock();
            data.userAnswers.push({ id, isCorrect, score, value: value.text });
            // Publish the answerSubmitted event
            data.pubSub.publish('activity:answerSubmitted', {
                answer: {
                    id,
                    isCorrect,
                    value: value.text
                }
            });
            next();
        };
        return { element, interactable };
    });
    view.render('root', { choiceItems: items.map(i => i.element) });
}
```
**Required:** every `interactable.onSelect` that records a choice MUST publish
`activity:answerSubmitted` with `{ answer: { id, isCorrect, value } }` **inside the
handler**, immediately after recording the answer and before `next()`. This event
feeds telemetry at selection time — do **not** move it into
`submitSimpleChoiceResponse` / `submitSimpleChoiceAssessmentResponse`, which runs
later (or not at all, on early exit).

### Audio Playback
```javascript
async function playQuestion({ data, next }) {
    const { speech } = data.assessmentItem.itemConfiguration.question;
    await speech.playAsync();
    next();
}
```

### submitSimpleChoiceResponse
```javascript
function submitSimpleChoiceResponse({ data, next }) {
    const { pubSub, assessmentItem: { itemScoreId }, userAnswers: [{ id, value }] } = data;
    pubSub.publish(EVENTS.assessmentItemService.submitResponse, [{
        choice_id: String(id),
        choice_value: value,
        item_score_id: String(itemScoreId),
    }]);
    data.userAnswers = [];
    data.assessmentItem = null;
    next();
}
```

### exitIfCompleted
```javascript
function exitIfCompleted({ data, next, exit }) {
    if (data.isCompleted) return exit();
    next();
}
```

---

## Timeout and Scaffolding

Timeout system for student inactivity:
- **Level 1–2**: Module can play hints/highlight correct answers
- **Level 3**: Framework shows "ask your teacher" overlay

Typical pattern:
```javascript
const timeoutSubscribe = handleTimeoutSubscribe(
    (level, data) => level === 2 && highlightCorrectAnswer(data)
);

// In sequence:
[playQuestion, timeoutSubscribe, waitingForInput, timeoutUnsubscribe, ...]
```

---

## Asset and Configuration Data Flow

### Three Sources of Module Data

| Source | What It Provides | When Resolved |
|---|---|---|
| `definition.json` theme assets | Static shared assets (SFX, module-level UI assets) | **Preloaded** before `initialize()` — available as `data.assets` |
| `configurations/*.json` | Per-variant data (image URLs, animation URLs/configs, video URLs, audio URLs, positions, timing) | Passed as `data.configuration` at init |
| `assessments/*.json` | Per-item scoring data (questions, choices with media) | Delivered at runtime via `assessmentItemService` events |

### Theme Assets (Preloaded)

Theme assets in `definition.json` are downloaded before the module starts. Available on `data.assets`:
```javascript
setBackground(view.elements.root, data.assets.background);  // HTMLImageElement
```

Use for: shared SFX, sprites, and module-level UI assets — anything the same across all activity variants.

Do not use `definition.json` theme assets for generated activity image, animation, or video URLs; keep those in configuration so refs can carry their own media.

### Configuration (Per-Variant)

Configuration from `configurations/<variant>.json` is available as `data.configuration`:
```javascript
const videoUrl = data.configuration.introVideo1;
const questionData = data.configuration.questions[data.assessmentItem.title];
```

Use for: image URLs, animation URLs/configs, video URLs, per-question positions, scaffolding audio, timing data, and any other runtime media that should not be preloaded as theme assets.

**Important:** Configuration URLs are NOT preloaded. Load them on demand (speech via `.playAsync()`, video via `Activity.Media.Audio.getVideo()`, images via `setBackground()`).

### Assessment Items (Runtime)

Assessment items arrive via `data.assessmentItem` after `awaitAssessmentItemOrComplete`:
```javascript
const { simpleChoice } = data.assessmentItem.itemConfiguration;
const { speech } = data.assessmentItem.itemConfiguration.question;
```

### Configuration File Format

For non-assessed modules, configuration is the sole source of activity-specific content:
```json
{
    "calendar-test": {
        "intro_narration": "{{MEDIA}}/audio/activities/calendar-test/intro.mp3",
        "prompt_audio": "{{MEDIA}}/audio/activities/calendar-test/prompt.mp3",
        "video_intro": "{{MEDIA}}/videos/activities/calendar-test/intro.mp4"
    }
}
```

Configuration keys are correlated with assessment item titles by convention (e.g., both use `m1pc207-1-1`):
```javascript
const questionConfig = data.configuration.questions[data.assessmentItem.title];
```

---

## Assessment System

### Assessment File Structure

```json
{
    "title": "m1pc207-1",
    "behavior": "LINEAR",
    "configuration": { "maxItems": 4, "nextItemsSize": 1 },
    "items": [
        {
            "title": "m1pc207-1-1",
            "interactionKey": "SIMPLE_CHOICE",
            "configuration": {
                "question": { "text": "", "speech": { "customClipUrl": "{{MEDIA}}/..." } },
                "simpleChoice": [
                    { "id": "1", "isCorrect": true, "score": 1, "value": { "text": "newt" } },
                    { "id": "2", "isCorrect": false, "score": 0, "value": { "text": "racoon" } }
                ]
            }
        }
    ]
}
```

### Supported Interaction Types

| Key | Config Field | Example Module |
|---|---|---|
| `SIMPLE_CHOICE` | `simpleChoice` | `vt1amphibians` |
| `ASSOCIATE` | `associate` | `vt1additionsentencespractice` |
| `ORDER` | `order` | `printdirectionalityassessment` |
| `INLINE_CHOICE` | `inlineChoice` | |
| `MULTIPLE_RESPONSE_CHOICE` | `multipleResponseChoice` | |
| `TEXT_ENTRY` | `textEntry` | |

### Assessment Response Formats

- **simpleChoice**: `[{ item_score_id, choice_id, choice_value }]`
- **associate**: `[{ item_score_id, choices: [{ choice_id, choice_value }, ...] }]`
- **order**: `[{ item_score_id, ordered_keys: ["key1", "key2", ...] }]`

---

## Activity Lifecycle (Summary)

1. Framework loads layout and module assets
2. Module's `initialize()` is called with `pubSub`, `declaration` (with loaded assets), `config`, `user`
3. For waf-sequence: `bootstrapSequence` stores everything on `data` and runs the sequence
4. Module signals readiness (handled by waf-sequence automatically)
5. Framework publishes `activity:start` → sequence begins
6. Module interacts, plays media, waits for input
7. Module signals `end:nextActivity` (via `endActivity`) when done

---

## PubSub Events (Key Events)

| Event | Purpose |
|---|---|
| `activity:start` | Activity has started — module begins |
| `activity:pause` | Activity paused (e.g. pause overlay) — pause CSS/Web-Animations manually |
| `activity:resume` | Activity resumed — restart animations paused on `activity:pause` |
| `activity:waitingForInput` | Module waiting for user (starts timeout) |
| `activity:receivedInput` | User interacted (resets timeout) |
| `activity:timeout` | Timeout fired with `{ level }` |
| `end:nextActivity` | Module signals completion |
| `assessmentItemService:assessmentItem` | Assessment item delivered |
| `assessmentItemService.submitResponse` | Module submits response |
| `assessmentItemService:assessmentComplete` | All items done |
| `audioService.play` | Play audio |
| `audioService.setRepeatAudio` | Configure repeat/hint audio |

---

## `window.Activity` Global API (Key Methods)

```javascript
Activity.Modules.register(moduleConfig)  // Register module
Activity.Modules.ready(moduleId)         // Signal ready
Activity.Media.Audio.play(params)        // Play audio
Activity.Media.Audio.getVideo(params)    // Get video player
Activity.Utils.Url.getPath(url)          // Resolve {{MEDIA}} URL
```

---

## Dev Sandbox

Activities registered in `waf-loom/dev-sandbox/config/modules.json`:
```json
{
    "id": "vt1amphibians",
    "label": "Amphibians",
    "modulePath": "modules/waf-module-vt1amphibians",
    "theme": "park",
    "layout": "mainOnly",
    "configuration": "m1pc207-1.json",
    "assessment": "m1pc207-1.json",
    "resolution": "640x480"
}
```

Run with: `cd waf-loom/dev-sandbox && node server.js` (port 4100).

---

## Layout System

Layouts are HTML templates in `framework/res/layouts/{name}/`. Generated modules use `mainOnly` (single full-screen module). The layout name maps to a `<div>` structure where compartment IDs become slots for modules.

---

## Key Patterns

- **PubSub everywhere:** Framework ↔ module communication uses `wafpubsub`. Never use direct imports across the boundary.
- **Media path tokens:** All asset URLs use `{{MEDIA}}` which is resolved at runtime. Never hardcode media paths.
- **Assessment correlation:** Configuration question keys match assessment item titles by convention.
- **Configuration assets are lazy:** Unlike theme assets, configuration-referenced URLs are loaded on demand.

## Pitfalls

- **Root container:** Use absolute inset positioning (`position: absolute; top: 0; right: 0; bottom: 0; left: 0;`) for the module root — not `height: 100%` alone.
- **Chrome autoplay:** Audio must handle `NotAllowedError`; framework manages this via pause overlay.
- **Specification version:** All new modules must use `specificationVersion: "2.0.0"`.
- **No optional chaining:** Do not use `?.` or `??` in module source code.
