// tokenburn.ts — reads ~/.claudeclaw/token-burn.json (codeburn export v2) and
// normalises it to a compact, frontend-safe contract.  The giant sessions[]
// and shellCommands[] arrays are deliberately dropped here.

import fs from 'fs';
import path from 'path';

export interface TokenBurnSummaryRow {
  period: string;
  cost: number;
  apiCalls: number;
  sessions: number;
  projects: number;
}

export interface TokenBurnDailyRow {
  date: string;
  cost: number;
  apiCalls: number;
  sessions: number;
}

export interface TokenBurnModelRow {
  model: string;
  cost: number;
  share: number;
  oneShot: number;
}

export interface TokenBurnProjectRow {
  project: string;
  cost: number;
  share: number;
  sessions: number;
  apiCalls: number;
}

export interface TokenBurnToolRow {
  tool: string;
  calls: number;
  share: number;
}

export interface TokenBurnActivityRow {
  activity: string;
  cost: number;
  share: number;
}

export interface TokenBurnData {
  generated: string;
  symbol: string;
  summary: TokenBurnSummaryRow[];
  daily: TokenBurnDailyRow[];
  models: TokenBurnModelRow[];
  projects: TokenBurnProjectRow[];
  tools: TokenBurnToolRow[];
  activity: TokenBurnActivityRow[];
}

export async function getTokenBurn(): Promise<TokenBurnData> {
  const home = process.env.HOME || '/home/itsju';
  const filePath = path.join(home, '.claudeclaw', 'token-burn.json');

  if (!fs.existsSync(filePath)) {
    throw new Error(`token-burn.json not found at ${filePath}. Run codeburn-daily.sh first.`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Summary rows — all 3 periods (Today / 7 Days / 30 Days)
  const summary: TokenBurnSummaryRow[] = (raw.summary ?? []).map((row: Record<string, unknown>) => ({
    period:   String(row['Period'] ?? ''),
    cost:     Number(row['Cost (USD)'] ?? 0),
    apiCalls: Number(row['API Calls'] ?? 0),
    sessions: Number(row['Sessions']  ?? 0),
    projects: Number(row['Projects']  ?? 0),
  }));

  // Pick the "30 Days" period for granular breakdowns
  const period30 = (raw.periods ?? []).find((p: Record<string, unknown>) => p['label'] === '30 Days')
    ?? (raw.periods?.[2] ?? null);

  // Daily rows — sort ascending by date
  const daily: TokenBurnDailyRow[] = ((period30?.daily ?? []) as Record<string, unknown>[])
    .map((row) => ({
      date:     String(row['Date'] ?? ''),
      cost:     Number(row['Cost (USD)'] ?? 0),
      apiCalls: Number(row['API Calls']  ?? 0),
      sessions: Number(row['Sessions']   ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Model rows — keep as returned (already sorted by cost desc in export)
  const models: TokenBurnModelRow[] = ((period30?.models ?? []) as Record<string, unknown>[])
    .map((row) => ({
      model:   String(row['Model'] ?? ''),
      cost:    Number(row['Cost (USD)']      ?? 0),
      share:   Number(row['Share (%)']       ?? 0),
      oneShot: Number(row['One-shot Rate (%)'] ?? 0),
    }));

  // Activity rows
  const activity: TokenBurnActivityRow[] = ((period30?.activity ?? []) as Record<string, unknown>[])
    .map((row) => ({
      activity: String(row['Activity'] ?? ''),
      cost:     Number(row['Cost (USD)'] ?? 0),
      share:    Number(row['Share (%)']  ?? 0),
    }));

  // Projects — top 12 by cost
  const projects: TokenBurnProjectRow[] = ((raw.projects ?? []) as Record<string, unknown>[])
    .sort((a, b) => Number(b['Cost (USD)'] ?? 0) - Number(a['Cost (USD)'] ?? 0))
    .slice(0, 12)
    .map((row) => {
      const full = String(row['Project'] ?? '');
      // Normalise Windows WSL paths, then use basename for display
      const normalised = full.replace(/\\\\/g, '/').replace(/^.*[\\/]/, '');
      return {
        project:  normalised || full,
        cost:     Number(row['Cost (USD)'] ?? 0),
        share:    Number(row['Share (%)']  ?? 0),
        sessions: Number(row['Sessions']   ?? 0),
        apiCalls: Number(row['API Calls']  ?? 0),
      };
    });

  // Tools — top 10 by calls
  const tools: TokenBurnToolRow[] = ((raw.tools ?? []) as Record<string, unknown>[])
    .sort((a, b) => Number(b['Calls'] ?? 0) - Number(a['Calls'] ?? 0))
    .slice(0, 10)
    .map((row) => ({
      tool:  String(row['Tool']      ?? ''),
      calls: Number(row['Calls']     ?? 0),
      share: Number(row['Share (%)'] ?? 0),
    }));

  return {
    generated: String(raw.generated ?? ''),
    symbol:    String(raw.currency?.symbol ?? '$'),
    summary,
    daily,
    models,
    projects,
    tools,
    activity,
  };
}
