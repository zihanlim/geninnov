// frontend/lib/chat/quota.ts
//
// How much of today's allowance is left, in words.
//
// WHY THIS EXISTS. `app/api/chat/route.ts` has always returned `remaining` and
// `AskConsole` has always typed it — and nothing rendered it. So a reader learned the
// cap existed by hitting it, which is the one way of learning it that cannot change
// how they spend it. The composer said "shares the nightly book's quota" and then
// declined to say how much of that quota was left.
//
// A COUNT, NEVER A METER. The obvious rendering is a percentage bar, and it would be a
// lie: what `chat_usage` stores is a per-visitor QUESTION counter, not tokens and not
// dollars. A bar labelled "spend" implies a cost gauge this system does not have, and
// the cost that actually matters here is not money — an exhausted MiniMax quota means
// tomorrow's book publishes as a deterministic template with no thesis. Questions are
// the unit the guard counts, so questions are the unit the reader sees.
//
// NULL IS NOT ZERO. `checkRateLimit` returns `{allowed: true}` with no `used`/`cap` when
// the guard is unconfigured — the development path — so `remaining` is genuinely absent
// rather than exhausted. Rendering that as an empty meter would say "you are out of
// questions" about a deployment with no limit at all. It gets `—` and its cause, per
// design goal 2.
//
// This module is deliberately free of imports. `lib/chat/rateLimit.ts` is the natural
// home for it and is unusable here: it pulls `createHash` from node's `crypto`, and
// `AskConsole` is a client component.
//
// See ADR-0160.

/** Nothing has been measured yet — the reader has not asked a question this session. */
export const NO_MEASUREMENT = null;

/**
 * One sentence about the remaining daily allowance, or `null` when there is nothing
 * honest to say yet.
 *
 * @param remaining  What the last answer reported: a count, or `null` when the guard
 *                   could not report one. `undefined` means no answer has arrived.
 * @param answered   Whether a question has been answered this session at all.
 */
export function describeRemaining(
  remaining: number | null | undefined,
  answered: boolean,
): string | null {
  // Before the first answer there is no reading. The composer's cost sentence already
  // discloses that a question is spent against a shared quota; inventing a figure here —
  // or announcing the default cap as though it were this visitor's balance — would be
  // asserting something unmeasured.
  if (!answered) return NO_MEASUREMENT;

  if (remaining === null || remaining === undefined) {
    return "Questions left today: — the spend guard did not report a count, so this deployment may not be enforcing one.";
  }
  if (remaining <= 0) {
    // Reached only if the last request was allowed and consumed the final question, so
    // the NEXT one is the refusal. Said in advance rather than discovered.
    return "That was the last question this visitor can ask today. The book itself is on /book and needs no quota to read.";
  }
  return `${remaining} ${remaining === 1 ? "question" : "questions"} left today for this visitor.`;
}
