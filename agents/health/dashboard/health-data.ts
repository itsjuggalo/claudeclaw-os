// Health OS dashboard data layer.
//
// A personal health coach logs everything to a SEPARATE, walled-off Supabase
// project (RLS-on-no-policies, service-role only). This module is the only place
// the dashboard server reaches into it: it reads the service-role credentials
// (process env first, then ~/.env), hits PostgREST over plain fetch, and
// aggregates the raw rows into the 7/30/90-day shape the /healthdb page renders.
//
// The owner's goals and risk profile drive the targets + the risk flags. Set
// yours in the EXAMPLE constants below (or read them from your goals table).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- credentials -----------------------------------------------------------
// Process env wins; otherwise parse ~/.env (mirrors agents/health/scripts/db.py
// so the dashboard works whether or not the service inherited the keys).
let cachedCreds: { url: string; key: string } | null = null;

function loadCreds(): { url: string; key: string } {
  if (cachedCreds) return cachedCreds;
  let url = process.env.HEALTH_SUPABASE_URL || '';
  let key = process.env.HEALTH_SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    const envPath = path.join(os.homedir(), '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (k === 'HEALTH_SUPABASE_URL' && !url) url = v;
        if (k === 'HEALTH_SUPABASE_SERVICE_ROLE_KEY' && !key) key = v;
      }
    }
  }
  if (!url || !key) {
    throw new Error('HEALTH_SUPABASE_URL / HEALTH_SUPABASE_SERVICE_ROLE_KEY not found in env or ~/.env');
  }
  cachedCreds = { url: url.replace(/\/$/, ''), key };
  return cachedCreds;
}

export function healthConfigured(): boolean {
  try {
    loadCreds();
    return true;
  } catch {
    return false;
  }
}

