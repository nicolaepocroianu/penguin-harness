/**
 * The assessment half of the dev sandbox: a learner session, scored locally.
 *
 * An activity with assessment talks to a WAF backend — it opens a score, submits
 * responses and reads a result. Without that, the only way to see whether an activity's
 * assessment works is to deploy it, which is the opposite of a preview.
 *
 * Loom emulates this with in-memory sessions on a TTL, and so does this. The interaction
 * kinds and their rules are Loom's, read out of its own validator rather than guessed:
 * `SIMPLE_CHOICE` has exactly one correct choice, `MULTIPLE_RESPONSE_CHOICE` at least one,
 * and both need at least two choices.
 *
 * Nothing here reaches a real student or telemetry service. A preview that quietly talked
 * to production would be worse than no preview.
 */

export type InteractionKind = "SIMPLE_CHOICE" | "MULTIPLE_RESPONSE_CHOICE";

export interface AssessmentChoice {
  id: string;
  isCorrect: boolean;
}

export interface AssessmentItem {
  id: string;
  interaction: InteractionKind;
  choices: AssessmentChoice[];
}

/** What is wrong with an assessment, in an author's terms, or an empty list. */
export function assessmentProblems(items: readonly AssessmentItem[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const at = `Item ${index + 1}`;
    if (!item.id.trim()) problems.push(`${at} has no id.`);
    else if (seen.has(item.id)) problems.push(`${at} repeats the id "${item.id}".`);
    else seen.add(item.id);

    if (item.choices.length < 2) {
      problems.push(`${at} needs at least two choices.`);
      return;
    }
    const ids = new Set<string>();
    for (const choice of item.choices) {
      if (!choice.id.trim()) problems.push(`${at} has a choice with no id.`);
      else if (ids.has(choice.id)) problems.push(`${at} repeats the choice id "${choice.id}".`);
      else ids.add(choice.id);
    }
    const correct = item.choices.filter((choice) => choice.isCorrect).length;
    if (item.interaction === "SIMPLE_CHOICE" && correct !== 1)
      problems.push(`${at} is a single choice, so it needs exactly one correct choice.`);
    if (item.interaction === "MULTIPLE_RESPONSE_CHOICE" && correct < 1)
      problems.push(`${at} needs at least one correct choice.`);
  });
  return problems;
}

export interface ItemResult {
  itemId: string;
  /** The choice ids the learner picked, in the order given. */
  chosen: string[];
  correct: boolean;
}

/**
 * Whether a response is right.
 *
 * A multiple-response item is right only when the chosen set is exactly the correct set —
 * picking every choice is not a way to be right, which is the one rule a hand-rolled
 * scorer usually gets wrong.
 */
export function scoreItem(item: AssessmentItem, chosen: readonly string[]): boolean {
  const correct = new Set(item.choices.filter((choice) => choice.isCorrect).map((c) => c.id));
  const picked = new Set(chosen);
  if (item.interaction === "SIMPLE_CHOICE")
    return picked.size === 1 && correct.has([...picked][0]!);
  if (picked.size !== correct.size) return false;
  for (const id of picked) if (!correct.has(id)) return false;
  return true;
}

export interface AssessmentSession {
  scoreId: string;
  activityId: string;
  items: AssessmentItem[];
  results: ItemResult[];
  createdAtMs: number;
  lastSeenAtMs: number;
  /** Set once the learner finishes; a finished session takes no more responses. */
  finishedAtMs: number | null;
}

export interface SessionSummary {
  scoreId: string;
  answered: number;
  total: number;
  correct: number;
  finished: boolean;
}

export function summarize(session: AssessmentSession): SessionSummary {
  return {
    scoreId: session.scoreId,
    answered: session.results.length,
    total: session.items.length,
    correct: session.results.filter((result) => result.correct).length,
    finished: session.finishedAtMs !== null,
  };
}

/** Fifteen minutes, which is longer than any preview sitting and short enough to forget. */
export const SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * Learner sessions for previews, in memory and on a TTL.
 *
 * In memory deliberately: a preview score is scratch data, and persisting it would mean
 * deciding how long a throwaway assessment attempt is worth keeping — a question nobody
 * wants answered in a migration.
 */
export class AssessmentSessions {
  private readonly sessions = new Map<string, AssessmentSession>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: number = SESSION_TTL_MS,
  ) {}

  /** Drops sessions nobody has touched inside the TTL. */
  sweep(): number {
    const cutoff = this.now() - this.ttlMs;
    let dropped = 0;
    for (const [scoreId, session] of this.sessions)
      if (session.lastSeenAtMs <= cutoff) {
        this.sessions.delete(scoreId);
        dropped += 1;
      }
    return dropped;
  }

  /** Opens a score. Refuses an assessment that could not be answered coherently. */
  open(scoreId: string, activityId: string, items: AssessmentItem[]): AssessmentSession {
    this.sweep();
    const problems = assessmentProblems(items);
    if (problems.length)
      throw new Error(`This assessment cannot be scored:\n  ${problems.join("\n  ")}`);
    const at = this.now();
    const session: AssessmentSession = {
      scoreId,
      activityId,
      items,
      results: [],
      createdAtMs: at,
      lastSeenAtMs: at,
      finishedAtMs: null,
    };
    this.sessions.set(scoreId, session);
    return session;
  }

  /** A live session, or null. Touching it keeps it alive. */
  get(scoreId: string): AssessmentSession | null {
    this.sweep();
    const session = this.sessions.get(scoreId);
    if (!session) return null;
    session.lastSeenAtMs = this.now();
    return session;
  }

  /**
   * Records a response and says whether it was right.
   *
   * A second response to the same item replaces the first rather than adding to the count:
   * an activity that lets a learner change an answer before submitting would otherwise
   * score them twice.
   */
  respond(scoreId: string, itemId: string, chosen: readonly string[]): ItemResult {
    const session = this.get(scoreId);
    if (!session) throw new Error(`No open score ${scoreId}. It may have expired.`);
    if (session.finishedAtMs !== null)
      throw new Error(`Score ${scoreId} is already finished and takes no more responses.`);
    const item = session.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`This assessment has no item "${itemId}".`);
    const unknown = chosen.filter((id) => !item.choices.some((choice) => choice.id === id));
    if (unknown.length)
      throw new Error(
        `Item "${itemId}" has no ${unknown.length === 1 ? "choice" : "choices"} ${unknown.join(", ")}.`,
      );

    const result: ItemResult = { itemId, chosen: [...chosen], correct: scoreItem(item, chosen) };
    const at = session.results.findIndex((entry) => entry.itemId === itemId);
    if (at >= 0) session.results[at] = result;
    else session.results.push(result);
    return result;
  }

  /** Closes a score. Idempotent, because a runtime may finish twice on a fast exit. */
  finish(scoreId: string): SessionSummary {
    const session = this.get(scoreId);
    if (!session) throw new Error(`No open score ${scoreId}. It may have expired.`);
    session.finishedAtMs ??= this.now();
    return summarize(session);
  }

  /** How many sessions are being held, for a status endpoint to report honestly. */
  size(): number {
    return this.sessions.size;
  }
}
