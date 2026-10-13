# The server runs reused acceptance tests itself, with no agent

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#134](https://github.com/nicolaepocroianu/penguin-harness/pull/134)

Some test runs reused the test file an earlier run wrote for the same criteria. That was an
author's run with unchanged criteria, or the Stages' second tests after a repair. The server now
ran that file itself instead of starting an agent Session (decision 17). No agent touched the
run's files, so nobody could edit the harness of a re-test and put it back, or write its results by
hand. The run kept its kind and its record (`reused`, `cachedTestHash`, `test.staged`). Its report
stayed at `reports/test.json`, and `reused` and `untrusted` meant what they meant before. The
Stages kept their notes. When a re-test could not run, it failed and said why, and the activity
kept its earlier report.

A module run's player check got the byte check a test run already had. Before the run's Session
started, the server recorded on the run the SHA-256 of the files it staged for the check: the
harness, the runner, the input and the package.json. It compared them as the run was collected,
and marked the player check `untrusted` when any had changed. The outcome ledger counted such a
check as `playerCheck.untrusted`, with none of its results, and its module as
`unchecked.untrusted`.

## Details

- The server ran a re-test with its own copies of the harness and the runner, never the files in
  the run's folder. It played the build the run named through that build's play link, in the
  test browser.
- The test file is still an agent's code. Before, it ran inside that agent's Session, which a
  sandbox usually confined. Run by the server without limits, it would have had the server's
  rights. So it ran as the activity bench's evaluator runs a trial's tests, with both of the
  bench's locks:
  - **Node's permission model.** The checks ran in a child Node process that could read only
    `playwright-core`, and could not write, start a process or a worker, or load an addon or
    WASI. The child refused to run anything unless it was confined that way. It got no
    environment beyond the system's plumbing. Module hooks served the runner, the harness, the
    test file and the input from memory, and the results came back over IPC. Node's permission
    model does not limit the network, but the child held nothing worth sending: only the test
    file, the criteria, and a signed link that plays this one activity.
  - **The bench's browser lockdown** (#130). The browser's proxy led nowhere except the play
    link's own host and port, no other host name resolved, and WebRTC could not send UDP around
    the proxy. A guard in front of the browser refused a navigation off the play link's origin,
    a context with its own proxy or recordings, local files, DevTools sessions, the browser's own
    HTTP client, tracing and artifacts. A refused call failed that check.
- A re-test belonged to no agent. Its record named no agent and no Session, it asked for no
  sandbox, and the outcome ledger gave its recipe the runtime `server`. Cancelling the run stopped
  the checks. They had 30 minutes.
- A Session kind could now have the server do a run's work in place of its Session (`serverWork`).
  The engine staged the run as before, saved its record, ran the work, and collected what the
  work wrote as it collects a completed Session's output. `TestBrowser.runChecks` ran the checks,
  and `runProgram` gained an IPC channel for a Node program.
- The reuse prompt was retired. In the run-kinds golden, the `test-reuse` entry now pins no
  prompt, and its `acceptance-input.json` names no browser server. Every other entry stayed the
  same byte for byte.
