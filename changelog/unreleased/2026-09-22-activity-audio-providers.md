# Which audio a run can actually produce

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

Loom's audio stack has four kinds — speech, music, effects and forced alignment — each with
its own provider setting. Half its providers are local Python models, which this port
leaves behind; the interface stays open so a sidecar could add them later.

What matters now is honesty about capability. An activity that asks for effects on a
deployment with no effects provider must be told so, not handed silence.

## No silent substitution

A configured choice is honoured strictly. Asking for a provider this build does not carry,
or one whose credential is absent, is an error — never a quiet fallback to a different one.
Substituting another voice because the configured one was unavailable produces an activity
nobody can explain afterwards.

A refusal names what to do: the credential to add, or the providers that do serve that kind.

## The providers left behind are kept as data

Kokoro, MusicGen, AudioGen and AudioLDM are recorded with a reason each, rather than
dropped silently. When someone asks why music generation is unavailable, the answer should
name what Loom used and why it is absent, not leave them reading a diff.

## Alignment is asked separately

Whether narration can be **aligned** is a different question from whether it can be
**spoken**. A deployment can do one without the other, and a book activity has to be told
before it ships a read-along that does not read along.
