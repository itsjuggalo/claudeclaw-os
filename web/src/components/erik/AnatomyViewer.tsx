// AnatomyViewer — interactive 3D body for the Erik Dalton learning explorer.
//
// Same viewer Mike ships at the bottom of the massagebymike resources page
// (/AIWorkWSL/web/massage/js/anatomy-viewer.js), ported to Preact and wired to
// the Erik region contract. It loads the fully-segmented BodyParts3D /
// Z-Anatomy atlas (anatomy-seg.glb — ~2254 separately named meshes, full
// bilateral body incl. legs), and gives you:
//   • LAYER PEEL — fascia → superficial → deep → vessels → nerves → skeleton,
//     each its own pill, so you can strip the muscle off to see the bone.
//   • TAP ANY STRUCTURE — name + plain-English function + Mike's hands-on note
//     (from /anatomy-info.json), plus a jump straight into the Dalton video
//     library for that structure.
//   • hover tooltip (desktop), drag to rotate, pinch/scroll to zoom.
//
// It ALSO keeps the `{ selected, onSelect }` contract of the 2D <BodyMap>: a
// tapped structure that maps to one of Erik's 15 regions drives the shared
// selection, so the detail panel below follows along, and an externally
// selected region lights up on the model.
//
// THREE render paths, in order:
//   1. /anatomy-seg.glb  — the full segmented atlas (preferred).
//   2. /anatomy.glb      — the older upper-body-only segmented atlas.
//   3. PROCEDURAL MANNEQUIN — primitives, offline, instant; never a broken viewer.
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';
// GLTFLoader + meshopt decoder (~666KB) are imported DYNAMICALLY below, only
// when a real atlas is actually present — so the procedural-mannequin path
// stays lean for every Explore visitor.

const ACCENT = '#10b981';
// Preferred first. HEAD-checked in order; first hit wins.
const ATLAS_URLS = ['/anatomy-seg.glb', '/anatomy.glb'];
const INFO_URL = '/anatomy-info.json';
// On-screen credit for the loaded atlas (CC/public-domain attribution).
const ANATOMY_CREDIT = '3D atlas: BodyParts3D / Z-Anatomy / AnatomyTOOL · CC BY-SA';

type Tissue = 'bone' | 'muscle' | 'nerve' | 'artery' | 'vein' | 'other';
type Layer = 'fascia' | 'superficial' | 'deep' | 'vessels' | 'nerves' | 'skeleton';

interface StructInfo { name: string; fn: string; note: string; tissue: Tissue; region: string | null }

// The video library searches the words Erik SAYS, so hand it the bare anatomical
// term — one phrase, no qualifiers. Info names carry alternates ("Brachialis /
// upper arm", "Skull & jaw") and parenthetical aliases ("(SCM)"); a literal
// search for the whole label matches nothing, so keep only the first clause.
function videoQuery(name: string): string {
  const first = name.split(/[—/&,]/)[0];
  return first.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || name;
}

// ── Region → mesh helpers ──────────────────────────────────────────
// Map a loaded GLB mesh name to one of our 15 region keys. Tolerant substring
// match against the region key + label words + the region's muscle slugs. We
// pass the mesh's full ancestor name-path so group-level naming still resolves.
// Anatomical homonyms that show up inside unrelated structure names — "clavicular
// HEAD of pectoralis major", "SPINE of the scapula", "NECK of the femur". Matching
// a region on one of these mislabels half the atlas (pec major → Head / Face), so
// they never count as a region needle on their own.
const AMBIGUOUS_NEEDLE = new Set(['head', 'face', 'spine', 'neck', 'body', 'general', 'low', 'back', 'core']);

function meshRegion(rawName: string): string | null {
  const n = rawName.toLowerCase().replace(/[_\-.]/g, ' ');
  // Specific first: a named muscle beats any label word, whichever region it's in.
  for (const r of ERIK_REGIONS) {
    if (r.muscles.some((m) => n.includes(m.replace(/-/g, ' ')))) return r.key;
  }
  for (const r of ERIK_REGIONS) {
    const needles = [
      r.key.replace(/[/]/g, ' '),
      ...r.label.toLowerCase().split(/[\s/]+/),
    ].filter((s) => s && s.length > 2 && !AMBIGUOUS_NEEDLE.has(s));
    if (needles.some((s) => n.includes(s))) return r.key;
  }
  return null;
}

