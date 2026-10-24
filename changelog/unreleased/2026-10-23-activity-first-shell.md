# The app opens on the Library, and the nav puts activities first

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `web`, `ui`
- **Breaking:** no

The first step toward an activity-centred app, modelled on Loom's shape. Signing in, the bare root and an unknown address now land on the Library (the activity list at `/activities`), not on chat.

## Nav

- The Library holds the sidebar's fixed top slot, where New chat used to be, and is always shown. Media (the project's media library, `/activities/media`) follows it as its own entry, lit on its own page instead of lighting the Library.
- New chat, Agents, Models, Plugins, Machines, Cost Center and Evaluation Center start in a **Harness** group under them, with a named heading row that folds it away. Every entry but the Library can still be starred to stay pinned, and New chat can now be moved like any page.
- The collapsed rail, which is also what an open activity keeps beside it, starts with the Library and Media, then a divider, then the conversations and the harness pages.
- The studio's way back is labelled **Library**.

## Compatibility

Pin choices stored before this change keep applying, but against the new defaults. An entry that was pinned by default before and was never moved now starts in the Harness group.
