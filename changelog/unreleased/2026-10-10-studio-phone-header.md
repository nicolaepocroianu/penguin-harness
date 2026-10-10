# A shorter studio header on a phone

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `web`

On a phone the activity studio's header keeps the way back, the title and the ref menu on one
row. The way back is an arrow there, and the product code, which the ref menu also names, is
left out, so a long title no longer wraps and leaves a "/" hanging at the end of a line. The
progress bar drops the words of steps that are done or not started yet, and keeps them for the
highlighted step, any failed one and one still running, whose green dot would otherwise read as done. A filled dot means done and a hollow one not started, and
screen readers still hear every step's state. This takes the bar from three rows to two. On wider screens a long title is shortened with an ellipsis
beside the ref menu, as before.
