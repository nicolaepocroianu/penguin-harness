# A faster module stage that says when a module was not played

- **Date:** 2026-10-10
- **Type:** perf
- **Scope:** `server`, `web`

A module run no longer spends minutes installing the module scaffold's packages. Each one used
to run `npm install` itself, about 100 MB from the WAF registry, which took 2.5 to 3.5 minutes of
a 9 to 12 minute stage. The packages (dependencies and devDependencies, from the scaffold's own
`.npmrc`) are now installed once per package set under `module-packages-cache` in the data
folder and linked into each run's `module/node_modules`, as speech and sound helpers already
share agenthub. Every stage of an activity stages the scaffold, so the stages before the module
run start that install in the background; a module run that finds it ready links it and is told
not to install, and one that does not installs its own as before. The shared install is a
protected root for the agent, like the WAF checkout.

The module prompt also says what the agents kept discovering by trial: the workspace is not a
git repository, `module/` is an ES module package (a script there uses `import`, or is `.cjs`),
and which typed contracts to read instead of listing whole package trees.

A module run that succeeds without being checked in the player now says so. The run records
`unchecked`: `noBrowser` when no player check was staged because the test browser is not
installed, `notRun` when the agent never ran the check it was given. The Stages panel shows it
under the finished module stage, so a module that only compiled no longer looks the same as one
that was seen to play.