async function hfetch(table: string, query: string): Promise<any[]> {
  const { url, key } = loadCreds();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`health supabase ${table} -> HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

// --- date helpers (timezone-aware day bucketing) ---------------------------
function localDate(d: Date, tz: string): string {
  // en-CA renders as YYYY-MM-DD, which is exactly our bucket key.
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function num(x: any): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function round(x: number | null, d = 0): number | null {
  if (x === null) return null;
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}

// Build the ordered list of local-date buckets for the range, newest day last.
function dayWindow(now: Date, tz: string, range: number): string[] {
  const days: string[] = [];
  for (let i = range - 1; i >= 0; i--) {
    days.push(localDate(new Date(now.getTime() - i * 86400000), tz));
  }
  return days;
}

// EXAMPLE targets. Set yours, or read them from your goals table.
const TARGET_WEIGHT = 80.0;
const BASELINE_WEIGHT = 100.0;
const PROTEIN_LOW = 150;
const PROTEIN_HIGH = 190;
const CAFFEINE_CEILING = 300;

export interface HealthDashboard {
  generatedAt: string;
  range: number;
  timezone: string;
  city: string | null;
  environment: string | null;
  privateChef: boolean;
  dayN: number | null;
  weight: any;
  bodyComp: any;
  nutrition: any;
  flags: any;
  caffeine: any;
  training: any;
  vitals: any;
  checkins: any;
  recovery: any;
  supplements: any;
  goals: any[];
  labs: any;
}

export async function getHealthDashboard(range: number): Promise<HealthDashboard> {
  const r = [7, 30, 90].includes(range) ? range : 30;
  const now = new Date();

  // Context (where the user is + which clock their "days" run on).
  const ctxRows = await hfetch('context', 'select=*&order=effective_from.desc&limit=1');
  const ctx = ctxRows[0] || {};
  const tz = ctx.timezone || 'UTC';

  const window = dayWindow(now, tz, r);
  const windowSet = new Set(window);
  // Over-fetch by a day-and-a-half so a row near a tz boundary still buckets in.
  const cutoffIso = new Date(now.getTime() - (r + 1.5) * 86400000).toISOString();
  const enc = encodeURIComponent;

  // Fire every read in parallel — one round-trip burst.
  const [
    baselineRows, weighAll, bodyRows,
    foodRows, caffRows, workoutRows,
    suppRows, vitalRows, checkinRows,
    goalRows, labRows, bpLatestRows,
  ] = await Promise.all([
    hfetch('weigh_ins', 'select=measured_at,weight_kg,body_fat_pct&is_baseline=eq.true&limit=1'),
    hfetch('weigh_ins', 'select=measured_at,weight_kg,body_fat_pct,source&order=measured_at.desc&limit=120'),
    hfetch('body_measurements', 'select=*&order=measured_at.desc&limit=120'),
    hfetch('food_log', `select=eaten_at,meal,est_calories,protein_g,carbs_g,fat_g,sat_fat_flag,sodium_flag,sugar_flag&eaten_at=gte.${enc(cutoffIso)}&order=eaten_at.asc&limit=2000`),
    hfetch('caffeine_log', `select=consumed_at,caffeine_mg,source&consumed_at=gte.${enc(cutoffIso)}&order=consumed_at.asc&limit=1000`),
    hfetch('workouts', `select=performed_at,type,duration_min,perceived_exertion&performed_at=gte.${enc(cutoffIso)}&order=performed_at.asc&limit=500`),
    hfetch('supplements_log', `select=taken_at,supplement,taken&taken_at=gte.${enc(cutoffIso)}&order=taken_at.asc&limit=2000`),
    hfetch('vitals', `select=measured_at,metric,value,unit&measured_at=gte.${enc(cutoffIso)}&order=measured_at.asc&limit=1000`),
    hfetch('daily_checkins', `select=checkin_date,sleep_hours,energy_1_10,mood&order=checkin_date.desc&limit=120`),
    hfetch('goals', 'select=metric,start_value,current_value,target_value,target_date&order=id'),
    hfetch('lab_results', 'select=drawn_at,marker,value,unit,flag,notes&order=drawn_at.desc&limit=200'),
    hfetch('vitals', 'select=metric,value,measured_at&metric=in.(bp_systolic,bp_diastolic)&order=measured_at.desc&limit=20'),
  ]);

  // --- day N since baseline --------------------------------------------------
  const baseline = baselineRows[0] || {};
  const baseDateStr = (baseline.measured_at || '2026-05-11').slice(0, 10);
  let dayN: number | null = null;
  try {
    const base = new Date(baseDateStr + 'T00:00:00Z');
    dayN = Math.floor((new Date(localDate(now, tz) + 'T00:00:00Z').getTime() - base.getTime()) / 86400000) + 1;
  } catch { /* leave null */ }

  // --- weight ----------------------------------------------------------------
  const baseW = num(baseline.weight_kg) ?? BASELINE_WEIGHT;
  const latest = weighAll[0] || baseline;
  const latestW = num(latest.weight_kg) ?? baseW;
  const lost = round(baseW - latestW, 1);
  const toGo = round(latestW - TARGET_WEIGHT, 1);
  const totalToLose = baseW - TARGET_WEIGHT;
  const pctToGoal = totalToLose > 0 ? round(Math.max(0, Math.min(100, ((baseW - latestW) / totalToLose) * 100)), 1) : null;

  // Rate of loss from baseline -> latest (more stable than a sparse in-range slope).
  let ratePerWeek: number | null = null;
  let projectedTargetDate: string | null = null;
  try {
    const base = new Date(baseDateStr + 'T00:00:00Z');
    const latestDate = new Date((latest.measured_at || '').slice(0, 10) + 'T00:00:00Z');
    const weeks = (latestDate.getTime() - base.getTime()) / (7 * 86400000);
    if (weeks > 0.5 && lost !== null) {
      ratePerWeek = round(lost / weeks, 2);
      if (ratePerWeek && ratePerWeek > 0 && toGo && toGo > 0) {
        const weeksLeft = toGo / ratePerWeek;
        projectedTargetDate = new Date(now.getTime() + weeksLeft * 7 * 86400000).toISOString().slice(0, 10);
      }
    }
  } catch { /* leave null */ }

  // In-range weight series for the chart (always anchor with the baseline point).
  const weighSeries = weighAll
    .filter((w) => windowSet.has(localDate(new Date(w.measured_at), tz)))
    .map((w) => ({ date: localDate(new Date(w.measured_at), tz), kg: num(w.weight_kg), bodyFat: num(w.body_fat_pct) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // --- body composition (mostly sparse: InBody baseline + any retest) --------
  const bodyLatest = bodyRows[0] || {};
  const bodyBase = bodyRows[bodyRows.length - 1] || bodyLatest;
  const bodyComp = {
    latestBodyFatPct: num(latest.body_fat_pct) ?? num(baseline.body_fat_pct),
    baselineBodyFatPct: num(baseline.body_fat_pct),
    skeletalMuscleKg: num(bodyLatest.skeletal_muscle_kg),
    visceralLevel: num(bodyLatest.visceral_level),
    visceralBaseline: num(bodyBase.visceral_level),
    trunkFatKg: num(bodyLatest.trunk_fat_kg),
    trunkFatBaseline: num(bodyBase.trunk_fat_kg),
    waistCm: num(bodyLatest.waist_cm),
    hipCm: num(bodyLatest.hip_cm),
    measuredAt: (bodyLatest.measured_at || '').slice(0, 10) || null,
  };

  // --- nutrition (the core ask) ---------------------------------------------
  type Day = { calories: number; protein: number; carbs: number; fat: number; meals: number; sat: number; sodium: number; sugar: number };
  const byDay = new Map<string, Day>();
  for (const d of window) byDay.set(d, { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0, sat: 0, sodium: 0, sugar: 0 });
  for (const f of foodRows) {
    const d = localDate(new Date(f.eaten_at), tz);
    const bucket = byDay.get(d);
    if (!bucket) continue;
    bucket.calories += num(f.est_calories) || 0;
    bucket.protein += num(f.protein_g) || 0;
    bucket.carbs += num(f.carbs_g) || 0;
    bucket.fat += num(f.fat_g) || 0;
    bucket.meals += 1;
    if (f.sat_fat_flag) bucket.sat += 1;
    if (f.sodium_flag) bucket.sodium += 1;
    if (f.sugar_flag) bucket.sugar += 1;
  }
  const dailyNutrition = window.map((d) => {
    const b = byDay.get(d)!;
    return { date: d, calories: round(b.calories), protein: round(b.protein), carbs: round(b.carbs), fat: round(b.fat), meals: b.meals };
  });
  const loggedDays = dailyNutrition.filter((d) => d.meals > 0);
  const nLogged = loggedDays.length || 1;
  const avg = (sel: (d: any) => number | null) => round(loggedDays.reduce((s, d) => s + (sel(d) || 0), 0) / nLogged);
  const avgCalories = avg((d) => d.calories);
  const avgProtein = avg((d) => d.protein);
  const avgCarbs = avg((d) => d.carbs);
  const avgFat = avg((d) => d.fat);
  const proteinHitDays = loggedDays.filter((d) => (d.protein || 0) >= PROTEIN_LOW).length;
  // Macro split by calories (P 4, C 4, F 9).
  const pCal = (avgProtein || 0) * 4;
  const cCal = (avgCarbs || 0) * 4;
  const fCal = (avgFat || 0) * 9;
  const macroTot = pCal + cCal + fCal || 1;
  const nutrition = {
    avgCalories, avgProtein, avgCarbs, avgFat,
    daysLogged: loggedDays.length, totalMeals: foodRows.filter((f) => windowSet.has(localDate(new Date(f.eaten_at), tz))).length,
    proteinTargetLow: PROTEIN_LOW, proteinTargetHigh: PROTEIN_HIGH,
    pctDaysProteinHit: round((proteinHitDays / nLogged) * 100),
    macroSplit: { proteinPct: round((pCal / macroTot) * 100), carbsPct: round((cCal / macroTot) * 100), fatPct: round((fCal / macroTot) * 100) },
    daily: dailyNutrition,
  };

  // --- genetics-aware risk flags --------------------------------------------
  const dailyFlags = window.map((d) => {
    const b = byDay.get(d)!;
    return { date: d, sat: b.sat, sodium: b.sodium, sugar: b.sugar };
  });
  const flags = {
    satFatMeals: dailyFlags.reduce((s, d) => s + d.sat, 0),
    sodiumMeals: dailyFlags.reduce((s, d) => s + d.sodium, 0),
    sugarMeals: dailyFlags.reduce((s, d) => s + d.sugar, 0),
    satFatDays: dailyFlags.filter((d) => d.sat > 0).length,
    sodiumDays: dailyFlags.filter((d) => d.sodium > 0).length,
    sugarDays: dailyFlags.filter((d) => d.sugar > 0).length,
    daily: dailyFlags,
  };

  // --- caffeine (vs the daily ceiling) ---------------------------------------
  const caffByDay = new Map<string, number>();
  for (const d of window) caffByDay.set(d, 0);
  for (const c of caffRows) {
    const d = localDate(new Date(c.consumed_at), tz);
    if (caffByDay.has(d)) caffByDay.set(d, caffByDay.get(d)! + (num(c.caffeine_mg) || 0));
  }
  const caffDaily = window.map((d) => ({ date: d, mg: round(caffByDay.get(d)!) }));
  const caffLoggedDays = caffDaily.filter((d) => (d.mg || 0) > 0);
  const caffeine = {
    ceiling: CAFFEINE_CEILING,
    avgMgPerDay: round(caffLoggedDays.reduce((s, d) => s + (d.mg || 0), 0) / (caffLoggedDays.length || 1)),
    daysOverCeiling: caffDaily.filter((d) => (d.mg || 0) > CAFFEINE_CEILING).length,
    daily: caffDaily,
  };

  // --- training (resistance is ~99% of his work) -----------------------------
  const inRangeWorkouts = workoutRows.filter((w) => windowSet.has(localDate(new Date(w.performed_at), tz)));
  const byType: Record<string, number> = {};
  let totalMinutes = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  for (const w of inRangeWorkouts) {
    const t = (w.type || 'other') as string;
    byType[t] = (byType[t] || 0) + 1;
    totalMinutes += num(w.duration_min) || 0;
    if (num(w.perceived_exertion) !== null) { rpeSum += w.perceived_exertion; rpeCount += 1; }
  }
  const workoutByDay = new Map<string, number>();
  for (const d of window) workoutByDay.set(d, 0);
  for (const w of inRangeWorkouts) {
    const d = localDate(new Date(w.performed_at), tz);
    if (workoutByDay.has(d)) workoutByDay.set(d, workoutByDay.get(d)! + 1);
  }
  const training = {
    sessions: inRangeWorkouts.length,
    byType,
    totalMinutes: round(totalMinutes),
    avgRpe: rpeCount ? round(rpeSum / rpeCount, 1) : null,
    perWeek: round((inRangeWorkouts.length / r) * 7, 1),
    daily: window.map((d) => ({ date: d, count: workoutByDay.get(d)! })),
  };

  // --- vitals: BP (the urgent gap), resting HR, sleep ------------------------
  const vBy = (metric: string) =>
    vitalRows
      .filter((v) => v.metric === metric && windowSet.has(localDate(new Date(v.measured_at), tz)))
      .map((v) => ({ date: localDate(new Date(v.measured_at), tz), v: num(v.value) }));
  const sys = vBy('bp_systolic');
  const dia = vBy('bp_diastolic');
  const bpByDate = new Map<string, { systolic: number | null; diastolic: number | null }>();
  for (const s of sys) bpByDate.set(s.date, { systolic: s.v, diastolic: bpByDate.get(s.date)?.diastolic ?? null });
  for (const d of dia) bpByDate.set(d.date, { systolic: bpByDate.get(d.date)?.systolic ?? null, diastolic: d.v });
  const bp = [...bpByDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? -1 : 1));
  // Latest BP regardless of range (for the always-current BP box at the top).
  const latestSys = bpLatestRows.find((r: any) => r.metric === 'bp_systolic');
  const latestDia = bpLatestRows.find((r: any) => r.metric === 'bp_diastolic');
  const vitals = {
    hasBP: bp.length > 0,
    bp,
    restingHr: vBy('resting_hr'),
    sleep: vBy('sleep_hours'),
    latest: latestSys
      ? { systolic: num(latestSys.value), diastolic: latestDia ? num(latestDia.value) : null, at: (latestSys.measured_at || '').slice(0, 10) }
      : null,
  };

  // --- daily check-ins (sleep / energy / mood) -------------------------------
  const checkRows = checkinRows.filter((c) => windowSet.has((c.checkin_date || '').slice(0, 10)));
  const checkDaily = window.map((d) => {
    const row = checkRows.find((c) => (c.checkin_date || '').slice(0, 10) === d);
    return { date: d, sleep: num(row?.sleep_hours), energy: num(row?.energy_1_10), mood: row?.mood || null };
  });
  const sleepVals = checkDaily.map((d) => d.sleep).filter((v): v is number => v !== null);
  const energyVals = checkDaily.map((d) => d.energy).filter((v): v is number => v !== null);
  const checkins = {
    avgSleep: sleepVals.length ? round(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length, 1) : null,
    avgEnergy: energyVals.length ? round(energyVals.reduce((a, b) => a + b, 0) / energyVals.length, 1) : null,
    daily: checkDaily,
  };

  // --- sleep & recovery (WHOOP) ----------------------------------------------
  // Recovery %, HRV, resting HR and sleep hours land in the vitals table as
  // metrics recovery_pct, hrv_ms, resting_hr and sleep_hours. Until the WHOOP
  // auto-sync exists they are logged manually via Telegram. Sleep hours fall
  // back to the subjective daily_checkins figure when no vitals row exists.
  const mapBy = (metric: string) => {
    const m = new Map<string, number | null>();
    for (const x of vBy(metric)) m.set(x.date, x.v);
    return m;
  };
  const recMap = mapBy('recovery_pct');
  const hrvMap = mapBy('hrv_ms');
  const rhrMap = mapBy('resting_hr');
  const slpMap = mapBy('sleep_hours');
  const checkSleep = new Map<string, number | null>(checkDaily.map((x) => [x.date, x.sleep]));
  const recDaily = window.map((d) => ({
    date: d,
    recovery: recMap.get(d) ?? null,
    hrv: hrvMap.get(d) ?? null,
    rhr: rhrMap.get(d) ?? null,
    sleep: slpMap.get(d) ?? checkSleep.get(d) ?? null,
  }));
  type RecKey = 'recovery' | 'hrv' | 'rhr' | 'sleep';
  const recColVals = (k: RecKey) => recDaily.map((x) => x[k]).filter((v): v is number => v !== null);
  const recAvg = (k: RecKey, dp = 0) => {
    const v = recColVals(k);
    return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, dp) : null;
  };
  const recLatest = (k: RecKey) => {
    for (let i = recDaily.length - 1; i >= 0; i--) if (recDaily[i][k] !== null) return recDaily[i][k];
    return null;
  };
  const sleepNights = recColVals('sleep');
  const recovery = {
    hasData: recDaily.some((x) => x.recovery !== null || x.hrv !== null || x.rhr !== null || x.sleep !== null),
    latestRecovery: recLatest('recovery'),
    latestHrv: recLatest('hrv'),
    latestRhr: recLatest('rhr'),
    latestSleep: recLatest('sleep'),
    avgRecovery: recAvg('recovery'),
    avgHrv: recAvg('hrv'),
    avgRhr: recAvg('rhr'),
    avgSleep: recAvg('sleep', 1),
    bestSleep: sleepNights.length ? round(Math.max(...sleepNights), 1) : null,
    nights: sleepNights.length,
    daily: recDaily,
  };

  // --- supplement adherence --------------------------------------------------
  const inRangeSupp = suppRows.filter((s) => windowSet.has(localDate(new Date(s.taken_at), tz)));
  const suppMap = new Map<string, { taken: number; total: number }>();
  let takenTotal = 0;
  for (const s of inRangeSupp) {
    const name = s.supplement || 'unknown';
    const m = suppMap.get(name) || { taken: 0, total: 0 };
    m.total += 1;
    if (s.taken) { m.taken += 1; takenTotal += 1; }
    suppMap.set(name, m);
  }
  const supplements = {
    adherencePct: inRangeSupp.length ? round((takenTotal / inRangeSupp.length) * 100) : null,
    taken: takenTotal,
    total: inRangeSupp.length,
    bySupplement: [...suppMap.entries()]
      .map(([name, m]) => ({ name, taken: m.taken, total: m.total, pct: round((m.taken / m.total) * 100) }))
      .sort((a, b) => b.total - a.total),
  };

  // --- goals (progress against the organizing targets) -----------------------
  const goals = goalRows.map((g) => {
    const start = num(g.start_value);
    const current = num(g.current_value);
    const target = num(g.target_value);
    let pct: number | null = null;
    if (start !== null && target !== null && current !== null && start !== target) {
      pct = round(Math.max(0, Math.min(100, ((start - current) / (start - target)) * 100)), 0);
    }
    return { metric: g.metric, start, current, target, targetDate: g.target_date, pct };
  });

  // --- labs (latest per marker + retest series) ------------------------------
  const latestByMarker = new Map<string, any>();
  const drawsByMarker = new Map<string, number>();
  for (const l of labRows) {
    drawsByMarker.set(l.marker, (drawsByMarker.get(l.marker) || 0) + 1);
    if (!latestByMarker.has(l.marker)) {
      latestByMarker.set(l.marker, { marker: l.marker, value: num(l.value), unit: l.unit, flag: l.flag, drawnAt: (l.drawn_at || '').slice(0, 10), notes: l.notes });
    }
  }
  const labs = {
    markers: [...latestByMarker.values()].map((m) => ({ ...m, draws: drawsByMarker.get(m.marker) || 1 })),
  };

  return {
    generatedAt: now.toISOString(),
    range: r,
    timezone: tz,
    city: ctx.city || null,
    environment: ctx.environment || null,
    privateChef: !!ctx.private_chef,
    dayN,
    weight: {
      baselineKg: round(baseW, 1),
      latestKg: round(latestW, 1),
      targetKg: TARGET_WEIGHT,
      lostKg: lost,
      toGoKg: toGo,
      pctToGoal,
      ratePerWeek,
      projectedTargetDate,
      latestAt: (latest.measured_at || '').slice(0, 10) || null,
      baselineAt: baseDateStr,
      series: weighSeries,
    },
    bodyComp,
    nutrition,
    flags,
    caffeine,
    training,
    vitals,
    checkins,
    recovery,
    supplements,
    goals,
    labs,
  };
}
