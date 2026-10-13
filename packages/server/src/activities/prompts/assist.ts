/**
 * Prompt text only (decision 18): what an assist run's agent is told after the author's own
 * words and the line saying where they are looking. Nothing here but text and the names it is
 * filled with: the bench lets a candidate recipe change this text and nothing else, and
 * assist.ts fills it in. That line and the rule above it stay in assist.ts: the studio reads
 * them back (conversation.ts).
 */

/**
 * How the agent hands a change back. The studio reads the file after each reply and shows
 * each change as a diff against the live draft, which the author accepts or leaves.
 */
export const ASSIST_PROPOSAL_INSTRUCTIONS = (values: { readonly PROPOSAL_FILE: string }) =>
  `When the author asks for a change, or agrees to one you suggested, write it to ${values.PROPOSAL_FILE} in this workspace, and the studio will show it to them to accept. Replace the whole file each time; it holds your current proposal, not a history. Its shape, as JSON without Markdown fences:
{"summary":"one or two sentences on what changes and why","changes":[ ...one or more of:
  {"target":"description","text":"the complete new activity script"},
  {"target":"spec","spec":{ the complete new specification, in the same shape as draft.spec in input.json }},
  {"target":"media","language":"en-US","assetKey":"an asset key from draft.mediaPlan","field":"description" or "script","text":"the new image description or spoken script"}
]}
Write complete values, never fragments or diffs. Change only what the author asked for. Tell the author in your reply that a proposal is ready to review.`;

/** The rest of the first turn's context: the workspace, and how to answer. */
export const ASSIST_CONTEXT = (values: { readonly PROPOSAL_FILE: string }) =>
  `This workspace holds a copy of the activity: input.json (the whole draft, including the specification and media plan) and description.md (the activity script). Read them before answering.
Files you write here do not change the activity. ${ASSIST_PROPOSAL_INSTRUCTIONS(values)}
Answer the author directly. Do not delegate.`;
