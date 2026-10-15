# The activity studio shows and plays its media

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `web`
- **PR:** pending

Phase 2 of the Activity Studio audit. Media is shown and heard where it is listed. The asset
editor plays a checkout video or recording instead of saying it has no preview. Every narration
line in Audio has a play button, and the lines sit under their scenes in the script's order with
Play scene. The Storyboard, the Library and the scene tree show each picture and each video's
first frame. A storyboard card reads its scene's beats from the script, under the scene's title.

## Details

- **Asset editor.** A video, or a book word's recording, bound to a file in the checkout plays
  from the URL the player reads it from, through the same `boundSource()` New ref uses. The
  video shows its first frame before it plays. A video or animation bound to the placeholder
  says so under the player, with how many other assets share the file. "This media type has no
  in-app preview" is left only for an animation (a Lottie file) in the checkout.
- **Audio.** A line with a file has a play button in front of its words, and its length after
  them when the plan knows it. All the buttons share one audio element, so starting a line
  stops the one before. Lines are grouped under their scenes, with the script's number and title
  for each. Within a scene they follow the order the script says them, matched by their words;
  lines the script does not say keep the plan's order after them. Play scene plays a scene's
  lines one after another. A line several scenes use is listed once, under the first. A file the
  browser cannot play says "Could not play this file." on its row.
- **Pictures.** The Storyboard cards, the Library's planned assets and the scene tree's picture
  and video rows show the asset's picture: the image itself, or a video's first frame. The
  browser decodes the frame from the file the asset plays from. A video is read only once it
  scrolls into view. A video bound to the placeholder is named as one and never loaded. Previews
  read the saved plan, so a path being typed is not fetched on every key. A Library row for
  sound with a file has its own play button.
- **Storyboard.** Each card shows the scene's picture, its title from the script (its id when the
  script names no such scene), how many lines it says, and its first three beats in the script's
  order: what is said, what is shown and the prose between, with no `<audio>` or `<video>` markup.
  A scene with placeholders says how many on its picture, and the board says once how many
  assets are still placeholders, with a button that opens the first one. The chosen scene's
  sheet no longer repeats the specification's raw description.
- **Stored data.** Nothing new is stored. Posters are decoded in the browser from files the
  studio already serves; no poster file, cache or manifest field was added.
- **Tests.** Unit tests cover the beats, scene titles, posters and placeholder counts, the media
  previews and `boundSource()` for a generated picture, the narration grouping and ordering, and
  the tree's asset types. A new activities e2e test plays a line and a scene in Audio and checks
  the storyboard's titles, beats, poster and placeholder notice, the asset editor's checkout video
  and the Library's play button.
