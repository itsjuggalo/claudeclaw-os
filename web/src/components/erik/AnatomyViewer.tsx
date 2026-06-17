// AnatomyViewer — interactive 3D body for the Erik Dalton learning explorer.
//
// A rotatable human figure segmented into the SAME 15 regions that Erik's
// technique frames are tagged with (regions.ts). Hover a body part → it lights
// up + names itself; click it → drives the shared `selected` region state, so
// the detail panel below shows that region's muscle plates, technique frames,
// and KB lessons. Same `{ selected, onSelect }` contract as the 2D <BodyMap>,
// so the two stay in lockstep.
//
// Engine = the proven Three.js + OrbitControls + raycaster stack from
// BrainGraph3D, minus the bloom.
//
// TWO render paths:
//   1. REAL ATLAS — if a segmented anatomy.glb is present at web/public/, load
//      it, classify each mesh as bone / muscle by name, give it a tissue
//      material (ivory bone, deep-red muscle), and expose Bone/Muscle LAYER
//      toggles so you can peel muscle off to see the skeleton. Mesh names also
//      map → our 15 regions for click-to-learn + highlight.
//   2. PROCEDURAL MANNEQUIN — fallback when no atlas: a clean clickable body
//      built from primitives. Offline, instant, tiny — never a broken viewer.
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';
// GLTFLoader + meshopt decoder (~666KB) are imported DYNAMICALLY below, only
// when a real anatomy.glb is actually present — so the default procedural-
// mannequin path stays lean for every Explore visitor.

const ACCENT = '#10b981';
const ANATOMY_GLB_URL = '/anatomy.glb';
// On-screen credit for the loaded atlas (CC/public-domain attribution). Filled
// from anatomy.glb.LICENSE.txt at build time; shown only if non-empty.
const ANATOMY_CREDIT = '3D atlas: BodyParts3D / Z-Anatomy · CC BY-SA';

// ── Region → mesh helpers ──────────────────────────────────────────
// Map a loaded GLB mesh name to one of our 15 region keys. Tolerant substring
// match against the region key + label words + the region's muscle slugs. We
// pass the mesh's full ancestor name-path so group-level naming still resolves.
function meshRegion(rawName: string): string | null {
  const n = rawName.toLowerCase().replace(/[_\-.]/g, ' ');
  for (const r of ERIK_REGIONS) {
    const needles = [
      r.key.replace(/[\/]/g, ' '),
      ...r.label.toLowerCase().split(/[\s/]+/),
      ...r.muscles.map((m) => m.replace(/-/g, ' ')),
    ].filter((s) => s && s.length > 2);
    if (needles.some((s) => n.includes(s))) return r.key;
  }
  return null;
}

// Classify a mesh (by its full ancestor name-path) as bone, muscle, or other.
// Tuned for BodyParts3D / Z-Anatomy / NIH-3D naming (latin anatomical names +
// "skeletal system" / "muscular system" group nodes).
function classifyTissue(path: string): 'bone' | 'muscle' | 'other' {
  const n = path.toLowerCase();
  if (/(bone|skelet|osseous|\boss\b|vertebra|spine|spinal column|rib\b|costa|sternum|clavicle|scapula|humerus|radius|ulna|carpal|metacarp|phalan|femur|tibia|fibula|patella|pelvis|pelvic|ilium|ischium|pubis|sacrum|coccyx|skull|crani|mandible|maxilla|hyoid|tarsal|calcaneus|talus)/.test(n)) return 'bone';
  if (/(muscle|muscul|tendon|deltoid|pectoral|trapez|latissimus|rhomboid|erector|oblique|rectus|glute|biceps|triceps|brachi|quadricep|hamstring|gastrocn|soleus|sartorius|gracilis|adductor|psoas|iliacus|teres|infraspinatus|supraspinatus|subscapular|sternocleidomastoid|scalene|splenius|masseter|temporalis|piriformis|tensor|flexor|extensor|pronator|supinator|levator|serratus|quadratus|semitendinosus|semimembranosus|vastus|gemellus|obturator|diaphragm)/.test(n)) return 'muscle';
  return 'other';
}

