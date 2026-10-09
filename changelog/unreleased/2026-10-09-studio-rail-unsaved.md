# Leaving a module document with unsaved edits asks first

- **Date:** 2026-10-09
- **Type:** fix
- **Scope:** `web`
- **PR:** [#94](https://github.com/nicolaepocroianu/penguin-harness/pull/94)

Configuration Data, Assessment Data and Module Definition no longer lose unsaved edits silently
when another section opens. Choosing a section in the rail, or anywhere else that opens one,
now asks "Discard unsaved changes?" first. Cancel keeps the document open with the edits intact;
Discard opens the section. Leaving the activity or switching projects with such edits asks the
same way. The Activity Script and Activity Spec keep their text across sections, so switching
away from them does not ask.
