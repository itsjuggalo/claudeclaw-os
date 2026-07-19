/**
 * Pure helpers for the AskUserQuestion → Telegram bridge, split out of bot.ts
 * so the selection/answer logic is unit-testable without a grammY context.
 */

/**
 * Apply a free-text "Other" reply to the current question's selection.
 *
 * - Single-select: the typed answer replaces the one allowed choice.
 * - Multi-select: the typed answer is one MORE choice — append it to whatever
 *   options were already toggled (dedup so a re-typed value doesn't double).
 *
 * The multi-select append is the fix for the bug where an Other reply wiped the
 * user's toggled options, leaving only the typed value.
 */
export function applyOtherSelection(
  existing: string[],
  text: string,
  multiSelect: boolean,
): string[] {
  const trimmed = text.trim();
  if (!multiSelect) return [trimmed];
  if (existing.includes(trimmed)) return existing;
  return [...existing, trimmed];
}

/**
 * The hint appended to a question card so the user knows whether to pick one or
 * check several — multi-select is easy to miss on Telegram since a tap doesn't
 * auto-advance like single-select.
 */
export function stepHint(multiSelect: boolean): string {
  return multiSelect
    ? '(check all that apply — tap to toggle, then Done)'
    : '(pick one)';
}

/**
 * A question is reported as "skipped" only when its selection slot is empty.
 * Any answer — including a free-text Other — must leave a non-empty slot.
 */
export function isSkipped(selection: string[] | undefined): boolean {
  return !selection || selection.length === 0;
}
