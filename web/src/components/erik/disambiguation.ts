// disambiguation — the "did you mean" layer for ambiguous anatomy terms.
//
// The bug that created this file: searching "bicep" returned biceps FEMORIS (a
// hamstring), because the only "biceps" in Erik's corpus is the hamstring head,
// and the atlas had no biceps brachii at all. Adding the arm muscle fixes the
// atlas; this table fixes the QUESTION — an ambiguous term now shows both
// readings with a one-line differentiator before any raw transcript hit.
//
// MUST stay in sync with DISAMBIGUATION in erikdalton-kb/anatomy_tags.py.

export interface DisambigOption {
  slug: string;    // anatomy/index.json slug
  label: string;   // display name
  region: string;  // ErikRegion key — deep-links into Explore
  note: string;    // the one line that tells them apart
}

const BASE: Record<string, DisambigOption[]> = {
  bicep: [
    { slug: 'biceps-brachii', label: 'Biceps brachii', region: 'arm',
      note: 'The arm muscle — flexes the elbow and supinates the forearm.' },
    { slug: 'hamstring', label: 'Biceps femoris', region: 'knee',
      note: 'A HAMSTRING — the lateral one, ischial tuberosity to fibular head.' },
  ],
  tricep: [
    { slug: 'triceps-brachii', label: 'Triceps brachii', region: 'arm',
      note: 'The three-headed elbow extensor on the back of the arm.' },
    { slug: 'soleus', label: 'Triceps surae (gastroc + soleus)', region: 'foot/ankle',
      note: 'The calf group — gastrocnemius plus soleus into the Achilles.' },
  ],
  quad: [
    { slug: 'vastus', label: 'Quadriceps (vastus group)', region: 'knee',
      note: 'Vastus lateralis / medialis / intermedius — the three deep quad heads.' },
    { slug: 'rectus-femoris', label: 'Rectus femoris', region: 'knee',
      note: 'The fourth quad head — the only one that also crosses the hip.' },
    { slug: 'quadratus-lumborum', label: 'Quadratus lumborum', region: 'low back',
      note: 'Not a quad at all — the deep low-back hip-hiker ("QL").' },
    { slug: 'quadratus-femoris', label: 'Quadratus femoris', region: 'hip/glutes',
      note: 'Deep-six external rotator under the glutes.' },
  ],
  oblique: [
    { slug: 'external-oblique', label: 'External oblique', region: 'core/abdomen',
      note: 'Outer abdominal-wall sheet — fibres run hands-in-pockets.' },
    { slug: 'internal-oblique', label: 'Internal oblique', region: 'core/abdomen',
      note: 'Deep to the external — fibres run the opposite way.' },
    { slug: 'suboccipitals', label: 'Obliquus capitis (sup/inf)', region: 'neck',
      note: 'Suboccipital rotators at the base of the skull, not the abdomen.' },
  ],
  serratus: [
    { slug: 'serratus-anterior', label: 'Serratus anterior', region: 'thoracic/ribs',
      note: 'Ribs → medial scapula; the scapular protractor ("boxer’s muscle").' },
    { slug: 'serratus-posterior', label: 'Serratus posterior sup/inf', region: 'thoracic/ribs',
      note: 'Thin respiratory sheets under the rhomboids and lats.' },
  ],
  teres: [
    { slug: 'teres', label: 'Teres major & minor', region: 'shoulder',
      note: 'Minor is a cuff external rotator; major is "lat’s little helper".' },
    { slug: 'pronator-teres', label: 'Pronator teres', region: 'elbow',
      note: 'Forearm pronator — a median-nerve entrapment site.' },
    { slug: 'quadratus-femoris', label: 'Quadratus femoris', region: 'hip/glutes',
      note: 'Deep hip external rotator, nothing to do with the shoulder teres.' },
  ],
  flexor: [
    { slug: 'flexor-carpi-radialis', label: 'Wrist flexors', region: 'wrist/hand',
      note: 'FCR / FCU / palmaris — the common flexor group at the medial elbow.' },
    { slug: 'psoas', label: 'Hip flexor (psoas / iliacus)', region: 'hip/glutes',
      note: '"Hip flexor" in Erik’s courses almost always means iliopsoas.' },
    { slug: 'flexor-digitorum-superficialis', label: 'Finger flexors', region: 'wrist/hand',
      note: 'FDS / FDP — the tendons that run through the carpal tunnel.' },
  ],
  psoas: [
    { slug: 'psoas', label: 'Psoas major (iliopsoas)', region: 'hip/glutes',
      note: 'T12–L5 to the lesser trochanter — the deep hip flexor.' },
    { slug: 'iliacus', label: 'Iliacus', region: 'hip/glutes',
      note: 'Iliac fossa to the same tendon — psoas + iliacus = iliopsoas.' },
  ],
  trap: [
    { slug: 'trapezius', label: 'Trapezius', region: 'neck',
      note: 'Upper / middle / lower — the big diamond over the upper back.' },
    { slug: 'median-nerve', label: 'Carpal tunnel (entrapment)', region: 'wrist/hand',
      note: 'If you meant nerve "entrapment", start at the median nerve.' },
  ],
  calf: [
    { slug: 'gastrocnemius', label: 'Gastrocnemius', region: 'foot/ankle',
      note: 'The two-headed superficial calf — crosses the knee AND the ankle.' },
    { slug: 'soleus', label: 'Soleus', region: 'foot/ankle',
      note: 'Deep to gastroc, ankle only — the one that limits a bent-knee dorsiflex.' },
  ],
  'it band': [
    { slug: 'iliotibial-tract', label: 'Iliotibial tract (IT band)', region: 'knee',
      note: 'Fascial band, not a muscle — tensioned by TFL and glute max.' },
    { slug: 'tensor-fasciae-latae', label: 'Tensor fasciae latae', region: 'hip/glutes',
      note: 'The muscle that tensions the IT band; usually the real culprit.' },
  ],
};

// alias -> canonical key
const VARIANTS: Record<string, string> = {
  biceps: 'bicep', triceps: 'tricep',
  quads: 'quad', quadriceps: 'quad', quadratus: 'quad',
  obliques: 'oblique', traps: 'trap', calves: 'calf', flexors: 'flexor',
  itb: 'it band', iliotibial: 'it band', 'iliotibial band': 'it band',
  'hip flexor': 'flexor', 'hip flexors': 'flexor',
};

/** Return the clarifier options for a raw query, or null when it's unambiguous. */
export function disambiguate(query: string): DisambigOption[] | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const key = VARIANTS[q] ?? q;
  return BASE[key] ?? null;
}

export const AMBIGUOUS_TERMS = Object.keys(BASE);
