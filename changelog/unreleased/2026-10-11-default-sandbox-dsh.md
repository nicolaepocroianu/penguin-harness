# The sandbox is on by default for activity agents, with a switch to turn it off

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `plugins`, `activities`, `settings`

Activity runs no longer need a sandbox plugin added to each project before they start. The DSH
sandbox backend now loads in every deployment, and an admin can turn off confining activity
agents for the whole server.

## Behaviour

- The DSH sandbox backend (`@prismshadow/penguin-plugin-sandbox-dsh`) loads whether or not a
  project's `[plugins]` table names it. It confines nothing by itself: only a session that asks
  for confinement uses it. It is the one exception to plugins loading only when a project asks
  for them.
- A plugin named twice, for example by package name and by path, is loaded once. Each name keeps its own
  status on the Plugins page: running when the plugin runs, or failed with its reason.
- A dev server running from source finds the repository's own plugins by package name, so a
  project no longer has to name one by its path there.
- **System settings > WAF workspace** has a **Confine activity agents** switch, on by default.
  Turned off, activity runs are neither confined nor refused for want of a sandbox, and
  sessions reopened from an activity run are not confined either. A run already going keeps the
  setting it started with. A line under the switch says what the setting means right now,
  including that runs will not start when it is on and no sandbox is available. If the setting
  cannot be read, the page says why and offers to retry.
- New admin routes: `GET` and `PUT /api/admin/activity-sandbox`.