// Full lowercased name-path: the mesh's own name plus a few ancestors, so a
// mesh named "L_femur" inside a "Skeletal system" node still classifies right.
function namePath(o: THREE.Object3D): string {
  const parts: string[] = [];
  let cur: THREE.Object3D | null = o;
  let depth = 0;
  while (cur && depth < 6) { if (cur.name) parts.push(cur.name); cur = cur.parent; depth++; }
  return parts.join(' ');
}

// ── Tissue + mannequin materials ───────────────────────────────────
const BODY_TONE = new THREE.Color('#bd6a60');   // procedural skin/muscle tone
const BONE_TONE = new THREE.Color('#e9e2cf');   // ivory bone
const MUSCLE_TONE = new THREE.Color('#b23b3b'); // deep red muscle
const EMISSIVE_HI = new THREE.Color(ACCENT);

function tissueColor(t: 'bone' | 'muscle' | 'other'): THREE.Color {
  return t === 'bone' ? BONE_TONE.clone() : t === 'muscle' ? MUSCLE_TONE.clone() : BODY_TONE.clone();
}

function tissueMat(t: 'bone' | 'muscle' | 'other'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: tissueColor(t),
    roughness: t === 'bone' ? 0.55 : 0.8,
    metalness: 0,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 0,
    // DoubleSide so the mirrored (negative-scaled) left half isn't back-face
    // culled, and open shells shade their interior.
    side: THREE.DoubleSide,
  });
}