// Classify a mesh (by its full ancestor name-path). Vessels/nerves are checked
// BEFORE muscle/bone because their group names sit alongside them in the atlas.
function classifyTissue(path: string): Tissue {
  const n = path.toLowerCase();
  if (/(\bnerve\b|nerves|nervous|plexus|ganglion|sciatic|nervi)/.test(n)) return 'nerve';
  if (/(\bartery\b|arteries|arterial|aorta|aortic|truncus arteriosus)/.test(n)) return 'artery';
  if (/(\bvein\b|veins|venous|vena cava|\bvena\b|venae|jugular vein)/.test(n)) return 'vein';
  if (/(bone|skelet|osseous|\boss\b|vertebra|spine|spinal column|rib\b|costa|sternum|clavicle|scapula|humerus|radius|ulna|carpal|metacarp|phalan|femur|tibia|fibula|patella|pelvis|pelvic|ilium|ischium|pubis|sacrum|coccyx|skull|crani|mandible|maxilla|hyoid|tarsal|calcaneus|talus)/.test(n)) return 'bone';
  if (/(muscle|muscul|tendon|deltoid|pectoral|trapez|latissimus|rhomboid|erector|oblique|rectus|glute|biceps|triceps|brachi|quadricep|hamstring|gastrocn|soleus|sartorius|gracilis|adductor|psoas|iliacus|teres|infraspinatus|supraspinatus|subscapular|sternocleidomastoid|scalene|splenius|masseter|temporalis|piriformis|tensor|flexor|extensor|pronator|supinator|levator|serratus|quadratus|semitendinosus|semimembranosus|vastus|gemellus|obturator|diaphragm)/.test(n)) return 'muscle';
  return 'other';
}

// Depth layer for the "peel" control (outer → inner). Vessels + nerves get
// their own toggles since they weave through every depth.
const SUPERFICIAL = /(trapezius|latissimus|deltoid|pectoralis major|gluteus maximus|rectus abdom|external (abdominal )?oblique|sternocleidomastoid|biceps brach|triceps|brachioradialis|gastrocnemius|sartorius|rectus femoris)/;
function depthLayer(path: string, tissue: Tissue): Layer {
  const n = path.toLowerCase();
  if (tissue === 'nerve') return 'nerves';
  if (tissue === 'artery' || tissue === 'vein') return 'vessels';
  if (tissue === 'bone' || /cartilage|cartilages/.test(n)) return 'skeleton';
  if (/fascia|aponeurosis|thoracolumbar|retinaculum/.test(n)) return 'fascia';
  if (tissue === 'muscle') return (/overlay/.test(n) || SUPERFICIAL.test(n)) ? 'superficial' : 'deep';
  return 'fascia'; // soft-tissue "other" rides with the outer layer
}

const LAYER_DEFS: { key: Layer; label: string; icon: string; tone: string }[] = [
  { key: 'fascia', label: 'Fascia', icon: '🩹', tone: '#caa15a' },
  { key: 'superficial', label: 'Superficial', icon: '💪', tone: '#c0463f' },
  { key: 'deep', label: 'Deep', icon: '💪', tone: '#8f2f2f' },
  { key: 'vessels', label: 'Vessels', icon: '🩸', tone: '#c0392b' },
  { key: 'nerves', label: 'Nerves', icon: '🟡', tone: '#b89324' },
  { key: 'skeleton', label: 'Skeleton', icon: '🦴', tone: '#c9b98a' },
];

// Full name-path: the mesh's own name plus a few ancestors, so a mesh named
// "L_femur" inside a "Skeletal system" node still classifies right.
function nameParts(o: THREE.Object3D): string[] {
  const parts: string[] = [];
  let cur: THREE.Object3D | null = o;
  let depth = 0;
  while (cur && depth < 6) { if (cur.name) parts.push(cur.name); cur = cur.parent; depth++; }
  return parts;
}
const namePath = (o: THREE.Object3D) => nameParts(o).join(' ');

// A clean, human display label from the messy node name(s).
const GENERIC_NAME = /^(mesh|object|scene|node|group|root|armature|bones?|bones_right|muscles?|fascia|cartilages?(_right)?)\b/i;
function cleanLabel(s: string): string {
  let t = s.replace(/\.[rl]\b/gi, '').replace(/\([^)]*\)/g, '').replace(/\boverlay\b/gi, '');
  // Atlas nodes are machine-named ("Thorax_-_veins") — make them readable.
  t = t.replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' — ');
  t = t.replace(/\bmesh[._]?\d+\b/gi, '').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
function prettyName(o: THREE.Object3D): string {
  for (const part of nameParts(o)) {
    if (!part || GENERIC_NAME.test(part) || /^mesh[._]?\d+$/i.test(part)) continue;
    const c = cleanLabel(part);
    if (c) return c;
  }
  return 'Body structure';
}

// ── Anatomy info (name + function + Mike's note) ────────────────────
interface InfoEntry { match?: string[]; name?: string; function?: string; massage?: string }
interface InfoDoc { entries?: InfoEntry[]; fallbackByTissue?: Record<string, InfoEntry> }

// ── Tissue + mannequin materials ───────────────────────────────────
const BODY_TONE = new THREE.Color('#bd6a60');   // procedural skin/muscle tone
const BONE_TONE = new THREE.Color('#f3eee2');   // clean bone white
const MUSCLE_TONE = new THREE.Color('#b73a30'); // rich anatomical muscle red
const NERVE_TONE = new THREE.Color('#f2cf52');
const ARTERY_TONE = new THREE.Color('#d23b2c');
const VEIN_TONE = new THREE.Color('#3f6fb0');
const OTHER_TONE = new THREE.Color('#cf8a7e');
const EMISSIVE_HI = new THREE.Color(ACCENT);
const HOVER_EMISSIVE = new THREE.Color('#ff9a4d');
const PICK_EMISSIVE = new THREE.Color('#ff4d33');

