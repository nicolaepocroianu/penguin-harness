# The studio composer keeps its unsent text

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`

The activity studio's conversation composer stopped losing unsent text. Closing the side panel,
switching conversations or leaving the activity used to throw it away; it now uses chat's Session
draft store.

## Details

- **Storage.** For a conversation with a Session, the text is kept in the same slot the chat page
  uses for that Session, so it shows in either place.
- **New conversations.** A new conversation, which has no Session yet, keeps its text in a slot
  per user, Project and activity: `penguin.chatDraft.activity.<userId>.<projectId>.<activityId>`.
  That slot is discarded once the message is sent and the conversation has a Session.
- **Saving.** Writes keep the 300 ms debounce, flush on a switch or unmount, and are discarded
  after a successful send.
- **Following conversations.** While the composer holds text, the panel stops following newer
  conversations. It follows again once the text is empty or the author picks a conversation.
- **Code.** `use-session-draft.ts` gained `useDraftSlot(key)`, which `useSessionDraft` now calls
  with the Session's key. `draft-cache.ts` gained `activityDraftKey`, and `conversation.ts` gained
  `composerDraftKey` and `shownConversation`.
- **Tests.** Node tests were added for the slot choice and the follow rule, and an end-to-end
  test for text surviving the panel closing and a newer conversation arriving.
