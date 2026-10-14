# The module-tree check stopped growing arktype's registry on every boot

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#PR](https://github.com/nicolaepocroianu/penguin-harness/pull/PR)

Every platform boot checks the module tree against the interface table, and that check
parsed each leaf type it compared through arktype, which registers every parse in a
process-wide table it never releases. One check added about 55,000 entries, so a process
that booted the platform many times — every hot push, every test app in a long test run —
grew that table until registering into it took minutes. The server suite stalled on CI
for six hours this way.

## Details

- `dataExtends` kept each leaf answer by its pair of expressions, so a leaf is parsed once
  per process. A repeated check of the server's tree registered nothing new and took about
  35 ms instead of about 150 ms.
- `checkTree` kept each slot schema by its inlined definition, for the same reason.
- A core test checks the same tree several times and asserts arktype's table did not grow.
