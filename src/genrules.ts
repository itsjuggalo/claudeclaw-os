// genrules.ts — "hard rules, learned the expensive way" from the DaForgeLayer
// local-studio method (earlyaidopters, 2026-06). Baked into every Create-page gen
// so output quality holds without the user having to remember them. Pure functions,
// no I/O — unit-tested in genrules.test.ts.

export interface GenRuleInput {
  prompt: string;
  negative?: string;
  cfg?: number;
  kind?: 'image' | 'video';
  hasLora?: boolean;      // any LoRA in the chain (gates the person-framing rule)
}
export interface GenRuleOutput { prompt: string; negative?: string; notes: string[]; }

const FRAMING_RE = /\b(close[- ]?ups?|medium shots?|portraits?|head[- ]and[- ]shoulders|waist[- ]up|cowboy shots?|full[- ]?body|wide shots?|establishing shots?)\b/i;
const PERSON_RE  = /\b(woman|man|girl|guy|person|people|portrait|faces?|she|he|her|him|lady|male|female|model|character|boy|elf|warrior|queen|king)\b/i;
const LIGHT_MENTION_RE = /\b(lit|lighting|glow(?:ing)?|backlit|rim[- ]?light|illuminat)/i;
const LIGHT_SOURCE_RE  = /\b(window|lamp|candle|neon|sun(?:light)?|fire(?:place)?|screen|monitor|street ?light|bulb|fixture|moonlight|spotlight|torch|lantern|headlight)\b/i;
// camera/tripod words RENDER the object in motion models — strip from video prompts.
const CAMERA_RE = /\b(on a tripod|tripods?|cameras?(?:\s+(?:pan|zoom|dolly|move(?:ment)?|shot|angle))?|dolly|handheld camera|steadicam|gimbal)\b/gi;

export function applyGenRules(i: GenRuleInput): GenRuleOutput {
  const notes: string[] = [];
  let prompt = (i.prompt || '').trim();
  let negative = i.negative;

  // Rule 1 — face/identity LoRAs fail 3 ways at full-body (identity drift, CG look,
  // bad hands). Default person gens to medium-or-closer when no framing was given.
  if (i.hasLora && PERSON_RE.test(prompt) && !FRAMING_RE.test(prompt)) {
    prompt += ', medium shot, head-and-shoulders framing';
    notes.push('framing→medium (face LoRAs drift at full-body)');
  }
  // Rule 2 — ground every light in a visible in-frame emitter, else it lands as
  // eye-glow ("glow on her face" with no source).
  if (LIGHT_MENTION_RE.test(prompt) && !LIGHT_SOURCE_RE.test(prompt)) {
    prompt += ', lit by a visible in-frame light source';
    notes.push('lighting→grounded in-frame emitter');
  }
  // Rule 3 — "camera"/"tripod" render the object; strip from MOTION prompts and do
  // camera moves in post (Ken-Burns). Image prompts keep them.
  if (i.kind === 'video') {
    const cleaned = prompt.replace(CAMERA_RE, '')
      .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ')
      .replace(/^[,\s]+|[,\s]+$/g, '').trim();
    if (cleaned !== prompt) { prompt = cleaned; notes.push('motion→stripped camera/tripod tokens'); }
  }
  // Rule 4 — distilled models at cfg≈1.0 ignore the negative prompt; clear it so the
  // UI doesn't imply it's doing anything.
  if ((i.cfg ?? 7) <= 1.05 && negative) {
    negative = '';
    notes.push('cfg≈1→negative cleared (ignored by distilled model)');
  }
  return { prompt, negative, notes };
}

// Rule 5 — character LoRA strength: keep ~0.95, never lower it chasing realism (it
// drifts identity; fix CG-look with framing + grounded light instead). Used as the
// DEFAULT when a character LoRA has no explicit strength — never overrides the user.
export function loraStrength(explicit: number | undefined, isCharacter: boolean, recommended?: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit;   // honor explicit choice
  if (isCharacter) return Math.max(0.9, recommended ?? 0.95);          // floor at 0.9 for identity
  return recommended ?? 0.8;                                           // style LoRAs keep prior default
}