function tissueColor(t: Tissue): THREE.Color {
  return t === 'bone' ? BONE_TONE.clone()
    : t === 'muscle' ? MUSCLE_TONE.clone()
    : t === 'nerve' ? NERVE_TONE.clone()
    : t === 'artery' ? ARTERY_TONE.clone()
    : t === 'vein' ? VEIN_TONE.clone()
    : OTHER_TONE.clone();
}

function tissueMat(t: Tissue): THREE.MeshStandardMaterial {
  const vessel = (t === 'nerve' || t === 'artery' || t === 'vein');
  return new THREE.MeshStandardMaterial({
    color: tissueColor(t),
    roughness: t === 'bone' ? 0.62 : t === 'muscle' ? 0.5 : vessel ? 0.4 : 0.72,
    metalness: 0,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 0,
    // DoubleSide so the mirrored (negative-scaled) half isn't back-face culled,
    // and open shells shade their interior.
    side: THREE.DoubleSide,
  });
}

function bodyMat(): THREE.MeshStandardMaterial {
  const m = tissueMat('other');
  m.color.copy(BODY_TONE);
  return m;
}

// A capsule spanning two joint centers, tagged with a region.
function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, region: string): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.0001);
  const cyl = Math.max(0.001, len - radius * 2);
  const geo = new THREE.CapsuleGeometry(radius, cyl, 6, 14);
  const mesh = new THREE.Mesh(geo, bodyMat());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.userData.region = region;
  return mesh;
}

function ball(x: number, y: number, z: number, r: number, region: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), bodyMat());
  mesh.position.set(x, y, z);
  mesh.userData.region = region;
  return mesh;
}

// A torso shell: a half-cylinder (front = +Z, back = -Z) at a given height
// band, so chest vs spine and abdomen vs low-back are separately clickable.
function shell(opts: {
  yTop: number; yBot: number; rx: number; rz: number; side: 'front' | 'back'; region: string;
}): THREE.Mesh {
  const { yTop, yBot, rx, rz, side, region } = opts;
  const h = yTop - yBot;
  // theta=-90°..+90° sweeps through +Z (front); +90°..+270° through -Z (back).
  const thetaStart = side === 'front' ? -Math.PI / 2 : Math.PI / 2;
  const geo = new THREE.CylinderGeometry(rx, rx, h, 24, 4, true, thetaStart, Math.PI);
  geo.scale(1, 1, rz / rx); // squash to an ellipse cross-section
  const mat = bodyMat();
  mat.side = THREE.DoubleSide; // shells are open — shade the inside too
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, (yTop + yBot) / 2, 0);
  mesh.userData.region = region;
  return mesh;
}

function buildMannequin(group: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh) => { meshes.push(m); group.add(m); };

  // ── Head / neck ──
  add(ball(0, 1.12, 0, 0.21, 'head/face'));
  add(ball(0, 0.97, 0.13, 0.085, 'jaw/TMJ'));            // jaw bump, lower-front of head
  add(segment(new THREE.Vector3(0, 0.96, 0), new THREE.Vector3(0, 0.80, 0), 0.085, 'neck'));

  // ── Torso (front/back split by height band) ──
  add(shell({ yTop: 0.78, yBot: 0.34, rx: 0.30, rz: 0.20, side: 'front', region: 'thoracic/ribs' }));
  add(shell({ yTop: 0.78, yBot: 0.34, rx: 0.30, rz: 0.20, side: 'back',  region: 'spine/general' }));
  add(shell({ yTop: 0.34, yBot: -0.04, rx: 0.28, rz: 0.19, side: 'front', region: 'core/abdomen' }));
  add(shell({ yTop: 0.34, yBot: -0.04, rx: 0.28, rz: 0.19, side: 'back',  region: 'low back' }));
  add(shell({ yTop: -0.04, yBot: -0.42, rx: 0.30, rz: 0.20, side: 'back',  region: 'pelvis/SI' }));
  add(shell({ yTop: -0.04, yBot: -0.42, rx: 0.30, rz: 0.20, side: 'front', region: 'hip/glutes' }));
  // glute mass at the back-bottom + buttock rounds
  add(ball(-0.13, -0.46, -0.12, 0.16, 'hip/glutes'));
  add(ball(0.13, -0.46, -0.12, 0.16, 'hip/glutes'));

  // ── Arms (both sides) — held slightly away from the torso so the
  // shoulder / upper-arm / forearm / hand regions read as distinct masses.
  for (const s of [-1, 1]) {
    add(ball(s * 0.34, 0.74, 0, 0.13, 'shoulder'));                                              // deltoid
    add(segment(new THREE.Vector3(s * 0.40, 0.69, 0), new THREE.Vector3(s * 0.52, 0.28, 0.02), 0.072, 'arm'));    // upper arm
    add(segment(new THREE.Vector3(s * 0.52, 0.28, 0.02), new THREE.Vector3(s * 0.58, -0.08, 0.05), 0.058, 'elbow')); // forearm
    add(ball(s * 0.60, -0.16, 0.07, 0.068, 'wrist/hand'));                                        // hand
  }

  // ── Legs (both sides) ──
  for (const s of [-1, 1]) {
    add(segment(new THREE.Vector3(s * 0.13, -0.5, 0), new THREE.Vector3(s * 0.15, -0.98, 0), 0.11, 'knee'));      // thigh
    add(segment(new THREE.Vector3(s * 0.15, -0.98, 0), new THREE.Vector3(s * 0.15, -1.42, 0), 0.08, 'foot/ankle')); // calf
    add(ball(s * 0.15, -1.48, 0.1, 0.085, 'foot/ankle'));                                       // foot
  }

  return meshes;
}

