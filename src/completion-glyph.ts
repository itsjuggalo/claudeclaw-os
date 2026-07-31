/**
 * How a finished tool phase is marked in chat, by `status`.
 *
 * Its own module because every chat surface needs it and none of them owns it. Two
 * surfaces disagreeing about what a failure looks like is exactly how Signal ended up
 * reporting failed commands with a ✓ while Telegram reported them ⚠️; a surface-neutral
 * table is the only shape where that cannot drift apart again.
 */

/** A phase that finished with nothing to report. */
export const COMPLETION_DONE_GLYPH = '✓';
/** A phase that ended badly. Must not close out under the success glyph. */
export const COMPLETION_FAILED_GLYPH = '⚠️';
/** Advisory: something worth saying, that the turn nonetheless carried on past. */
export const COMPLETION_NOTICE_GLYPH = 'ℹ️';

/**
 * Glyph for a standalone completion reply, following `status`.
 *
 * `notice` is neither a win nor a failure: it is an advisory the turn carried on past
 * (a policy warning, a degraded fallback, a command that exited non-zero), so flagging
 * it ⚠️ overstates it and ✓ hides it. That middle rung is what keeps a run of ordinary
 * `rg` misses — `rg` exits 1 when it matches nothing — from reading as a broken agent.
 *
 * Unknown and absent statuses read as done. The alternative is treating anything
 * unrecognized as suspect, which would flag ordinary work from any provider that spells
 * its success status differently.
 */
export function completionStatusGlyph(status?: string): string {
  if (status === 'failed' || status === 'error') return COMPLETION_FAILED_GLYPH;
  if (status === 'notice') return COMPLETION_NOTICE_GLYPH;
  return COMPLETION_DONE_GLYPH;
}
