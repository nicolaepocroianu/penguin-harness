# Deploy reads as one pipeline

- **Date:** 2026-10-09
- **Type:** feat
- **Scope:** `web`

When a deploy cannot start, the Deploy page now lists what is missing at the top instead of in
a folded section. Each problem sits beside the action that fixes it, where there is one: Prepare
clones for a missing module clone or media folder, Check remote for a remote that could not be
reached, and, for an admin, a button that opens the right settings page. Deploy to QA stays
disabled while anything is missing, and the reason is shown beside it.

The QA pipeline shows its three phases side by side: Module release, Activity data & media, and
QA deployment. Each phase has its own progress bar and count. On narrow screens the phases
stack. The stage the pipeline stopped at reads "Blocked" and says why. A running, failed or
stopped stage is marked the same way. Once the media stage has run, it shows how many media
files it checked. The log folds to a single line while it is empty, and opens by itself when a
deploy starts writing to it.

QA and PROD sit side by side as two cards, each with a short status. The QA card links to the
activity on QA once it is there. The PROD card keeps Deploy to PROD and its typed confirmation.
The folded repository and branch details now say how many checks there are and how many need
attention.
