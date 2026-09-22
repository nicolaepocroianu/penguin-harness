# The other two deterministic stages, and the slot wiring that was wrong

- **Date:** 2026-09-22
- **Type:** feat
- **Scope:** `server`

`scaffold_module` and `assets_configuration` join the registry. Like
`prepare_media_assets`, neither is new behaviour: the scaffold is Penguin's existing
`prepareModule`, and the configuration is its existing `mediaConfiguration`, each given a
name, a place in the graph and a record of having run.

`scaffold_module` is marked as writing the shared module, so only a product's canonical ref
may run it. `assets_configuration` resolves each bound file to a `{{MEDIA}}` reference and
names any language with nothing bound — an unbound language does not fail, it plays
silence, which is worse.

## The slot wiring was wrong, and only one check caught it

The slot shipped previously typechecked and its tests passed, but the **interface
generator** rejected it, and the root `typecheck` script runs that generator first. Three
separate contract violations, none of which `tsc` can see:

1. **A slots interface attaches by name.** `XSlots` must sit beside interface class `X`,
   and the module that provides it must be `XModule`. The module was `ActivityStageModule`
   while the interface was `ActivityStages`, so the slot never resolved.
2. **A component binds its code half to a property** with `@Bind(id)`, assigned in
   `setup()`. The class itself is not the code half; the previous version assumed it was.
3. **A `@Component` metadata literal must be literal.** The generator reads the decorator's
   object from source and cannot evaluate an identifier, so `id: PREPARE_MEDIA_STAGE` left
   it holding a TypeScript AST node — which then failed to serialise, because an AST node
   points back at its parent. The stage-id constants stay for use in code; the decorator
   spells the ids out.

An interface handing out a runner also has to hand out an opaque handle rather than the
structural type, since the contract is compared by name across the push boundary.
