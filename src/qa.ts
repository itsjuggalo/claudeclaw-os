// qa.ts — ClaudeClaw wrapper for the Character Studio auto-QA gate
// (lib/qa_review.py). Reviews a generated still or clip and returns a structured
// verdict + concrete redo directives so the Create page (or an autopilot loop) can
// self-correct without a human. Measured checks are CPU + ffmpeg only and run
// instantly; the optional VLM "AI eye" only engages when a backend is installed.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);
const STUDIO = process.env.CHARACTER_STUDIO || '/AIWorkWSL/tools/character-studio';
const QA = path.join(STUDIO, 'lib', 'qa_review.py');

export interface QaIssue { code: string; severity: 'error' | 'warn' | 'info'; msg: string; }
export interface QaVerdict {
  pass: boolean;
  score: number;
  issues: QaIssue[];
  redo: { should_redo: boolean; directives: { add: string[]; avoid: string[]; note: string[] } };
  vlm?: boolean | string;
  error?: string;
}

const FAIL = (msg: string): QaVerdict => ({
  pass: false, score: 0, issues: [{ code: 'qa_error', severity: 'error', msg }],
  redo: { should_redo: false, directives: { add: [], avoid: [], note: [] } }, error: msg,
});

/**
 * Run the auto-QA gate on a file path. `useVlm` engages the optional vision model
 * (no-op + measured-only if the VLM backend isn't installed). Light + CPU; safe to
 * call inline after every gen.
 */
export async function reviewGen(filePath: string, useVlm = false): Promise<QaVerdict> {
  if (!filePath || !fs.existsSync(filePath)) return FAIL(`file not found: ${filePath}`);
  if (!fs.existsSync(QA)) return FAIL('qa_review.py not found — Character Studio missing');
  const args = [QA, filePath];
  if (useVlm) args.push('--vlm');
  try {
    const { stdout } = await execFileAsync('python3', args, {
      timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, HOME: process.env.HOME || '/home/itsju' },
    });
    const v = JSON.parse(stdout.trim()) as QaVerdict;
    return v;
  } catch (e) {
    const err = e as { stdout?: Buffer | string; message?: string };
    // qa_review prints JSON even on logical failure; try to parse a tail line.
    const raw = err.stdout?.toString() || '';
    const line = raw.trim().split('\n').filter(Boolean).pop();
    if (line) { try { return JSON.parse(line) as QaVerdict; } catch { /* fall through */ } }
    return FAIL(String(err.message || 'qa failed').slice(0, 200));
  }
}

/** One-line human summary of a verdict (for toasts / logs). */
export function qaSummary(v: QaVerdict): string {
  if (v.error) return `QA error: ${v.error}`;
  const tag = v.pass ? '✓ pass' : '✗ fail';
  const top = v.issues.filter((i) => i.severity !== 'info').slice(0, 3).map((i) => i.code).join(', ');
  return `${tag} (${Math.round(v.score * 100)}%)${top ? ` — ${top}` : ''}`;
}
