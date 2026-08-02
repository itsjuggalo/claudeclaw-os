// Body-region model for the Erik Dalton learning explorer.
//
// Each region's `key` matches EXACTLY the `region` tag written onto technique
// frames by erikdalton_region_tags.py (so clicking a region filters the 2,107
// frames), and `muscles` lists the anatomy/index.json slugs that live in that
// region (so the explorer can show the muscle plates). `query` is what we throw
// at the warm KB search to pull Erik's lessons for that area.
//
// Frame-tag region counts (for reference): neck 276 · shoulder 255 · low back 182 ·
// hip/glutes 172 · pelvis/SI 152 · knee 139 · foot/ankle 139 · spine/general 128 ·
// thoracic/ribs 125 · elbow 100 · arm 89 · core/abdomen 53 · head/face 49 ·
// wrist/hand 42 · jaw/TMJ 9.

export interface ErikRegion {
  key: string;       // must equal the frame `region` tag
  label: string;     // display name
  muscles: string[]; // anatomy/index.json slugs in this region
  query: string;     // KB search query for "Erik's techniques here"
}

// 2026-08-01: the atlas grew from 38 → 78 plates (whole-body coverage — upper
// arm, quads, calf stabilisers, abdominal wall, suboccipitals, IT band). Every
// new slug is placed in the region(s) a bodyworker would look for it in.
export const ERIK_REGIONS: ErikRegion[] = [
  { key: 'head/face',     label: 'Head / Face',   muscles: ['temporalis', 'masseter', 'suboccipitals'],
    query: 'headache cranial occiput release' },
  { key: 'jaw/TMJ',       label: 'Jaw / TMJ',     muscles: ['masseter', 'temporalis'],
    query: 'TMJ jaw masseter release technique' },
  { key: 'neck',          label: 'Neck',          muscles: ['sternocleidomastoid', 'scalene', 'splenius', 'levator-scapulae', 'trapezius', 'suboccipitals', 'semispinalis', 'longus-colli', 'multifidus'],
    query: 'neck cervical pain scalene release technique' },
  { key: 'shoulder',      label: 'Shoulder',      muscles: ['supraspinatus', 'infraspinatus', 'subscapularis', 'teres', 'pectoralis-minor', 'pectoralis-major', 'rhomboid', 'deltoid', 'serratus-anterior', 'subclavius', 'coracobrachialis'],
    query: 'shoulder rotator cuff frozen shoulder technique' },
  { key: 'arm',           label: 'Upper Arm',     muscles: ['biceps-brachii', 'triceps-brachii', 'brachialis', 'coracobrachialis', 'deltoid', 'teres', 'latissimus-dorsi', 'pectoralis-minor'],
    query: 'arm upper extremity biceps triceps release technique' },
  { key: 'elbow',         label: 'Elbow / Forearm', muscles: ['brachioradialis', 'supinator', 'wrist-extensors', 'pronator-teres', 'pronator-quadratus', 'brachialis', 'flexor-carpi-radialis', 'flexor-carpi-ulnaris'],
    query: 'elbow forearm tennis elbow pronator technique' },
  { key: 'wrist/hand',    label: 'Wrist / Hand',  muscles: ['flexor-carpi-radialis', 'flexor-carpi-ulnaris', 'flexor-digitorum-superficialis', 'flexor-digitorum-profundus', 'palmaris-longus', 'wrist-extensors', 'median-nerve'],
    query: 'carpal tunnel wrist median nerve technique' },
  { key: 'thoracic/ribs', label: 'Thoracic / Ribs', muscles: ['rhomboid', 'erector-spinae', 'latissimus-dorsi', 'diaphragm', 'serratus-anterior', 'serratus-posterior', 'intercostals', 'semispinalis', 'multifidus'],
    query: 'thoracic rib mid back kyphosis technique' },
  { key: 'spine/general', label: 'Spine',         muscles: ['erector-spinae', 'multifidus', 'semispinalis', 'thoracolumbar-fascia'],
    query: 'spine alignment myoskeletal technique' },
  { key: 'core/abdomen',  label: 'Core / Abdomen', muscles: ['diaphragm', 'psoas', 'iliacus', 'rectus-abdominis', 'external-oblique', 'internal-oblique', 'transversus-abdominis', 'intercostals', 'pelvic-floor'],
    query: 'diaphragm psoas abdomen pelvic floor technique' },
  { key: 'low back',      label: 'Low Back',      muscles: ['quadratus-lumborum', 'erector-spinae', 'psoas', 'latissimus-dorsi', 'multifidus', 'thoracolumbar-fascia'],
    query: 'low back lumbar sciatica QL release technique' },
  { key: 'pelvis/SI',     label: 'Pelvis / SI',   muscles: ['gluteus-maximus', 'gluteus-medius', 'gluteus-minimus', 'piriformis', 'obturator', 'quadratus-femoris', 'gemellus', 'pelvic-floor', 'sacrotuberous-ligament'],
    query: 'pelvis sacroiliac SI joint sacrum technique' },
  { key: 'hip/glutes',    label: 'Hip / Glutes',  muscles: ['psoas', 'iliacus', 'piriformis', 'gluteus-maximus', 'gluteus-medius', 'gluteus-minimus', 'tensor-fasciae-latae', 'iliotibial-tract', 'adductor', 'pectineus', 'gracilis', 'sartorius', 'obturator', 'quadratus-femoris', 'gemellus'],
    query: 'hip glute piriformis psoas groin technique' },
  { key: 'knee',          label: 'Knee / Thigh',  muscles: ['hamstring', 'semitendinosus', 'semimembranosus', 'rectus-femoris', 'vastus', 'adductor', 'gracilis', 'sartorius', 'iliotibial-tract', 'popliteus', 'plantaris'],
    query: 'knee patella hamstring quadriceps technique' },
  { key: 'foot/ankle',    label: 'Foot / Ankle',  muscles: ['gastrocnemius', 'soleus', 'plantar-fascia', 'tibialis-anterior', 'tibialis-posterior', 'fibularis', 'abductor-hallucis', 'popliteus'],
    query: 'foot ankle plantar fasciitis calf technique' },
];

