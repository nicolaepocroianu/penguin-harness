# Whether a generated assessment covers the questions the scenes implied

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

`generate_assessment` runs two agent passes. The first enumerates the questions a
specification implies — a scene where a learner picks between three words implies a question
with those three choices. The second writes the assessment JSON.

The second pass can quietly drop one, and an assessment missing a question nobody notices
is an activity that never asks it. So the enumerated questions are kept as hints and the
written assessment is checked against them.

Ported from `assessment_item_hints.py`, including the two details that carry the weight.

## Matching is by normalised choice text

Case-folded, punctuation collapsed, trimmed. The passes are separate agent calls, so one
writes `"The cat."` where the other enumerated `"the cat"` — comparing raw strings would
report a question as missing because a full stop moved.

A hint's choices must be a **subset** of the written item's: the second pass may add a
distractor the scene did not name, but may not drop one it did. A hint naming a correct
answer also requires that choice to be marked correct.

## The search is ordered

Each hint is matched from just after the previous match, never from the start. That is
Loom's behaviour and it is deliberate twice over.

It means **one written item cannot satisfy two hints**, so an assessment that collapsed
three similar questions into one is caught rather than passing because the single item
matches all three.

And it means the written assessment has to keep the scenes' order, which is what an author
expects: the questions come in the order the activity asks them.

## Reporting

Every missing question is named, with its scene and its correct answer. An agent told only
the first writes it, is checked again, and is told the next — and each of those is a paid
pass over the whole assessment.