// ── Component ──────────────────────────────────────────────────────
interface Props {
  selected: string | null;
  onSelect: (key: string) => void;
}

export function AnatomyViewer({ selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    applyHighlight: () => void;
    setLayerVisible: (on: Record<Layer, boolean>) => void;
    resetView: () => void;
    cleanup: () => void;
  } | null>(null);

  const [hoverName, setHoverName] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<StructInfo | null>(null);
  // Which depth layers exist in the loaded atlas (gates which pills show).
  const [layersPresent, setLayersPresent] = useState<Layer[]>([]);
  // Vessels + nerves start OFF: this is a bodywork explorer, and the venous web
  // otherwise sits in front of the muscles Erik actually teaches (and eats the
  // taps meant for them). The pills turn them back on.
  const [layerOn, setLayerOn] = useState<Record<Layer, boolean>>({
    fascia: true, superficial: true, deep: true, vessels: false, nerves: false, skeleton: true,
  });
  const [loading, setLoading] = useState(true);   // true until the figure is built
  const [pct, setPct] = useState<number | null>(null);
  // Narrow canvas → the structure panel sits along the bottom instead of the
  // top-right, where it would bury the layer pills on a phone.
  const [narrow, setNarrow] = useState(false);

  // Refs so the once-only init effect's event handlers read latest values.
  const selectedRef = useRef<string | null>(selected);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const wrap = wrapRef.current;
    const w = wrap.clientWidth || 360;
    const h = wrap.clientHeight || 420;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.outline = 'none';
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    // Distance chosen so the full ~2.85-unit figure fits with margin (feet
    // and head both clear of the frame). Slight 3/4 offset reads as a pose.
    camera.position.set(0.35, 0.15, 4.4);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    // Hemisphere light = soft, rounded tissue-like shading (cool sky / warm
    // ground bounce) so the figure reads as a body, not flat clay.
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a221f, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe9d8c4, 0.4);
    rim.position.set(0, 2, -4);
    scene.add(rim);

    const figure = new THREE.Group();
    scene.add(figure);

    // Anatomy info doc, fetched once alongside the model.
    let INFO: InfoDoc | null = null;
    fetch(INFO_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { INFO = d as InfoDoc | null; })
      .catch(() => { INFO = null; });

    const resolveInfo = (o: THREE.Object3D): StructInfo => {
      const path = String(o.userData.lookup || namePath(o)).toLowerCase();
      const tissue = (o.userData.tissue as Tissue) || 'other';
      const pretty = (o.userData.pretty as string) || prettyName(o);
      const region = (o.userData.region as string | undefined) ?? null;
      if (INFO && Array.isArray(INFO.entries)) {
        for (const e of INFO.entries) {
          if (e.match && e.match.some((m) => path.includes(m))) {
            return { name: e.name || pretty, fn: e.function || '', note: e.massage || '', tissue, region };
          }
        }
        const fb = INFO.fallbackByTissue?.[tissue];
        if (fb) return { name: pretty, fn: fb.function || '', note: fb.massage || '', tissue, region };
      }
      return { name: pretty, fn: '', note: '', tissue, region };
    };

    const meshesByRegion = new Map<string, THREE.Mesh[]>();
    const meshesByLayer = new Map<Layer, THREE.Mesh[]>();
    const pushTo = <K,>(map: Map<K, THREE.Mesh[]>, k: K, m: THREE.Mesh) => {
      const arr = map.get(k);
      if (arr) arr.push(m); else map.set(k, [m]);
    };
    const indexMeshes = (meshes: THREE.Mesh[]) => {
      for (const m of meshes) {
        // Remember each mesh's own base color so highlight lerps from IT (not a
        // single shared tone) — keeps bone ivory + muscle red distinct.
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!m.userData.baseColor && mat?.color) m.userData.baseColor = mat.color.clone();
        const r = m.userData.region as string | undefined;
        if (r) pushTo(meshesByRegion, r, m);
        pushTo(meshesByLayer, (m.userData.layer as Layer) || 'superficial', m);
      }
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.minDistance = 2.2;
    controls.maxDistance = 6;
    controls.enablePan = false;
    // One finger rotates (only sideways gestures reach us — see touchAction:'pan-y'
    // on the wrapper), two fingers zoom. Never claim the vertical page scroll.
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // OrbitControls' constructor force-sets touchAction:'none' on the canvas, which
    // beats the wrapper's pan-y — the canvas is the real touch target, so vertical
    // swipes were still being eaten. Put it back AFTER construction.
    renderer.domElement.style.touchAction = 'pan-y';
    controls.target.set(0, -0.1, 0);
    controls.update();
    const homePos = camera.position.clone();
    const homeTarget = controls.target.clone();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastInteract = Date.now();
    controls.addEventListener('start', () => { lastInteract = Date.now(); });
    controls.addEventListener('change', () => { lastInteract = Date.now(); });

    const resetView = () => {
      camera.position.copy(homePos);
      controls.target.copy(homeTarget);
      figure.rotation.set(0, 0, 0);
      controls.update();
      lastInteract = Date.now();
    };

    // Highlight, weakest → strongest: hovered structure (warm), every mesh of
    // the externally-selected region (emerald), the tapped structure (red).
    let hoveredMesh: THREE.Mesh | null = null;
    let pickedMesh: THREE.Mesh | null = null;
    const applyHighlight = () => {
      const sel = selectedRef.current;
      meshesByRegion.forEach((meshes, region) => {
        const isSel = region === sel;
        for (const m of meshes) {
          const mat = m.material as THREE.MeshStandardMaterial;
          const base = (m.userData.baseColor as THREE.Color) || BODY_TONE;
          mat.emissive.copy(EMISSIVE_HI);
          mat.emissiveIntensity = isSel ? 0.55 : 0;
          // selected also tints the base toward emerald so it's identifiable
          // even on the far side while rotating.
          mat.color.copy(base).lerp(EMISSIVE_HI, isSel ? 0.35 : 0);
        }
      });
      for (const [m, color, intensity] of [
        [hoveredMesh, HOVER_EMISSIVE, 0.3] as const,
        [pickedMesh, PICK_EMISSIVE, 0.6] as const,
      ]) {
        if (!m) continue;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(color);
        mat.emissiveIntensity = intensity;
      }
    };

    const setLayerVisible = (on: Record<Layer, boolean>) => {
      meshesByLayer.forEach((meshes, k) => {
        const v = on[k] !== false;
        for (const m of meshes) m.visible = v;
      });
    };

    const visibleChain = (o: THREE.Object3D | null): boolean => {
      let c: THREE.Object3D | null = o;
      while (c) { if (c.visible === false) return false; c = c.parent; }
      return true;
    };
    const pickAt = (clientX: number, clientY: number): THREE.Mesh | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(figure, true);
      for (const hit of hits) {
        const o = hit.object;
        if (o instanceof THREE.Mesh && visibleChain(o)) return o;
      }
      return null;
    };

    // Click-vs-drag: only a near-stationary, quick pointerup counts as a tap,
    // so rotating the model never fires a selection.
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (ev: PointerEvent) => { down = { x: ev.clientX, y: ev.clientY, t: Date.now() }; };
    const onUp = (ev: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const dt = Date.now() - down.t;
      down = null;
      if (moved > 6 || dt > 600) return; // it was a drag/hold, not a tap
      const hit = pickAt(ev.clientX, ev.clientY);
      if (!hit) {
        pickedMesh = null;
        setPicked(null);
        applyHighlight();
        return;
      }
      pickedMesh = hit;
      if (hoveredMesh === hit) hoveredMesh = null;  // pick supersedes hover glow
      const info = resolveInfo(hit);
      setPicked(info);
      // Drive the shared Erik region selection when the structure maps to one.
      // onSelect toggles, so only fire when it's a genuinely different region.
      if (info.region && info.region !== selectedRef.current) onSelectRef.current(info.region);
      applyHighlight();
    };
    const finePointer = window.matchMedia ? window.matchMedia('(pointer:fine)').matches : true;
    let hoverGate = 0;
    const onMove = (ev: PointerEvent) => {
      if (!finePointer) return;
      const now = Date.now();
      if (now - hoverGate < 45) return;
      hoverGate = now;
      const hit = pickAt(ev.clientX, ev.clientY);
      setMouse(hit ? { x: ev.clientX, y: ev.clientY } : null);
      if (hit === hoveredMesh) return;
      hoveredMesh = hit && hit !== pickedMesh ? hit : null;
      setHoverName(hit ? resolveInfo(hit).name : null);
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      applyHighlight();
    };
    const onLeave = () => { hoveredMesh = null; setHoverName(null); setMouse(null); applyHighlight(); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    let disposed = false;
    let idleWeight = 0;
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const idleTarget = (!reduceMotion && Date.now() - lastInteract > 1800) ? 1 : 0;
      idleWeight += (idleTarget - idleWeight) * 0.04;
      figure.rotation.y += 0.0035 * idleWeight;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      const nw = wrap.clientWidth, nh = wrap.clientHeight;
      if (!nw || !nh) return;
      renderer.setSize(nw, nh, false);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      setNarrow(nw < 560);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const finish = (meshes: THREE.Mesh[]) => {
      if (disposed) return;
      indexMeshes(meshes);
      setLayersPresent(LAYER_DEFS.map((d) => d.key).filter((k) => (meshesByLayer.get(k) || []).length > 0));
      applyHighlight();
      setLoading(false);
      setPct(null);
    };

    // ── Atlas load ──
    const buildProcedural = () => finish(buildMannequin(figure));

    const loadAtlas = async (url: string) => {
      // Real atlas present → pull in the loader on demand.
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      if (disposed) return;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder as unknown as Parameters<typeof loader.setMeshoptDecoder>[0]);
      loader.load(
        url,
        (gltf) => {
          if (disposed) return;
          let tagged: THREE.Mesh[] = [];
          gltf.scene.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return;
            const path = namePath(o);
            const tissue = classifyTissue(path);
            o.userData.tissue = tissue;
            o.userData.lookup = path;
            o.userData.pretty = prettyName(o);
            o.userData.layer = depthLayer(path, tissue);
            o.material = tissueMat(tissue);  // clean teaching tissue color
            const r = meshRegion(path);
            if (r) o.userData.region = r;
            tagged.push(o);
          });
          if (tagged.length === 0) { buildProcedural(); return; } // empty → mannequin

          // Half-modeled layer reflection: open atlases often ship one tissue
          // layer as a single side only. A tissue whose lateral meshes sit
          // overwhelmingly on ONE side of the midline gets reflected across it,
          // so the learner always sees a whole body.
          const fullBox = new THREE.Box3().setFromObject(gltf.scene);
          const sz = fullBox.getSize(new THREE.Vector3());
          const midX = (fullBox.min.x + fullBox.max.x) / 2;
          const eps = Math.max(sz.x * 0.02, 1e-4);
          const sideOf = (o: THREE.Object3D) => {
            const bb = new THREE.Box3().setFromObject(o);
            return bb.min.x >= midX - eps ? 1 : bb.max.x <= midX + eps ? -1 : 0;
          };
          const byTissue = new Map<Tissue, THREE.Mesh[]>();
          for (const o of tagged) {
            o.userData.side = sideOf(o);
            const t = (o.userData.tissue as Tissue) || 'other';
            pushTo(byTissue, t, o);
          }
          const mirror = new THREE.Group();
          mirror.matrixAutoUpdate = false;
          mirror.matrix
            .makeTranslation(midX, 0, 0)
            .multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
            .multiply(new THREE.Matrix4().makeTranslation(-midX, 0, 0));
          const hidden = new Set<THREE.Mesh>();
          byTissue.forEach((arr, t) => {
            const R = arr.filter((o) => o.userData.side === 1);
            const L = arr.filter((o) => o.userData.side === -1);
            const maxN = Math.max(R.length, L.length);
            if (maxN === 0) return;
            if (Math.min(R.length, L.length) / maxN >= 0.35) return; // already bilateral
            const dominant = R.length >= L.length ? R : L;
            const sparse = dominant === R ? L : R;
            for (const o of sparse) { hidden.add(o); o.parent?.remove(o); }
            for (const o of dominant) {
              o.updateWorldMatrix(true, false);
              const mm = new THREE.Mesh(o.geometry, tissueMat(t));
              mm.applyMatrix4(o.matrixWorld);
              // Carry the source structure's identity so the mirrored side is
              // clickable, layer-peelable and region-linked too.
              mm.userData.tissue = t;
              mm.userData.lookup = o.userData.lookup;
              mm.userData.pretty = o.userData.pretty;
              mm.userData.layer = o.userData.layer;
              mm.userData.region = o.userData.region;
              mirror.add(mm);
              tagged.push(mm);
            }
          });
          if (hidden.size) tagged = tagged.filter((o) => !hidden.has(o));
          if (mirror.children.length) gltf.scene.add(mirror);

          // Center + scale the full (mirrored) figure to fit the frame.
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const scale = 2.6 / Math.max(size.x, size.y, size.z, 0.0001);
          gltf.scene.scale.setScalar(scale);
          gltf.scene.position.copy(center).multiplyScalar(-scale);
          figure.add(gltf.scene);
          finish(tagged);
        },
        (ev) => {
          if (disposed || !ev.lengthComputable || !ev.total) return;
          setPct(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
        },
        () => buildProcedural(),
      );
    };

    // HEAD-check the atlases in preference order so a missing asset doesn't
    // spam a 404 in the console, and the mannequin is the last resort.
    (async () => {
      for (const url of ATLAS_URLS) {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          if (disposed) return;
          if (res.ok) { await loadAtlas(url); return; }
        } catch { /* try the next one */ }
      }
      if (!disposed) buildProcedural();
    })();

    requestAnimationFrame(() => requestAnimationFrame(resize));

    stateRef.current = {
      applyHighlight,
      setLayerVisible,
      resetView,
      cleanup: () => {
        disposed = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointerup', onUp);
        controls.dispose();
        scene.traverse((o) => {
          const any = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
          if (any.geometry) any.geometry.dispose();
          if (any.material) (Array.isArray(any.material) ? any.material : [any.material]).forEach((mm) => mm.dispose());
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };

    return () => { stateRef.current?.cleanup(); stateRef.current = null; };
  }, []);

  // Re-highlight when the externally-controlled selection changes.
  useEffect(() => {
    selectedRef.current = selected;
    stateRef.current?.applyHighlight();
  }, [selected]);

  // Apply layer visibility when the peel pills change.
  useEffect(() => {
    stateRef.current?.setLayerVisible(layerOn);
  }, [layerOn, layersPresent]);

  if (failed) return null; // ExploreTab's 2D body map remains the fallback

  const hasLayers = layersPresent.length > 0;
  const TISSUE_CHIP: Record<Tissue, { bg: string; fg: string; label: string }> = {
    muscle: { bg: 'rgba(183,58,48,0.16)', fg: '#c0463f', label: 'Muscle' },
    bone: { bg: 'rgba(201,185,138,0.20)', fg: '#a8965f', label: 'Bone' },
    nerve: { bg: 'rgba(236,204,70,0.20)', fg: '#b89324', label: 'Nerve' },
    artery: { bg: 'rgba(210,59,44,0.16)', fg: '#c0392b', label: 'Artery' },
    vein: { bg: 'rgba(63,111,176,0.18)', fg: '#3f6fb0', label: 'Vein' },
    other: { bg: 'rgba(16,185,129,0.14)', fg: ACCENT, label: 'Soft tissue' },
  };
  const chip = picked ? (TISSUE_CHIP[picked.tissue] || TISSUE_CHIP.other) : null;

  // Layer-peel pills. On a phone they sit ABOVE the canvas in normal flow —
  // overlaid they wrapped to two rows and covered the head and shoulders, which
  // is exactly the body you're trying to look at. On desktop there's room to
  // float them over the top-left corner.
  const pills = hasLayers ? (
    <div style={{
      display: 'flex', gap: '6px', flexWrap: 'wrap',
      ...(narrow
        ? { marginBottom: '8px' }
        : { position: 'absolute', top: '10px', left: '12px', maxWidth: 'calc(100% - 24px)' }),
    }}>
      {LAYER_DEFS.filter((d) => layersPresent.includes(d.key)).map((d) => {
        const on = layerOn[d.key];
        return (
          <button key={d.key} type="button"
            aria-pressed={on ? 'true' : 'false'}
            onClick={() => setLayerOn((prev) => ({ ...prev, [d.key]: !prev[d.key] }))}
            style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: 1,
              border: '1px solid ' + (on ? d.tone : 'var(--color-border)'),
              background: on ? d.tone + '22' : 'var(--color-bg)',
              color: on ? d.tone : 'var(--color-text-faint)' }}>
            {d.icon} {d.label}{on ? '' : ' ·off'}
          </button>
        );
      })}
    </div>
  ) : null;

  const hintText = 'Tap any muscle or bone to learn what it does · drag sideways to rotate · peel the layers above';

  return (
    <div>
      {narrow && pills}
      <div style={{ position: 'relative' }}>
      <div
        ref={wrapRef}
        style={{
          width: '100%',
          // Phones get a much taller stage — the figure is head-to-toe, and 420px
          // rendered it postage-stamp small. Desktop keeps the compact 420.
          height: narrow ? 'min(68vh, 620px)' : '420px',
          minHeight: '420px',
          borderRadius: '12px',
          border: '1px solid var(--color-border)',
          background: 'radial-gradient(ellipse at 50% 35%, rgba(16,185,129,0.06), var(--color-card) 70%)',
          // 'none' meant the canvas swallowed EVERY touch — a vertical swipe that
          // started on the tall model rotated it instead of scrolling the page.
          // 'pan-y' hands vertical swipes back to the scroller; sideways drags still
          // reach OrbitControls, and two-finger pinch still dollies.
          touchAction: 'pan-y', cursor: 'grab',
        }}
      />
      {/* hint — overlaid only on desktop (below the floating pills); on a phone it
          lives under the canvas so nothing sits on top of the body */}
      {!narrow && (
        <div style={{ position: 'absolute', top: hasLayers ? '48px' : '10px', left: '12px', maxWidth: '52%', lineHeight: 1.3, fontSize: '12px', color: 'var(--color-text-faint)', pointerEvents: 'none' }}>
          {hintText}
        </div>
      )}
      {/* first-load indicator (the segmented atlas is ~20MB) */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', pointerEvents: 'none' }}>
          <div style={{ width: '26px', height: '26px', border: '3px solid var(--color-border)', borderTopColor: ACCENT, borderRadius: '50%', animation: 'erik-spin 0.8s linear infinite' }} />
          <div style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
            Loading 3D anatomy…{pct != null ? ` ${pct}%` : ''}
          </div>
          <style>{'@keyframes erik-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      )}
      {!narrow && pills}
      {/* reset view */}
      <button type="button" onClick={() => stateRef.current?.resetView()}
        title="Reset camera"
        style={{ position: 'absolute', bottom: '10px', right: '12px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '7px', padding: '4px 10px', cursor: 'pointer' }}>
        ⟲ Reset view
      </button>
      {/* attribution credit — overlaid on desktop, under the canvas on a phone */}
      {hasLayers && !narrow && (
        <div style={{ position: 'absolute', bottom: '10px', left: '12px', fontSize: '11px', color: 'var(--color-text-faint)', pointerEvents: 'none', maxWidth: '46%' }}>
          {ANATOMY_CREDIT}
        </div>
      )}
      {/* current region badge (top-right) — hidden while the structure panel is open */}
      {(!picked && selected && REGION_BY_KEY[selected]) && (
        <div style={{ position: 'absolute', top: '10px', right: '12px', fontSize: '13px', fontWeight: 700, color: ACCENT, background: 'var(--color-bg)', border: '1px solid ' + ACCENT, borderRadius: '999px', padding: '3px 12px', pointerEvents: 'none' }}>
          {REGION_BY_KEY[selected].label}
        </div>
      )}
      {/* structure panel — name + what it does + Mike's note + a jump into the Dalton videos */}
      {picked && chip && (
        <div style={{
          position: 'absolute', zIndex: 8, boxSizing: 'border-box',
          ...(narrow
            ? { left: '12px', right: '12px', bottom: '44px', width: 'auto' }
            : { top: '10px', right: '12px', width: 'min(272px, calc(100% - 24px))' }),
          background: 'var(--color-card)', color: 'var(--color-text)',
          border: '1px solid var(--color-border)', borderRadius: '12px',
          boxShadow: '0 8px 28px rgba(0,0,0,0.28)', padding: '13px 14px',
        }}>
          <button type="button" onClick={() => setPicked(null)} aria-label="Close"
            style={{ position: 'absolute', top: '6px', right: '9px', border: 'none', background: 'transparent', color: 'inherit', fontSize: '18px', lineHeight: 1, cursor: 'pointer', opacity: 0.6, padding: '2px 4px' }}>
            ×
          </button>
          <div style={{ display: 'inline-block', fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '999px', marginBottom: '7px', background: chip.bg, color: chip.fg }}>
            {chip.label}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, lineHeight: 1.2, paddingRight: '18px' }}>{picked.name}</div>
          {picked.fn && <div style={{ fontSize: '13px', lineHeight: 1.45, marginTop: '6px', opacity: 0.92 }}>{picked.fn}</div>}
          {picked.note && (
            <div style={{ fontSize: '12.5px', lineHeight: 1.45, marginTop: '9px', paddingTop: '9px', borderTop: '1px dashed var(--color-border)', fontStyle: 'italic', opacity: 0.95 }}>
              {picked.note}
            </div>
          )}
          <a href={`/dalton/?q=${encodeURIComponent(videoQuery(picked.name))}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', marginTop: '11px', fontSize: '12.5px', fontWeight: 800, color: '#fff', background: ACCENT, textDecoration: 'none', padding: '6px 12px', borderRadius: '999px' }}>
            ▶ Dalton videos ↗
          </a>
          {picked.region && REGION_BY_KEY[picked.region] && (
            <div style={{ fontSize: '11px', marginTop: '8px', color: 'var(--color-text-faint)' }}>
              Region: {REGION_BY_KEY[picked.region].label}
            </div>
          )}
        </div>
      )}
      {/* floating hover label that follows the cursor */}
      {hoverName && mouse && (
        <div style={{ position: 'fixed', left: mouse.x + 14, top: mouse.y + 14, zIndex: 50, fontSize: '13px', fontWeight: 700, color: '#fff', background: 'rgba(16,120,90,0.92)', padding: '3px 9px', borderRadius: '6px', pointerEvents: 'none', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hoverName}
        </div>
      )}
      </div>
      {/* phone: hint + credit live under the canvas, never over the body */}
      {narrow && (
        <div style={{ marginTop: '7px', fontSize: '12px', lineHeight: 1.35, color: 'var(--color-text-faint)' }}>
          {hintText}
          {hasLayers && <div style={{ fontSize: '10.5px', marginTop: '3px', opacity: 0.8 }}>{ANATOMY_CREDIT}</div>}
        </div>
      )}
    </div>
  );
}
