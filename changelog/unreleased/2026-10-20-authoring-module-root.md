# The server builds again after the Loom and waf-modules merges

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `activities`

PR #165 and PR #166 each changed `WafWorkspace.authoringModule`. Git merged them without a conflict, but the result declared `root` twice, so the server no longer built and every CI job on main failed. The external checkout's root now has its own name, `checkoutRoot`. The function keeps both changes: a monorepo module is authored where it is, and a new module is never made inside the checkout's own repository.
