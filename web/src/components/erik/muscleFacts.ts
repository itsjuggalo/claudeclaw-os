// muscleFacts — the study layer behind every plate in the Erik Dalton atlas.
//
// Before this file the Explore tab showed a 3D render and a name. That is a
// picture book, not a learning platform: for the Myoskeletal Alignment exams you
// need origin / insertion / action / referral pattern and the assessment that
// implicates the muscle. Each entry is deliberately short — exam-recall length,
// not a textbook page — and `cue` is the practical Myoskeletal note (how Erik
// approaches it, or the trap people fall into).
//
// Keys are anatomy/index.json slugs. Anything missing simply renders without the
// study block, so the atlas can grow ahead of this file without breaking.

export interface MuscleFact {
  origin: string;
  insertion: string;
  action: string;
  refers?: string;   // typical referral / symptom pattern
  cue?: string;      // Myoskeletal / practical note
  test?: string;     // the assessment that implicates it
}

export const MUSCLE_FACTS: Record<string, MuscleFact> = {
  // ── head / jaw ──────────────────────────────────────────────────────────
  masseter: {
    origin: 'Zygomatic arch', insertion: 'Angle & ramus of the mandible',
    action: 'Elevates the mandible (closes the jaw); superficial fibres protrude it',
    refers: 'Cheek, lower molars, ear and TMJ; a classic "ear pain with no ear pathology"',
    test: 'Opening range < 3 knuckles, or deviation of the jaw on opening',
    cue: 'Work it with the jaw slightly open and unloaded — clamping down guards it shut.',
  },
  temporalis: {
    origin: 'Temporal fossa', insertion: 'Coronoid process of the mandible',
    action: 'Elevates and retracts the mandible',
    refers: 'Temple headache and upper teeth — often mistaken for migraine',
    test: 'Tenderness above the ear that reproduces the client’s headache',
    cue: 'Pairs with masseter in clenchers; treat both or the jaw re-guards.',
  },
  suboccipitals: {
    origin: 'C1 posterior tubercle & C2 spinous process',
    insertion: 'Occiput (inferior nuchal line) and C1 transverse process',
    action: 'Extends and rotates the head on C1–C2; dense proprioceptive feedback',
    refers: 'Band of pain wrapping from the occiput through to behind the eye',
    test: 'Forward-head posture with restricted C1–C2 rotation in flexion',
    cue: 'Erik’s occiput-balancing work lives here — sustained, tiny, non-force pressure. Huge spindle density; force makes it worse.',
  },

  // ── neck ────────────────────────────────────────────────────────────────
  sternocleidomastoid: {
    origin: 'Manubrium (sternal head) & medial clavicle (clavicular head)',
    insertion: 'Mastoid process and superior nuchal line',
    action: 'Unilateral: side-bends same side, rotates opposite. Bilateral: flexes the neck',
    refers: 'Forehead, eye, ear, and the top of the head — plus dizziness/visual disturbance',
    test: 'Head-rotation asymmetry; the "chin points away from the tight side" pattern',
    cue: 'The carotid sits just behind — pincer-grip the belly, never press flat into the triangle.',
  },
  scalene: {
    origin: 'Transverse processes of C2–C7',
    insertion: 'First rib (anterior & middle) and second rib (posterior)',
    action: 'Side-bends the neck; elevates the upper ribs in inspiration',
    refers: 'Down the arm to the thumb side — the great TOS impostor',
    test: 'Adson’s / Roos (EAST) reproduces arm symptoms',
    cue: 'Prime suspect in thoracic outlet. Chronic chest-breathing keeps them on all day.',
  },
  splenius: {
    origin: 'Ligamentum nuchae & spinous processes C7–T6',
    insertion: 'Mastoid + occiput (capitis), transverse processes C1–C3 (cervicis)',
    action: 'Extends and rotates the head/neck to the same side',
    refers: 'Top of the head (capitis) and to the back of the eye (cervicis)',
    test: 'Loss of contralateral rotation with a stiff, "corded" upper back',
    cue: 'Sits between trapezius and the deeper semispinalis — angle matters more than depth.',
  },
  'levator-scapulae': {
    origin: 'Transverse processes of C1–C4', insertion: 'Superior medial border of the scapula',
    action: 'Elevates the scapula and downwardly rotates it; side-bends the neck',
    refers: 'The classic "crick" at the superior scapular angle into the neck',
    test: 'Pain at the scapular angle on looking away and down',
    cue: 'Shortened in every forward-head/rounded-shoulder client. Release it AFTER the upper trap or it just re-grips.',
  },
  'longus-colli': {
    origin: 'Anterior bodies/transverse processes C1–T3', insertion: 'Anterior bodies C1–C6',
    action: 'Flexes the cervical spine — the deep stabiliser that holds the head back over the ribs',
    test: 'Chin-tuck / cranio-cervical flexion test: chin pokes instead of nodding',
    cue: 'Almost always INHIBITED, not tight — retrain it rather than release it.',
  },
  semispinalis: {
    origin: 'Transverse processes C4–T12', insertion: 'Occiput (capitis) and spinous processes above',
    action: 'Extends the head and spine; contralateral rotation',
    refers: 'Capitis refers a "band around the head", occiput to forehead',
    cue: 'The 4th-layer target under trapezius and splenius in Erik’s spinal-groove work.',
  },
  multifidus: {
    origin: 'Sacrum, ilium and transverse processes',
    insertion: 'Spinous process 2–4 segments above',
    action: 'Segmental extension and rotation; the spine’s local stabiliser',
    test: 'Segmental tenderness plus poor multi-segment control on a prone instability test',
    cue: 'Erik’s "dig the spasm out of the spinal groove" work. Atrophies fast after ONE episode of back pain and does not return on its own.',
  },

  // ── shoulder girdle ─────────────────────────────────────────────────────
  trapezius: {
    origin: 'Occiput, ligamentum nuchae, spinous processes C7–T12',
    insertion: 'Lateral clavicle, acromion, spine of the scapula',
    action: 'Upper elevates, middle retracts, lower depresses & upwardly rotates the scapula',
    refers: 'Upper fibres refer up the side of the neck to the temple',
    test: 'Janda’s upper-crossed: tight upper trap, weak lower trap',
    cue: 'Do not chase the upper trap alone — the real fix is waking the lower trap.',
  },
  rhomboid: {
    origin: 'Spinous processes C7–T5', insertion: 'Medial border of the scapula',
    action: 'Retracts, elevates and downwardly rotates the scapula',
    refers: 'Aching along the medial scapular border',
    test: 'Scapular winging / medial-border lift-off with a short pectoralis minor',
    cue: 'Medial-border pain is usually STRETCH-weak rhomboids under a tight pec minor — treat the front to fix the back.',
  },
  supraspinatus: {
    origin: 'Supraspinous fossa', insertion: 'Greater tubercle (superior facet)',
    action: 'Initiates abduction and centres the humeral head in the socket',
    refers: 'Deltoid region and down the lateral arm',
    test: 'Empty-can / painful arc at 60–120°',
    cue: 'Most-torn cuff tendon. It gets squeezed when the scapula fails to upwardly rotate — fix the rhythm, not just the tendon.',
  },
  infraspinatus: {
    origin: 'Infraspinous fossa', insertion: 'Greater tubercle (middle facet)',
    action: 'External rotation of the humerus',
    refers: 'Deep front-of-shoulder pain — the "can’t lie on that side" muscle',
    test: 'Weak/painful resisted external rotation with the elbow at the side',
    cue: 'Referral goes to the ANTERIOR shoulder, so clients point at the front while the problem is behind.',
  },
  subscapularis: {
    origin: 'Subscapular fossa (anterior scapula)', insertion: 'Lesser tubercle',
    action: 'Internal rotation; the main anterior cuff stabiliser',
    refers: 'Posterior shoulder and a wristband-like band at the wrist',
    test: 'Lift-off / belly-press weakness; loss of external rotation',
    cue: 'THE frozen-shoulder muscle. Sidelying, scapula floated off the ribs — Erik’s go-to for restoring ER.',
  },
  teres: {
    origin: 'Lateral border of the scapula', insertion: 'Greater tubercle (minor) / medial lip of the bicipital groove (major)',
    action: 'Minor externally rotates; major internally rotates, adducts and extends',
    refers: 'Minor mimics deep posterior deltoid pain',
    cue: 'Teres major is "lat’s little helper" — treat them as one unit when the arm won’t reach overhead.',
  },
  'pectoralis-minor': {
    origin: 'Ribs 3–5', insertion: 'Coracoid process of the scapula',
    action: 'Protracts, depresses and anteriorly tilts the scapula',
    refers: 'Anterior chest into the ulnar side of the arm and fingers',
    test: 'Supine: the acromion sits > 1 inch off the table',
    cue: 'Compresses the brachial plexus and axillary vessels beneath it — the pectoralis-minor/TOS link Erik hammers.',
  },
  'pectoralis-major': {
    origin: 'Medial clavicle, sternum, costal cartilages 1–6',
    insertion: 'Lateral lip of the bicipital groove',
    action: 'Adducts, internally rotates and flexes the humerus',
    refers: 'Chest and medial arm — the left-side referral that mimics cardiac pain',
    test: 'Supine arm abducted: the arm cannot rest to the table',
    cue: 'Chest pain with normal cardiac workup? Screen this. Always rule the heart out first.',
  },
  deltoid: {
    origin: 'Lateral clavicle, acromion, spine of the scapula',
    insertion: 'Deltoid tuberosity of the humerus',
    action: 'Anterior flexes/IR, middle abducts, posterior extends/ER',
    refers: 'Local, over the muscle itself — deltoid pain is usually REFERRED from the cuff',
    cue: 'Deltoid rarely is the problem. If the client points to the deltoid, examine supraspinatus.',
  },
  'serratus-anterior': {
    origin: 'Lateral surfaces of ribs 1–9', insertion: 'Medial border of the scapula (anterior)',
    action: 'Protracts and upwardly rotates the scapula; holds it on the rib cage',
    refers: 'Side of the chest, "can’t catch my breath" and medial scapula',
    test: 'Wall push-up produces medial-border winging',
    cue: 'Weak serratus = no upward rotation = impingement upstream. The unglamorous fix for a "shoulder" problem.',
  },
  'serratus-posterior': {
    origin: 'Spinous processes C7–T3 (superior) / T11–L2 (inferior)',
    insertion: 'Ribs 2–5 (superior) / ribs 9–12 (inferior)',
    action: 'Assist inspiration (superior) and expiration (inferior)',
    refers: 'Deep, hard-to-localise ache under the scapula',
    cue: 'Buried under rhomboids and lats — the reason "under the shoulder blade" pain resists surface work.',
  },
  subclavius: {
    origin: 'First rib and its cartilage', insertion: 'Inferior surface of the clavicle',
    action: 'Depresses and stabilises the clavicle',
    cue: 'Sits right on top of the costoclavicular space — a small but real TOS compressor.',
  },
  'latissimus-dorsi': {
    origin: 'Thoracolumbar fascia, spinous processes T7–S5, iliac crest, ribs 9–12',
    insertion: 'Floor of the bicipital groove of the humerus',
    action: 'Extends, adducts and internally rotates the humerus; ties arm to pelvis',
    refers: 'Inferior scapular angle, into the back of the arm and ulnar fingers',
    test: 'Overhead reach in supine: the lumbar spine arches to get the arm down',
    cue: 'The arm-to-opposite-hip sling. A short lat is a hidden cause of both shoulder AND low-back complaints.',
  },
  coracobrachialis: {
    origin: 'Coracoid process', insertion: 'Medial mid-humerus',
    action: 'Flexes and adducts the humerus',
    cue: 'The musculocutaneous nerve pierces it — a rarely-checked source of anterior arm numbness.',
  },

  // ── arm / elbow / forearm ───────────────────────────────────────────────
  'biceps-brachii': {
    origin: 'Supraglenoid tubercle (long head) & coracoid process (short head)',
    insertion: 'Radial tuberosity and the bicipital aponeurosis',
    action: 'Flexes the elbow and — its strongest job — SUPINATES the forearm',
    refers: 'Anterior shoulder and the front of the arm; long-head tendon at the bicipital groove',
    test: 'Speed’s / Yergason’s for the long-head tendon at the groove',
    cue: 'Anterior shoulder pain on lifting is the long head in its groove far more often than the joint itself. NOT to be confused with biceps femoris, which is a hamstring.',
  },
  'triceps-brachii': {
    origin: 'Infraglenoid tubercle (long head), posterior humerus (medial & lateral heads)',
    insertion: 'Olecranon process of the ulna',
    action: 'Extends the elbow; the long head also extends and adducts the shoulder',
    refers: 'Posterior arm to the 4th/5th fingers; long head refers into the posterior shoulder',
    cue: 'The long head crosses the shoulder — check it in any "can’t reach overhead" case.',
  },
  brachialis: {
    origin: 'Distal anterior humerus', insertion: 'Coronoid process / ulnar tuberosity',
    action: 'The pure elbow flexor — works regardless of forearm rotation',
    refers: 'Base of the thumb — a much-missed cause of "thumb pain"',
    cue: 'The radial nerve runs between brachialis and brachioradialis; thumb-web numbness starts here.',
  },
  brachioradialis: {
    origin: 'Lateral supracondylar ridge of the humerus', insertion: 'Styloid process of the radius',
    action: 'Flexes the elbow in mid-pronation ("the beer-glass muscle")',
    refers: 'Lateral epicondyle and the web of the thumb — a tennis-elbow mimic',
    cue: 'Screen it before treating a "lateral epicondylitis" that will not resolve.',
  },
  supinator: {
    origin: 'Lateral epicondyle, radial collateral & annular ligaments, supinator crest',
    insertion: 'Proximal lateral radius',
    action: 'Supinates the forearm with the elbow extended',
    refers: 'Lateral epicondyle and the web space of the thumb',
    test: 'Resisted supination with the elbow straight reproduces lateral elbow pain',
    cue: 'The posterior interosseous nerve runs THROUGH it (arcade of Frohse) — radial tunnel syndrome. This is the tennis elbow that never gets better with wrist-extensor work.',
  },
  'wrist-extensors': {
    origin: 'Lateral epicondyle (common extensor tendon) & supracondylar ridge',
    insertion: 'Bases of the 2nd/3rd metacarpals (ECRL/ECRB), 5th metacarpal (ECU), extensor hoods',
    action: 'Extend the wrist and fingers; stabilise the wrist for gripping',
    refers: 'Lateral epicondyle down the dorsal forearm to the back of the hand',
    test: 'Resisted wrist extension / Cozen’s reproduces lateral elbow pain',
    cue: 'Every grip contraction loads them. Treat the belly mid-forearm, not the screaming tendon at the epicondyle.',
  },
  'pronator-teres': {
    origin: 'Medial epicondyle (humeral head) & coronoid process (ulnar head)',
    insertion: 'Mid-lateral radius',
    action: 'Pronates the forearm and assists elbow flexion',
    refers: 'Deep anterior forearm into the palm and thumb side',
    test: 'Resisted pronation with the elbow extended reproduces symptoms',
    cue: 'The median nerve passes BETWEEN its two heads — pronator teres syndrome mimics carpal tunnel but spares the palm-sensation branch.',
  },
  'pronator-quadratus': {
    origin: 'Distal anterior ulna', insertion: 'Distal anterior radius',
    action: 'The prime pronator; holds the radius and ulna together distally',
    cue: 'Deep at the wrist — reach through the flexor mass with the forearm supinated.',
  },
  'palmaris-longus': {
    origin: 'Medial epicondyle', insertion: 'Palmar aponeurosis',
    action: 'Tenses the palmar fascia and weakly flexes the wrist',
    cue: 'Absent in ~15% of people, and sits directly over the carpal tunnel roof.',
  },
  'flexor-carpi-radialis': {
    origin: 'Medial epicondyle (common flexor tendon)', insertion: 'Base of the 2nd/3rd metacarpal',
    action: 'Flexes and radially deviates the wrist',
    refers: 'Radial wrist crease',
    cue: 'Common flexor origin = golfer’s elbow. Work the belly, decompress the epicondyle.',
  },
  'flexor-carpi-ulnaris': {
    origin: 'Medial epicondyle & olecranon/posterior ulna', insertion: 'Pisiform, hamate, 5th metacarpal',
    action: 'Flexes and ulnarly deviates the wrist',
    refers: 'Ulnar wrist and 4th/5th fingers',
    cue: 'The ulnar nerve passes between its two heads at the cubital tunnel — the "funny bone" entrapment.',
  },
  'flexor-digitorum-superficialis': {
    origin: 'Medial epicondyle, coronoid process, anterior radius',
    insertion: 'Middle phalanges of digits 2–5',
    action: 'Flexes the PIP joints and the wrist',
    cue: 'Its tendons are the crowd inside the carpal tunnel — swelling here compresses the median nerve.',
  },
  'flexor-digitorum-profundus': {
    origin: 'Proximal anterior/medial ulna & interosseous membrane',
    insertion: 'Distal phalanges of digits 2–5',
    action: 'Flexes the DIP joints — the only muscle that can',
    cue: 'Deepest layer; reach it with the wrist passively flexed to slacken the superficial group.',
  },
  'median-nerve': {
    origin: 'C6–T1 via the lateral and medial cords of the brachial plexus',
    insertion: 'Thenar muscles, lateral 2 lumbricals; sensation to the lateral 3½ digits',
    action: 'Motor + sensory to the thumb side of the hand',
    refers: 'Numbness/tingling in the thumb, index, middle and half the ring finger — NOT the little finger',
    test: 'Phalen’s / Tinel’s at the wrist; check thenar bulk',
    cue: 'Erik’s double-crush point: clear the scalenes, pec minor and pronator teres before blaming the wrist.',
  },

  // ── trunk ───────────────────────────────────────────────────────────────
  'erector-spinae': {
    origin: 'Common tendon from the sacrum, iliac crest and lumbar spinous processes',
    insertion: 'Ribs, transverse and spinous processes, mastoid (iliocostalis / longissimus / spinalis)',
    action: 'Extends the spine; unilaterally side-bends it; eccentrically controls forward bending',
    refers: 'Iliocostalis lumborum refers into the buttock — a sciatica mimic',
    test: 'Flexion-relaxation is absent: the erectors stay switched on at end-range forward bend',
    cue: 'Erik works the spinal groove medial to the mass, not the bulk itself.',
  },
  'thoracolumbar-fascia': {
    origin: 'Sacrum, iliac crest, lumbar spinous processes',
    insertion: 'Continuous with lat, glute max, and the abdominal wall',
    action: 'The load-transfer sheet between the arm sling, the trunk and the opposite leg',
    cue: 'Where lat and CONTRALATERAL glute max hand force across in gait — Erik’s posterior-oblique sling. Densifies in chronic low back pain.',
  },
  'quadratus-lumborum': {
    origin: 'Iliac crest & iliolumbar ligament', insertion: '12th rib and L1–L4 transverse processes',
    action: 'Hikes the hip, side-bends the lumbar spine, fixes the 12th rib for breathing',
    refers: 'Deep ache into the SI joint, iliac crest and greater trochanter',
    test: 'Standing hip-hike asymmetry; pain on side-bending away',
    cue: 'The most-missed low-back muscle. Sidelying, over a bolster — reach anterior to the erectors.',
  },
  diaphragm: {
    origin: 'Xiphoid, costal cartilages 7–12, L1–L3 via the crura',
    insertion: 'Central tendon',
    action: 'Primary muscle of inspiration; a core-pressure regulator',
    refers: 'Referred to the tip of the shoulder via the phrenic nerve (C3–C5)',
    test: 'Chest-dominant breathing pattern; ribs flare instead of expand',
    cue: 'Its crura blend with the psoas — you cannot fully free the psoas without freeing the diaphragm. Erik’s Bone & Belly premise.',
  },
  intercostals: {
    origin: 'Lower border of each rib', insertion: 'Upper border of the rib below',
    action: 'Elevate (external) and depress (internal) the ribs; stabilise the chest wall',
    refers: 'Sharp, breath-catching pain along the rib line',
    cue: 'Rib springing beats deep pressure — mobilise the joint, then release the space.',
  },
  'rectus-abdominis': {
    origin: 'Pubic crest and symphysis', insertion: 'Xiphoid and costal cartilages 5–7',
    action: 'Flexes the trunk; posteriorly tilts the pelvis',
    refers: 'Can refer horizontally across the back at the same segmental level',
    cue: 'A short rectus pulls the ribs down and blocks the diaphragm — a "core" that ruins breathing.',
  },
  'external-oblique': {
    origin: 'External surfaces of ribs 5–12',
    insertion: 'Iliac crest, pubic tubercle, linea alba',
    action: 'Contralateral rotation, side-bending, posterior pelvic tilt',
    cue: 'Fibres run hands-into-front-pockets. Pairs with the OPPOSITE internal oblique in the anterior-oblique sling.',
  },
  'internal-oblique': {
    origin: 'Thoracolumbar fascia, iliac crest, inguinal ligament',
    insertion: 'Ribs 10–12, linea alba, pubic crest',
    action: 'Ipsilateral rotation and side-bending',
    cue: 'Fibres run the opposite way to the external — the two form the trunk’s X-brace.',
  },
  'transversus-abdominis': {
    origin: 'Thoracolumbar fascia, iliac crest, inguinal ligament, costal cartilages 7–12',
    insertion: 'Linea alba and the pubic crest',
    action: 'Compresses the abdomen; raises intra-abdominal pressure before limb movement',
    test: 'Delayed activation on a rapid arm raise — the classic low-back-pain finding',
    cue: 'Should fire BEFORE the limb moves. In back pain it fires late, and no amount of release fixes timing — it has to be retrained.',
  },
  'pelvic-floor': {
    origin: 'Pubis, ischial spine, tendinous arch',
    insertion: 'Coccyx, anococcygeal body, perineal body',
    action: 'Supports the pelvic organs, continence, and the bottom of the core canister',
    cue: 'Bottom of the pressure canister with the diaphragm on top. Erik teaches it externally through the ischial/coccyx attachments — never intra-pelvic without the right licence.',
  },
  'sacrotuberous-ligament': {
    origin: 'Sacrum (lateral border) and PSIS',
    insertion: 'Ischial tuberosity',
    action: 'Resists sacral nutation — the key SI-joint stabiliser',
    cue: 'Biceps femoris blends into it in ~30% of people, which is why a hamstring can tug the sacrum. Tenderness here is a core SI finding.',
  },

  // ── hip / pelvis ────────────────────────────────────────────────────────
  psoas: {
    origin: 'Bodies and transverse processes of T12–L5',
    insertion: 'Lesser trochanter of the femur (with iliacus)',
    action: 'Flexes the hip; with the leg fixed, flexes and side-bends the lumbar spine',
    refers: 'Vertical band of low-back pain plus anterior thigh',
    test: 'Thomas test — the thigh will not drop to the table',
    cue: 'Access it lateral to the rectus abdominis, medial to the ASIS, WITH the exhale. Stay off the pulse.',
  },
  iliacus: {
    origin: 'Iliac fossa', insertion: 'Lesser trochanter (shared psoas tendon)',
    action: 'Flexes and externally rotates the hip; anteriorly tilts the pelvis',
    refers: 'Groin and anterior thigh; low back on the same side',
    cue: 'Reachable just inside the iliac crest — safer and often more productive than chasing psoas through the abdomen.',
  },
  piriformis: {
    origin: 'Anterior sacrum', insertion: 'Greater trochanter (superior border)',
    action: 'Externally rotates the extended hip; abducts it when flexed past 60°',
    refers: 'Buttock into the posterior thigh — the sciatica impostor',
    test: 'FAIR test / resisted external rotation reproduces deep glute pain',
    cue: 'The sciatic nerve passes under (or through) it. Rule out a true lumbar radiculopathy FIRST.',
  },
  'gluteus-maximus': {
    origin: 'Posterior ilium, sacrum, coccyx, sacrotuberous ligament',
    insertion: 'IT band and the gluteal tuberosity of the femur',
    action: 'Extends and externally rotates the hip; the body’s main hip extensor',
    test: 'Prone hip-extension firing order: hamstring and erectors fire before glute max',
    cue: 'Inhibited in almost every desk-bound client (lower-crossed). Hamstrings then do its job and stay "tight" forever.',
  },
  'gluteus-medius': {
    origin: 'Outer ilium between the posterior and anterior gluteal lines',
    insertion: 'Lateral greater trochanter',
    action: 'Abducts the hip; the posterior fibres stop the pelvis dropping in single-leg stance',
    refers: 'Along the iliac crest into the SI and buttock',
    test: 'Trendelenburg — the opposite hip drops in single-leg stance',
    cue: 'Weakness here shows up as knee valgus and lateral hip pain — treat the hip, cure the "knee".',
  },
  'gluteus-minimus': {
    origin: 'Outer ilium between the anterior and inferior gluteal lines',
    insertion: 'Anterior greater trochanter',
    action: 'Abducts and internally rotates the hip; stabilises the pelvis in stance',
    refers: 'Down the lateral OR posterior leg to the ankle — the most convincing pseudo-sciatica of all',
    cue: 'Full-length leg referral with a NEGATIVE straight-leg raise points here.',
  },
  'tensor-fasciae-latae': {
    origin: 'ASIS and the anterior iliac crest', insertion: 'IT band → Gerdy’s tubercle on the tibia',
    action: 'Flexes, abducts and internally rotates the hip; tensions the IT band',
    refers: 'Lateral hip and thigh to the knee',
    test: 'Ober’s test — the leg will not adduct below horizontal',
    cue: 'Overworks whenever glute med is weak. Treat TFL AND wake glute med, or it returns within days.',
  },
  'iliotibial-tract': {
    origin: 'Iliac crest via TFL and glute max',
    insertion: 'Gerdy’s tubercle on the lateral tibia',
    action: 'Transmits hip tension to the knee; a lateral stabiliser',
    refers: 'Lateral knee pain on repetitive flexion (runners/cyclists)',
    cue: 'Fascia, not muscle — you cannot "lengthen" it by rolling. Change the tension by treating TFL and glute max.',
  },
  obturator: {
    origin: 'Obturator membrane (internal/external surfaces)',
    insertion: 'Greater trochanter / trochanteric fossa',
    action: 'External rotation of the hip; part of the deep-six group',
    refers: 'Deep groin and buttock; internus can refer to the coccyx',
    cue: 'Deep-six work is about SUSTAINED, slow pressure with the hip passively rotated — never force.',
  },
  'quadratus-femoris': {
    origin: 'Lateral border of the ischial tuberosity', insertion: 'Intertrochanteric crest',
    action: 'External rotation and adduction of the hip',
    cue: 'Sits in the ischiofemoral space — a real source of deep, sit-bone-adjacent buttock pain.',
  },
  gemellus: {
    origin: 'Ischial spine (superior) and ischial tuberosity (inferior)',
    insertion: 'Greater trochanter with obturator internus',
    action: 'External rotation of the hip (deep-six group)',
    cue: 'Treat them as one unit with obturator internus — the "triceps coxae".',
  },
  adductor: {
    origin: 'Pubic body, inferior ramus and ischial ramus',
    insertion: 'Linea aspera and adductor tubercle of the femur',
    action: 'Adducts the hip; magnus’s posterior fibres also extend it (a fourth hamstring)',
    refers: 'Groin into the medial thigh and knee',
    test: 'Resisted adduction with a squeeze; check for a positive FADIR pattern',
    cue: 'Adductor magnus is functionally a hamstring — screen it in a "hamstring strain" that never resolves.',
  },
  pectineus: {
    origin: 'Pectineal line of the pubis', insertion: 'Pectineal line of the femur',
    action: 'Adducts and flexes the hip',
    refers: 'Deep groin just below the crease',
    cue: 'The most anterior adductor — the femoral vessels sit right beside it, so palpate carefully.',
  },
  gracilis: {
    origin: 'Inferior pubic ramus', insertion: 'Pes anserinus on the medial tibia',
    action: 'Adducts the hip and flexes the knee',
    cue: 'The only adductor that crosses the knee — a genuine medial-knee pain source via the pes anserinus.',
  },
  sartorius: {
    origin: 'ASIS', insertion: 'Pes anserinus on the medial tibia',
    action: 'Flexes, abducts and externally rotates the hip; flexes the knee ("tailor’s position")',
    cue: 'Its pes attachment with gracilis and semitendinosus is a classic medial-knee tender point.',
  },

  // ── knee / thigh ────────────────────────────────────────────────────────
  hamstring: {
    origin: 'Ischial tuberosity (biceps femoris short head: linea aspera)',
    insertion: 'Fibular head (biceps femoris); medial tibia (semitendinosus/semimembranosus)',
    action: 'Extends the hip and flexes the knee',
    refers: 'Sit bone into the posterior thigh — often felt as "sciatica"',
    test: 'Straight-leg raise limited by a posterior-thigh stretch, NOT by nerve symptoms',
    cue: 'Chronically "tight" hamstrings are usually PROTECTING an anteriorly tilted pelvis with inhibited glutes. Stretching them harder makes it worse.',
  },
  semitendinosus: {
    origin: 'Ischial tuberosity', insertion: 'Pes anserinus, medial tibia',
    action: 'Extends the hip, flexes and internally rotates the knee',
    cue: 'The medial hamstring — controls tibial rotation, so it matters in knee-tracking problems.',
  },
  semimembranosus: {
    origin: 'Ischial tuberosity', insertion: 'Posterior medial tibial condyle',
    action: 'Extends the hip, flexes and internally rotates the knee',
    cue: 'Deep to semitendinosus; a common posteromedial knee pain source.',
  },
  'rectus-femoris': {
    origin: 'AIIS and the superior acetabular rim', insertion: 'Patella → tibial tuberosity',
    action: 'Extends the knee AND flexes the hip — the only two-joint quad',
    refers: 'Anterior thigh into the knee, often felt deep in the joint at night',
    test: 'Ely’s / Thomas test with the knee bent — the hip lifts',
    cue: 'Because it crosses the hip, it drags the pelvis into anterior tilt. Check it in every lordosis.',
  },
  vastus: {
    origin: 'Linea aspera & greater trochanter (lateralis), medial linea aspera (medialis), anterior femur (intermedius)',
    insertion: 'Patella → tibial tuberosity via the patellar tendon',
    action: 'Extend the knee; VMO controls medial patellar tracking',
    refers: 'Lateralis refers along the lateral thigh and can lock the patella laterally',
    test: 'Patellar tracking on a squat; VMO timing versus vastus lateralis',
    cue: 'Anterior knee pain is usually a tracking problem: tight/overactive lateralis versus late VMO. Release lateral, retrain medial.',
  },
  popliteus: {
    origin: 'Lateral femoral condyle', insertion: 'Posterior proximal tibia',
    action: 'Unlocks the knee from full extension by internally rotating the tibia',
    refers: 'Back of the knee, worse going downhill',
    cue: 'The "key that unlocks the knee". Tiny, deep and almost never treated.',
  },
  plantaris: {
    origin: 'Lateral supracondylar line of the femur', insertion: 'Calcaneus, medial to the Achilles',
    action: 'Weakly assists plantarflexion and knee flexion',
    cue: 'A "tennis leg" pop mid-calf is often this, not a gastroc tear.',
  },

  // ── lower leg / foot ────────────────────────────────────────────────────
  gastrocnemius: {
    origin: 'Posterior femoral condyles (medial & lateral heads)',
    insertion: 'Calcaneus via the Achilles tendon',
    action: 'Plantarflexes the ankle and flexes the knee',
    refers: 'Arch of the foot and the back of the knee; night cramps',
    test: 'Dorsiflexion is limited with the knee STRAIGHT but frees with it bent',
    cue: 'Crosses two joints — knee-straight testing is what separates it from soleus.',
  },
  soleus: {
    origin: 'Posterior tibia and fibula (soleal line)', insertion: 'Calcaneus via the Achilles',
    action: 'Plantarflexes the ankle; the postural "second heart" that pumps venous return',
    refers: 'The heel and into the SI joint — a genuinely surprising referral',
    test: 'Dorsiflexion still limited with the knee BENT = soleus',
    cue: 'Restricted soleus forces early heel-off and drives plantar fasciitis. Treat the calf to fix the foot.',
  },
  'tibialis-anterior': {
    origin: 'Lateral tibial condyle and proximal lateral tibia',
    insertion: 'Medial cuneiform and 1st metatarsal base',
    action: 'Dorsiflexes and inverts the foot; controls foot-lowering after heel strike',
    refers: 'Anterior shin into the big toe — "shin splints"',
    cue: 'It works ECCENTRICALLY on every step. Overuse comes from too much heel strike, not weakness.',
  },
  'tibialis-posterior': {
    origin: 'Posterior tibia, fibula and interosseous membrane',
    insertion: 'Navicular, cuneiforms, metatarsals 2–4',
    action: 'Plantarflexes and inverts; the primary dynamic support of the medial arch',
    refers: 'Deep in the calf and along the medial arch',
    test: 'Single-leg heel raise: the arch collapses or the heel does not invert',
    cue: 'Dysfunction here IS adult acquired flat foot. Screen it in every overpronator.',
  },
  fibularis: {
    origin: 'Lateral fibula (longus proximal, brevis distal)',
    insertion: 'Medial cuneiform/1st metatarsal (longus), 5th metatarsal base (brevis)',
    action: 'Evert the foot and plantarflex; longus supports the transverse arch',
    refers: 'Lateral ankle and just below the lateral malleolus',
    cue: 'Weak/inhibited after any ankle sprain — the reason ankles keep re-spraining.',
  },
  'plantar-fascia': {
    origin: 'Medial calcaneal tubercle', insertion: 'Bases of the proximal phalanges (5 slips)',
    action: 'Maintains the arch; tensions on toe extension (the windlass mechanism)',
    refers: 'Heel pain, worst on the first steps in the morning',
    test: 'Windlass test — pain reproduced on great-toe extension in weight-bearing',
    cue: 'It is continuous with the Achilles through the calcaneus. Treat the calf and the hamstring line, not just the sole.',
  },
  'abductor-hallucis': {
    origin: 'Medial calcaneal tuberosity', insertion: 'Medial base of the great toe proximal phalanx',
    action: 'Abducts and flexes the great toe; an active arch support',
    cue: 'Overlies the tarsal tunnel — a compression site for the posterior tibial nerve.',
  },
};

export const MUSCLE_FACT_COUNT = Object.keys(MUSCLE_FACTS).length;
