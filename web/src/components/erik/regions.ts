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

export const ERIK_REGIONS: ErikRegion[] = [
  { key: 'head/face',     label: 'Head / Face',   muscles: ['temporalis', 'masseter'],
    query: 'headache cranial occiput release' },
  { key: 'jaw/TMJ',       label: 'Jaw / TMJ',     muscles: ['masseter', 'temporalis'],
    query: 'TMJ jaw masseter release technique' },
  { key: 'neck',          label: 'Neck',          muscles: ['sternocleidomastoid', 'scalene', 'splenius', 'levator-scapulae', 'trapezius'],
    query: 'neck cervical pain scalene release technique' },
  { key: 'shoulder',      label: 'Shoulder',      muscles: ['supraspinatus', 'infraspinatus', 'subscapularis', 'teres', 'pectoralis-minor', 'rhomboid'],
    query: 'shoulder rotator cuff frozen shoulder technique' },
  { key: 'arm',           label: 'Upper Arm',     muscles: ['teres', 'latissimus-dorsi', 'pectoralis-minor'],
    query: 'arm upper extremity release technique' },
  { key: 'elbow',         label: 'Elbow / Forearm', muscles: ['pronator-teres', 'pronator-quadratus', 'flexor-carpi-radialis', 'flexor-carpi-ulnaris'],
    query: 'elbow forearm tennis elbow pronator technique' },
  { key: 'wrist/hand',    label: 'Wrist / Hand',  muscles: ['flexor-carpi-radialis', 'flexor-carpi-ulnaris', 'flexor-digitorum-superficialis', 'flexor-digitorum-profundus', 'palmaris-longus', 'median-nerve'],
    query: 'carpal tunnel wrist median nerve technique' },
  { key: 'thoracic/ribs', label: 'Thoracic / Ribs', muscles: ['rhomboid', 'erector-spinae', 'latissimus-dorsi', 'diaphragm'],
    query: 'thoracic rib mid back kyphosis technique' },
  { key: 'spine/general', label: 'Spine',         muscles: ['erector-spinae'],
    query: 'spine alignment myoskeletal technique' },
  { key: 'core/abdomen',  label: 'Core / Abdomen', muscles: ['diaphragm', 'psoas'],
    query: 'diaphragm psoas abdomen pelvic floor technique' },
  { key: 'low back',      label: 'Low Back',      muscles: ['quadratus-lumborum', 'erector-spinae', 'psoas', 'latissimus-dorsi'],
    query: 'low back lumbar sciatica QL release technique' },
  { key: 'pelvis/SI',     label: 'Pelvis / SI',   muscles: ['gluteus-maximus', 'gluteus-medius', 'piriformis', 'obturator', 'quadratus-femoris'],
    query: 'pelvis sacroiliac SI joint sacrum technique' },
  { key: 'hip/glutes',    label: 'Hip / Glutes',  muscles: ['psoas', 'piriformis', 'gluteus-maximus', 'gluteus-medius', 'tensor-fasciae-latae', 'adductor', 'obturator', 'quadratus-femoris'],
    query: 'hip glute piriformis psoas groin technique' },
  { key: 'knee',          label: 'Knee / Thigh',  muscles: ['hamstring', 'rectus-femoris', 'adductor'],
    query: 'knee patella hamstring quadriceps technique' },
  { key: 'foot/ankle',    label: 'Foot / Ankle',  muscles: ['gastrocnemius', 'soleus', 'plantar-fascia'],
    query: 'foot ankle plantar fasciitis calf technique' },
];

export const REGION_BY_KEY: Record<string, ErikRegion> =
  Object.fromEntries(ERIK_REGIONS.map((r) => [r.key, r]));
