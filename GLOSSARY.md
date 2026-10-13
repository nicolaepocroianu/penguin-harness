# Penguin Harness

An agent harness whose activity studio authors Waterford learning activities: an author describes
an activity, agents write and assemble it, and it is previewed and deployed as a WAF module.

## Language

### Projects and activities

**Project**:
The workspace a team authors in; it owns its activities and decides who may change them.
_Avoid_: Workspace

**Activity**:
One learning activity a learner plays, authored in a project as one ref of a product.
_Avoid_: Lesson, exercise

**Product**:
A family of activities that share one module, named by its product code; one of its refs is
canonical and owns the module's code and shared documents.
_Avoid_: Activity type, template

**Ref**:
One numbered activity of a product; a stable ref is one others may be made from.
_Avoid_: Variant, copy, instance

**Draft**:
The working state of an activity that an author edits: its script, specification and media plan,
saved as one revision.
_Avoid_: Document, working copy

**Unsaved work**:
Edits an author has made that are not yet in the draft; they are saved for the author or shown as
unsaved, never dropped silently.
_Avoid_: Dirty state, pending changes

### Content

**Script**:
What the author writes to describe the activity, from which the specification is generated.
_Avoid_: Description, prompt

**Specification**:
The structured definition of an activity: its scenes and what each one does.
_Avoid_: Spec, activity spec

**Scene**:
One step of an activity a learner moves through.
_Avoid_: Screen, stage, page

**Media plan**:
Every asset the activity needs, per language, with the file each is bound to; shown in full as the
asset manifest.
_Avoid_: Media manifest, media spec

**Asset**:
One image, sound, video or animation the media plan names, bound to a file once there is one.
_Avoid_: Media item, resource

**Timeline**:
How a finished video is put together: which stretches of a recording play, and the narration,
music, sound effects and captions over them.
_Avoid_: Edit list, cut list

### Generation

**Stages**:
The steps an activity is generated in, from specification to tested module, run one at a time or
all in order.
_Avoid_: Pipeline, workflow

**Run**:
One execution of one stage for an activity, with what it produced.
_Avoid_: Job, task, generation

**Run kind**:
Which stage a run serves.
_Avoid_: Run type, step

**Candidate**:
What a run produced and an author has not accepted yet; accepting a candidate makes it part of the
draft.
_Avoid_: Proposal, suggestion, output

**Session**:
A conversation with an agent; a run's agent works inside one.
_Avoid_: Chat, thread, conversation

**Session rebuild**:
A Session created but never run, rebuilt after a restart under the same id.
_Avoid_: Session restore, session copy

**Recipe**:
What decided how a run's agent worked: who answered and with which model, the stage's
instructions, and the authoring skills it was given; runs with the same recipe can be compared.
_Avoid_: Config, setup, fingerprint

**Outcome**:
What became of a run after it ended: whether its candidate was accepted or replaced, what checks
found, how much authors changed what it wrote, and whether it reached a deploy.
_Avoid_: Result, feedback, signal

### Modules

**Module**:
The playable code of a product, as the WAF framework loads it.
_Avoid_: Bundle, app, package

**Module build**:
One assembled module, made by a run; the newest is used unless an author pins another to play.
_Avoid_: Build artifact, assembly

**Module source**:
Which module build, or which module in the WAF checkout, a preview or a deploy uses, and the module
documents in effect for it.
_Avoid_: Module origin

**Preview**:
Playing an activity here, in a learner runtime of its own, from its module source.
_Avoid_: Sandbox, playground

**Deploy**:
Releasing a product's module and publishing its activities to QA and then PROD.
_Avoid_: Publish, ship

**WAF workspace**:
The WAF repositories Penguin prepares and keeps for authoring, previews and deploys, or an existing
checkout an admin names instead.
_Avoid_: WAF repo, environment

**WAF checkout**:
The files of the WAF workspace on disk, laid out as a WAF checkout is: the framework, the modules and
the media.
_Avoid_: WAF folder, clone
