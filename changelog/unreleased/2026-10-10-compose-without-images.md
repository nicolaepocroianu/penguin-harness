# Scenes compose without images

- **Date:** 2026-10-10
- **Type:** feat
- **Scope:** `server`, `web`

Compose from storyboard (the scene video experiment) no longer needs an image bound to the scene.
A scene without images is drawn by the agent with HTML, CSS and inline SVG, from the scene's
description and the video's own description. Images the scene does have are still staged and
used. Generated specifications often describe their videos only in words, so their scenes could
not be composed at all before. The studio now says so beside Compose instead of disabling it.
