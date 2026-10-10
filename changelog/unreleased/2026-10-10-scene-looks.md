# Scene looks

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `plugins`, `server`, `web`

A scene can now be composed in a **look**: a small design system shared by every scene of an
activity, so its videos keep one palette, shape language, typeface and way of moving. There are
three, written for young learners:

- **Storybook**: warm, soft and rounded, like a picture book;
- **Bright flat**: bold, flat and clear, like a children's app;
- **Chalkboard**: chalk drawn on a classroom board, appearing as if being drawn.

A look lives in the waf-scene-composition skill as `looks/<id>/`, using the design-system package
format of open-design (Apache-2.0):

- `manifest.json` names and describes it;
- `DESIGN.md` tells the agent how to use it;
- `look.css` holds its tokens as CSS variables.

A composition made in a look has the guidance staged as `look.md` and links `look.css`, which
Penguin serves from the plugin, like the bridge, never from the run's workspace. The composition
records which look it was made in.

In the studio, a **Look** picker sits beside Compose. It defaults to the look the activity's
newest composition used, so later scenes match. `GET .../scene-looks` lists the looks.

Each critique's score is now kept on its run. The Recordings list shows "Critique 3.8" beside a
critiqued recording and marks the best so far, since a round of fixes can score lower than the one
before.
