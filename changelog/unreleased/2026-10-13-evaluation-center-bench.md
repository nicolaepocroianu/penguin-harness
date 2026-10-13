# The Evaluation Center shows the activity bench's scores, read-only

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#137](https://github.com/nicolaepocroianu/penguin-harness/pull/137)

Admins now see an **Activity bench** section below a Project's own Benchmarks in the Evaluation
Center. An admin chooses the bench home once, with the server folder browser the WAF workspace
page uses. The section then lists the Benchmarks `pnpm bench` keeps there. For each one it shows:

- its title;
- the bench Project and Benchmark it came from;
- its case count;
- a sparkline of its scores and its latest score;
- every evaluation, newest first: when it ran, the version, the summary, the model, the score,
  the cost and how long it took.

Nothing can be acted on, and nothing runs the bench.

## Details

- `GET /api/admin/activity-bench` answers the bench home and its Benchmarks. Only the bench's own
  Benchmark folders, `<home>/<project>/benchmarks/activity-bench-r<N>/`, are read, and nothing is
  written there. The section reads:
  - each folder's `benchmark_config.toml` and `scoreboard.yaml`;
  - its case folders, by name only, to count them.
- The section never reads the bench's vault, trials, seed, recipes or Claude login, nor any other
  folder of the bench home. It follows no link: a linked Project, Benchmark folder, config or
  scoreboard is not listed.
- `PUT /api/admin/activity-bench { home }` chooses the bench home, or forgets it with `null`.
  - The home must be an absolute folder on the server, apart from Penguin's own data folder, and
    is stored resolved in `server_settings` (`activityBenchHome`).
  - A home that later stops being a folder is reported as `home_missing`.
  - Both routes are for admins only.
- The Evaluation Center reads Benchmark folders with the same reader for a Project's Benchmarks
  and the bench's (`readBenchmarkDir`), so the two read alike.
