// Shared caption helpers for the clip tiles in Explore and Conditions.
//
// They live here rather than in either tab because ConditionsTab already imports
// frameScore from ExploreTab — having ExploreTab import back would make the two
// modules circular. Both tabs must label a clip identically, so the rule has one
// home.

/** A usable name for a clip. "VTS_01_1" is a DVD-VOB filename, not a lesson —
 *  when that's all we have, fall back to what the segment demonstrably covers
 *  (derived from its own transcript by name_dvd_segments.py). Never invents a
 *  title Erik didn't give. */
export function clipName(title: string, covers?: string): string {
  if (!/^VTS[_0-9]*$/i.test(title)) return title.replace(/^\s*\d+\s*[.)-]?\s*/, '');
  return covers ? `DVD segment — ${covers}` : 'DVD segment';
}

/** Transcript frames start wherever the ASR window opened, so captions read
 *  "and I'm going to bring it into a little bit of arm abduction". Start at the
 *  next sentence when one begins early enough to keep most of the text —
 *  otherwise leave it alone rather than throw away the useful half. */
export function fromSentence(text: string): string {
  const t = (text || '').trim();
  const i = t.search(/[.!?]\s+(?=[A-Z])/);
  return i >= 0 && i < t.length * 0.35 ? t.slice(i + 1).trim() : t;
}
