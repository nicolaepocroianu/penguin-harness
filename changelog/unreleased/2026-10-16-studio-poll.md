# The studio stopped polling from hidden tabs and re-rendering unchanged reads

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `web`
- **PR:** [#152](https://github.com/nicolaepocroianu/penguin-harness/pull/152)

The activity studio's poll (the activity, its runs, the sandbox status and the current stages, every 2 seconds while work runs and every 30 seconds otherwise) stopped while the tab was hidden, unless narrations from "Generate all" were still waiting in the queue. Coming back to the tab read everything once, straight away, and the poll then carried on at its usual pace.

## Details

- A poll that read the same activity the studio already held no longer merged it into the draft or told the studio's views, so nothing rendered again. The draft's content was compared by its revision and the rest of the activity by value, which also caught a change to the product's tags.
- An edit to a scene video's timeline that matched the saved timeline stayed until the author saved or dropped it, or the saved draft moved; a poll of the same draft no longer cleared it.
- The runs list, the current stages and the stages' history were set only when what came back differed from what the page held.
- The stages' history was read with the poll's first read, and after that only once the current stages run's id or status had changed, rather than on every read. A history read on a poll whose other reads failed was not shown, so the next poll read it again.
- The page's first read still ran in a tab opened in the background.
- While narrations from "Generate all" waited in the queue, a hidden tab went on reading at the usual pace, and the queue started each narration as the one before it finished. Once the last narration had started, the hidden tab stopped reading.
- A read that failed in a way the poll did not expect was logged, and the poll read again 30 seconds later instead of stopping for good.
