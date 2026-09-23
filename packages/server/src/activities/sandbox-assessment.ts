/**
 * The assessment service a preview talks to, emulated.
 *
 * An activity that uses an assessment asks the WAF backend for its items one part at a
 * time, and sends back what the learner answered. A preview has no backend, so -- as in
 * Loom's dev sandbox -- the module's own `assessments/<code>-<ref>.json` is served in
 * order: every answer is accepted, nothing is scored, and the session ends when the items
 * or the configured maximum run out. That is enough to play an assessed activity through;
 * it is not a claim about how the real service would grade it.
 *
 * Pure: the sessions live with the caller, and randomness is injected.
 */

export interface AssessmentData {
  configuration?: { maxItems?: number; nextItemsSize?: number; [key: string]: unknown };
  behavior?: string;
  items: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface AssessmentSession {
  assessmentKey: string;
  data: AssessmentData;
  itemIndex: number;
  assessmentScoreId: number;
  behaviorType: string;
}

/** An integer id, the size the WAF backend hands out. */
export type IdSource = () => number;

/** The interaction an item is, by its key or else by the shape of its configuration. */
export function interactionType(item: unknown): string {
  if (!item || typeof item !== "object") return "NONE";
  const record = item as Record<string, unknown>;
  if (typeof record.interactionKey === "string" && record.interactionKey.length > 0)
    return record.interactionKey.toUpperCase();
  const configuration = record.configuration;
  if (!configuration || typeof configuration !== "object") return "NONE";
  const has = (key: string) => typeof (configuration as Record<string, unknown>)[key] === "object";
  if (has("simpleChoice")) return "SIMPLE_CHOICE";
  if (has("elements")) return "ELEMENT_RECOGNITION";
  if (has("inlineChoice")) return "INLINE_CHOICE";
  if (has("associate")) return "ASSOCIATE";
  if (has("match")) return "MATCH";
  if (has("textEntry")) return "TEXT_ENTRY";
  if (has("hotText")) return "HOT_TEXT";
  if (has("multipleResponseChoice")) return "MULTIPLE_RESPONSE_CHOICE";
  if (has("order")) return "ORDER";
  if (Object.keys(configuration).length === 0) return "WEL_ACTIVITY";
  return "NONE";
}

/** Whether a parsed file is an assessment this can serve. */
export function isAssessmentData(value: unknown): value is AssessmentData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export function startAssessment(
  assessmentKey: string,
  data: AssessmentData,
  nextId: IdSource,
): AssessmentSession {
  return {
    assessmentKey,
    data,
    itemIndex: 0,
    assessmentScoreId: nextId(),
    behaviorType: data.behavior || "LINEAR",
  };
}

/** One item as the backend sends it: fresh ids, and its configuration renamed. */
function servedItem(raw: Record<string, unknown>, nextId: IdSource): Record<string, unknown> {
  const item: Record<string, unknown> = structuredClone(raw);
  item.assessmentItemId = nextId();
  item.itemId = nextId();
  item.itemScoreId = nextId();
  item.interaction = interactionType(item);
  item.itemConfiguration = item.configuration;
  delete item.configuration;
  return item;
}

/**
 * The next part of a session, taking the answers to the last one.
 *
 * Advances the session in place -- a part handed out is a part the learner has seen.
 */
export function nextAssessmentPart(
  session: AssessmentSession,
  responses: unknown[],
  nextId: IdSource,
): Record<string, unknown> {
  const savedItems: { itemId: unknown; score: number }[] = [];
  const nonprocessedItems: unknown[] = [];
  for (const response of responses) {
    const scoreId = (response as { item_score_id?: unknown } | null)?.item_score_id;
    if (scoreId) savedItems.push({ itemId: scoreId, score: 1 });
    else nonprocessedItems.push(response);
  }

  const items = session.data.items;
  const total = items.length;
  const maxItems = session.data.configuration?.maxItems ?? total;
  const size = Math.min(session.data.configuration?.nextItemsSize || 1, total - session.itemIndex);
  const finished = session.itemIndex >= total || session.itemIndex >= maxItems;
  const progress = total === 0 ? 1 : session.itemIndex / total;

  const nextItems: Record<string, unknown>[] = [];
  if (!finished) {
    for (let index = 0; index < size; index += 1)
      nextItems.push(servedItem(items[session.itemIndex + index]!, nextId));
    session.itemIndex += nextItems.length;
  }

  return {
    assessmentId: session.assessmentKey,
    assessmentScoreId: session.assessmentScoreId,
    assessmentKey: session.assessmentKey,
    assessmentVersion: 1,
    score: null,
    nextItems,
    nonprocessedItems,
    savedItems,
    assessmentConfiguration: session.data.configuration,
    status: finished ? "FINISHED" : "IN_PROGRESS",
    behaviorType: session.behaviorType,
    progress,
  };
}