export const REGION_BY_KEY: Record<string, ErikRegion> =
  Object.fromEntries(ERIK_REGIONS.map((r) => [r.key, r]));

export const LABEL_BY_KEY: Record<string, string> =
  Object.fromEntries(ERIK_REGIONS.map((r) => [r.key, r.label]));
export const KEY_BY_LABEL: Record<string, string> =
  Object.fromEntries(ERIK_REGIONS.map((r) => [r.label, r.key]));

// Anatomically-adjacent / easily-confused region pairs. Used by the "Spot the
// region" quiz to (a) avoid offering near-synonym distractors (so the 4 chips are
// clearly distinct and answerable from a clip) and (b) grade a neighbouring guess
// as "close" (amber) instead of a hard miss. Bidirectional; keys are region keys.
export const REGION_NEIGHBORS: Record<string, string[]> = {
  'head/face': ['jaw/TMJ', 'neck'],
  'jaw/TMJ': ['head/face', 'neck'],
  'neck': ['head/face', 'jaw/TMJ', 'shoulder', 'thoracic/ribs'],
  'shoulder': ['neck', 'arm', 'thoracic/ribs'],
  'arm': ['shoulder', 'elbow'],
  'elbow': ['arm', 'wrist/hand'],
  'wrist/hand': ['elbow'],
  'thoracic/ribs': ['neck', 'shoulder', 'spine/general', 'low back'],
  'spine/general': ['thoracic/ribs', 'low back', 'neck'],
  'core/abdomen': ['low back', 'pelvis/SI', 'thoracic/ribs'],
  'low back': ['thoracic/ribs', 'spine/general', 'pelvis/SI', 'hip/glutes', 'core/abdomen'],
  'pelvis/SI': ['low back', 'hip/glutes', 'core/abdomen'],
  'hip/glutes': ['pelvis/SI', 'low back', 'knee'],
  'knee': ['hip/glutes', 'foot/ankle'],
  'foot/ankle': ['knee'],
};

// Are two region KEYS adjacent (one is in the other's neighbour set)?
export function regionsAreNeighbors(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  return (REGION_NEIGHBORS[a] || []).includes(b) || (REGION_NEIGHBORS[b] || []).includes(a);
}
