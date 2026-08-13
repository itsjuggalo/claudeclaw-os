/**
 * Cron helpers — a self-contained LEAF module that imports only `cron-parser`.
 *
 * `computeNextRun` used to live in `scheduler.ts`, but the scheduler pulls in the
 * whole turn stack (agent.ts, bot.ts, db.ts, …). The in-process dispatch action
 * layer (`cli-actions.ts`) needs the next-run calculation for `schedule create`
 * without inheriting that graph — importing it from the scheduler would close the
 * cycle `agent → dispatch-tools → cli-actions → scheduler → agent`. Keeping the
 * single implementation here (and re-exporting it from `scheduler.ts` for the
 * historical import path) gives every caller one source of truth and no cycle.
 */

import { CronExpressionParser } from 'cron-parser';

/** Next fire time for a cron expression, as a Unix timestamp (seconds). Throws on an invalid expression. */
export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
