# Loom activities import and play

- **Date:** 2026-09-23
- **Type:** feat
- **Scope:** `server`, `web`

Activities Loom generated in the WAF checkout (`modules/waf-module-<name>/generated`) can
now be imported from the activities page and played in the harness, in the WAF learner
runtime, the way Loom's dev sandbox played them.

## Import

**Import from Loom** on the activities page lists what the checkout offers, reading only,
and imports one product at a time through the existing import routes. Each import shows
the server's own account of what was created, repaired or left behind.

## Where a module and its media come from

An imported activity has no module Penguin assembled. The sandbox now falls back on the
product's folder in the checkout, and on the checkout's `media/` for any file the draft does
not hold. Penguin's own build still wins when there is one. The checkout is only read.
A checkout module is built the way Loom built it (webpack from the module or the framework,
the same dependency aliases and sequence shim, `res/style.scss` through sass), into
`<PENGUIN_HOME>/activity-sandbox/modules/<folder>`. `sass` is a new server dependency for
this.

## Playing

The Module section is now enabled whenever the sandbox finds a module. It has a Player
with a Play button. The player is Loom's `player.js`, ported: the checkout's framework
bundled once per framework version, started with stand-in services, and told to fetch
everything from one per-activity base. Under that base the server answers the framework's
configuration and assessment calls, serves the module and the checkout's navigation bar,
the media, and the framework's shared layouts, stylesheets, images and sounds. Assessments
are emulated as Loom emulated them: the module's own items in order, every answer
accepted, nothing scored.

The page is served on the preview origin behind a signed, two-hour link bound to one
activity and one host, like workspace previews, because a module's code, written by an
agent, must not run with the author's session. Without a separate preview origin it is served on the App's
host with an opaque, sandboxed origin instead.

## What does not play

A Loom module that never got a `configurations/<code>-<ref>.json` was never finished, and
Loom's own sandbox refused it too. The player says so rather than showing a blank
activity. In the current checkout that is most of the 69 generated modules. Every
`the-ant-lab*` module is one of them.

A `{{MEDIA}}` token in a module definition is now treated as media, not a module-relative
file, and every token in a payload is resolved to the preview's media path.
