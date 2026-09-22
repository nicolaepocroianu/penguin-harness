---
name: waf-activity-identity
description: Use when naming, selecting, generating, previewing, or documenting WAF Loom activities that involve product codes, ref numbers, templates, configurations, assessments, or generated media.
---

# WAF Activity Identity

## Core Rule

The backend activity identity is only `{ productCode, refNum }`.

Keep `productCode` and `refNum` as separate backend fields in code, paths,
metadata, generated refs, templates, configurations, assessments, and media
references. Do not replace them with a serialized string or legacy id/ref
aliases as the source of identity.

## Examples

| productCode | refNum | Backend identity |
|---|---:|---|
| `m1pc80` | 1 | `{ productCode: "m1pc80", refNum: 1 }` |
| `m1pc80` | 2 | `{ productCode: "m1pc80", refNum: 2 }` |

## Backing Data

Each backend activity identity is backed by:

- one product/template record under `modules/waf-module-<productCode>/generated/<productCode>/spec/activity_metadata.json`
- ref-specific configuration data under `modules/waf-module-<productCode>/configurations/<productCode>-<refNum>.json`
- optional ref-specific assessment data
- ref-specific generated spec, assets, and media under `modules/waf-module-<productCode>/generated/<productCode>/refs/<productCode>-<refNum>/`

## Stability

Template stability belongs to the product/template record.

Additional refs can be created only after product template stability is true. Ref 1 is the first activity for a product, but ref 1 is not canonical in user-facing language.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Treating `productCode` alone as an activity | Keep `{ productCode, refNum }` together |
| Treating serialized display strings as backend identity | Keep `productCode` and `refNum` as separate fields |
| Storing draft/stable state on ref 1 | Store template stability on the product/template metadata |