function bodyMat(): THREE.MeshStandardMaterial {
  return tissueMat('other');
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
    meshesByRegion: Map<string, THREE.Mesh[]>;
    applyHighlight: () => void;
    setLayerVisible: (bones: boolean, muscles: boolean) => void;
    resetView: () => void;
    cleanup: () => void;
  } | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  // Layer toggles (real atlas only). hasBone/hasMuscle gate which pills show.
  const [hasBone, setHasBone] = useState(false);
  const [hasMuscle, setHasMuscle] = useState(false);
  const [showBones, setShowBones] = useState(true);
  const [showMuscles, setShowMuscles] = useState(true);

  // Refs so the once-only init effect's event handlers read latest values.
  const selectedRef = useRef<string | null>(selected);
  const hoveredRef = useRef<string | null>(null);
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
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe9d8, 0.3);
    rim.position.set(0, 2, -4);
    scene.add(rim);

    const figure = new THREE.Group();
    scene.add(figure);

    const meshesByRegion = new Map<string, THREE.Mesh[]>();
    const meshesByTissue = new Map<'bone' | 'muscle' | 'other', THREE.Mesh[]>();
    const pushTo = <K,>(map: Map<K, THREE.Mesh[]>, k: K, m: THREE.Mesh) => {
      (map.get(k) ?? map.set(k, []).get(k)!).push(m);
    };
    const indexMeshes = (meshes: THREE.Mesh[]) => {
      for (const m of meshes) {
        // Remember each mesh's own base color so highlight lerps from IT (not a
        // single shared tone) — keeps bone ivory + muscle red distinct.
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!m.userData.baseColor && mat?.color) m.userData.baseColor = mat.color.clone();
        const r = m.userData.region as string | undefined;
        if (r) pushTo(meshesByRegion, r, m);
        const t = (m.userData.tissue as 'bone' | 'muscle' | 'other') || 'other';
        pushTo(meshesByTissue, t, m);
      }
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.minDistance = 2.2;
    controls.maxDistance = 6;
    controls.enablePan = false;
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

    // Highlight: emerald emissive on hovered/selected region meshes, lerped
    // from each mesh's own base tissue color.
    const applyHighlight = () => {
      const sel = selectedRef.current;
      const hov = hoveredRef.current;
      meshesByRegion.forEach((meshes, region) => {
        const isSel = region === sel;
        const isHov = region === hov;
        const intensity = isSel ? 0.9 : isHov ? 0.5 : 0;
        for (const m of meshes) {
          const mat = m.material as THREE.MeshStandardMaterial;
          const base = (m.userData.baseColor as THREE.Color) || BODY_TONE;
          mat.emissive.copy(EMISSIVE_HI);
          mat.emissiveIntensity = intensity;
          // selected also tints the base toward emerald so it's identifiable
          // even on the far side while rotating.
          mat.color.copy(base).lerp(EMISSIVE_HI, isSel ? 0.4 : 0);
        }
      });
    };

    const setLayerVisible = (bones: boolean, muscles: boolean) => {
      (meshesByTissue.get('bone') || []).forEach((m) => { m.visible = bones; });
      (meshesByTissue.get('muscle') || []).forEach((m) => { m.visible = muscles; });
    };

    const pickRegion = (ev: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(figure.children, true);
      for (const hit of hits) {
        if (hit.object.visible === false) continue;
        const r = hit.object.userData.region as string | undefined;
        if (r) return r;
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      const r = pickRegion(ev);
      hoveredRef.current = r;
      setHovered(r);
      setMouse(r ? { x: ev.clientX, y: ev.clientY } : null);
      renderer.domElement.style.cursor = r ? 'pointer' : 'grab';
      applyHighlight();
    };
    const onLeave = () => { hoveredRef.current = null; setHovered(null); setMouse(null); applyHighlight(); };
    const onClick = (ev: PointerEvent) => {
      const r = pickRegion(ev);
      if (r) { onSelectRef.current(r); return; }
      // Click on empty space clears the current selection (toggles it off).
      if (selectedRef.current) onSelectRef.current(selectedRef.current);
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointerdown', onClick);

    let raf = 0;
    let disposed = false;
    let idleWeight = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const idleTarget = Date.now() - lastInteract > 1400 ? 1 : 0;
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
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const finish = (meshes: THREE.Mesh[]) => {
      if (disposed) return;
      indexMeshes(meshes);
      const nBone = (meshesByTissue.get('bone') || []).length;
      const nMuscle = (meshesByTissue.get('muscle') || []).length;
      if (nBone > 0) setHasBone(true);
      if (nMuscle > 0) setHasMuscle(true);
      applyHighlight();
    };

    // Prefer a real segmented atlas if one was dropped in; else mannequin.
    // HEAD-check first so a missing asset doesn't spam a 404 in the console.
    const buildProcedural = () => finish(buildMannequin(figure));
    fetch(ANATOMY_GLB_URL, { method: 'HEAD' })
      .then(async (res) => {
        if (disposed) return;
        if (!res.ok) { buildProcedural(); return; }
        // Real atlas present → pull in the loader on demand.
        const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        ]);
        if (disposed) return;
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder as unknown as Parameters<typeof loader.setMeshoptDecoder>[0]);
        loader.load(
          ANATOMY_GLB_URL,
          (gltf) => {
            if (disposed) return;
            const tagged: THREE.Mesh[] = [];
            const lateral: THREE.Mesh[] = [];
            gltf.scene.traverse((o) => {
              if (!(o instanceof THREE.Mesh)) return;
              const path = namePath(o);
              const tissue = classifyTissue(path);
              o.userData.tissue = tissue;
              o.material = tissueMat(tissue);  // clean teaching tissue color
              const r = meshRegion(path);
              if (r) o.userData.region = r;
              tagged.push(o);
              // Lateralized (right-side ".r" / "right") parts → mirror to the left.
              if (/(^|[\s._-])r($|[\s._-])|right/i.test(o.name)) lateral.push(o);
            });
            if (tagged.length === 0) { buildProcedural(); return; } // empty → mannequin
            // Open anatomy atlases (BodyParts3D / Z-Anatomy / Open3DModel) often
            // ship only the RIGHT half + midline structures, mirrored at view
            // time. Reflect the lateralized meshes across the model midline (x=0)
            // BEFORE centering so the learner sees a whole body.
            if (lateral.length) {
              const mirror = new THREE.Group();
              mirror.scale.x = -1;
              for (const o of lateral) {
                o.updateWorldMatrix(true, false);
                const mm = new THREE.Mesh(o.geometry, tissueMat(o.userData.tissue as 'bone' | 'muscle' | 'other'));
                mm.applyMatrix4(o.matrixWorld);
                mm.userData.region = o.userData.region;
                mm.userData.tissue = o.userData.tissue;
                mirror.add(mm);
                tagged.push(mm);
              }
              gltf.scene.add(mirror);
            }
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
          undefined,
          () => buildProcedural(),
        );
      })
      .catch(() => buildProcedural());

    requestAnimationFrame(() => requestAnimationFrame(resize));

    stateRef.current = {
      meshesByRegion,
      applyHighlight,
      setLayerVisible,
      resetView,
      cleanup: () => {
        disposed = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
        renderer.domElement.removeEventListener('pointerdown', onClick);
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

  // Apply layer visibility when the toggles change.
  useEffect(() => {
    stateRef.current?.setLayerVisible(showBones, showMuscles);
  }, [showBones, showMuscles, hasBone, hasMuscle]);

  const label = (hovered && REGION_BY_KEY[hovered]?.label)
    || (selected && REGION_BY_KEY[selected]?.label)
    || null;

  if (failed) return null; // ExploreTab's 2D body map remains the fallback

  const layerBtn = (on: boolean, set: (v: boolean) => void, icon: string, text: string, tone: string) => (
    <button type="button" onClick={() => set(!on)}
      style={{ padding: '4px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
        border: '1px solid ' + (on ? tone : 'var(--color-border)'),
        background: on ? tone + '22' : 'var(--color-bg)',
        color: on ? tone : 'var(--color-text-faint)' }}>
      {icon} {text} {on ? '' : '·off'}
    </button>
  );

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={wrapRef}
        style={{
          width: '100%', height: '420px', borderRadius: '12px',
          border: '1px solid var(--color-border)',
          background: 'radial-gradient(ellipse at 50% 35%, rgba(16,185,129,0.06), var(--color-card) 70%)',
          touchAction: 'none', cursor: 'grab',
        }}
      />
      {/* hint */}
      <div style={{ position: 'absolute', top: '10px', left: '12px', fontSize: '11px', color: 'var(--color-text-faint)', pointerEvents: 'none' }}>
        Drag to rotate · scroll to zoom · click a region to learn it
      </div>
      {/* layer toggles (real atlas only) */}
      {(hasBone || hasMuscle) && (
        <div style={{ position: 'absolute', top: '34px', left: '12px', display: 'flex', gap: '6px' }}>
          {hasMuscle && layerBtn(showMuscles, setShowMuscles, '💪', 'Muscle', '#b23b3b')}
          {hasBone && layerBtn(showBones, setShowBones, '🦴', 'Bone', '#c9b98a')}
        </div>
      )}
      {/* reset view */}
      <button type="button" onClick={() => stateRef.current?.resetView()}
        title="Reset camera"
        style={{ position: 'absolute', bottom: '10px', right: '12px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '7px', padding: '4px 10px', cursor: 'pointer' }}>
        ⟲ Reset view
      </button>
      {/* attribution credit (only when a real atlas is loaded) */}
      {(hasBone || hasMuscle) && ANATOMY_CREDIT && (
        <div style={{ position: 'absolute', bottom: '10px', left: '12px', fontSize: '9px', color: 'var(--color-text-faint)', pointerEvents: 'none', maxWidth: '60%' }}>
          {ANATOMY_CREDIT}
        </div>
      )}
      {/* current region badge (top-right) */}
      {(selected && REGION_BY_KEY[selected]) && (
        <div style={{ position: 'absolute', top: '10px', right: '12px', fontSize: '12px', fontWeight: 700, color: ACCENT, background: 'var(--color-bg)', border: '1px solid ' + ACCENT, borderRadius: '999px', padding: '3px 12px', pointerEvents: 'none' }}>
          {REGION_BY_KEY[selected].label}
        </div>
      )}
      {/* floating hover label that follows the cursor */}
      {label && mouse && (
        <div style={{ position: 'fixed', left: mouse.x + 14, top: mouse.y + 14, zIndex: 50, fontSize: '12px', fontWeight: 700, color: '#fff', background: 'rgba(16,120,90,0.92)', padding: '3px 9px', borderRadius: '6px', pointerEvents: 'none', textTransform: 'capitalize' }}>
          {label}
        </div>
      )}
    </div>
  );
}
