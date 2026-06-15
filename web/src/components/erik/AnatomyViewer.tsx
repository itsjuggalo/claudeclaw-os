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
// BrainGraph3D, minus the bloom (a clean anatomical mannequin, not a glowing
// brain). The geometry is procedural so it needs NO external asset — fully
// offline, instant, tiny, and immune to the box's RAM/disk limits.
//
// Upgrade path: if a real segmented atlas is ever dropped at
// web/public/anatomy.glb (each bone/muscle a separately-named mesh), this
// component HEAD-checks for it on mount and, when present, loads it and maps
// mesh names → regions via meshRegion(); otherwise it builds the mannequin.
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ERIK_REGIONS, REGION_BY_KEY } from './regions';

const ACCENT = '#10b981';
const ANATOMY_GLB_URL = '/anatomy.glb';

// ── Region → mesh helpers ──────────────────────────────────────────
// Map a loaded GLB mesh name (if we ever ship a real atlas) to one of our
// 15 region keys. Tolerant substring match against the region key + label
// words + the region's muscle slugs.
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

// ── Procedural mannequin ───────────────────────────────────────────
const BODY_TONE = new THREE.Color('#bd6a60');     // muscle tone
const EMISSIVE_HI = new THREE.Color(ACCENT);

function bodyMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: BODY_TONE.clone(),
    roughness: 0.74,
    metalness: 0.0,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 0,
  });
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

  // ── Arms (both sides) ──
  for (const s of [-1, 1]) {
    add(ball(s * 0.33, 0.74, 0, 0.13, 'shoulder'));                                            // deltoid
    add(segment(new THREE.Vector3(s * 0.36, 0.68, 0), new THREE.Vector3(s * 0.43, 0.28, 0), 0.075, 'arm'));      // upper arm
    add(segment(new THREE.Vector3(s * 0.43, 0.28, 0), new THREE.Vector3(s * 0.46, -0.08, 0.02), 0.062, 'elbow')); // forearm
    add(ball(s * 0.47, -0.17, 0.03, 0.07, 'wrist/hand'));                                       // hand
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
    cleanup: () => void;
  } | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

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
    camera.position.set(0.2, 0.25, 3.5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-3, 0, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbfe9d8, 0.3);
    rim.position.set(0, 2, -4);
    scene.add(rim);

    const figure = new THREE.Group();
    scene.add(figure);

    const meshesByRegion = new Map<string, THREE.Mesh[]>();
    const indexMeshes = (meshes: THREE.Mesh[]) => {
      for (const m of meshes) {
        const r = m.userData.region as string | undefined;
        if (!r) continue;
        (meshesByRegion.get(r) ?? meshesByRegion.set(r, []).get(r)!).push(m);
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

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastInteract = Date.now();
    controls.addEventListener('start', () => { lastInteract = Date.now(); });
    controls.addEventListener('change', () => { lastInteract = Date.now(); });

    // Highlight: emerald emissive on hovered/selected region meshes.
    const applyHighlight = () => {
      const sel = selectedRef.current;
      const hov = hoveredRef.current;
      meshesByRegion.forEach((meshes, region) => {
        const isSel = region === sel;
        const isHov = region === hov;
        const intensity = isSel ? 0.9 : isHov ? 0.5 : 0;
        for (const m of meshes) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.copy(EMISSIVE_HI);
          mat.emissiveIntensity = intensity;
          // selected also tints the base color toward emerald so it's
          // identifiable even on the far side while rotating.
          mat.color.copy(BODY_TONE).lerp(EMISSIVE_HI, isSel ? 0.4 : 0);
        }
      });
    };

    const pickRegion = (ev: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(figure.children, true);
      for (const hit of hits) {
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
      if (r) onSelectRef.current(r);
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
      applyHighlight();
    };

    // Prefer a real segmented atlas if one was dropped in; else mannequin.
    // HEAD-check first so a missing asset doesn't spam a 404 in the console.
    const buildProcedural = () => finish(buildMannequin(figure));
    fetch(ANATOMY_GLB_URL, { method: 'HEAD' })
      .then((res) => {
        if (disposed) return;
        if (!res.ok) { buildProcedural(); return; }
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder as unknown as Parameters<typeof loader.setMeshoptDecoder>[0]);
        loader.load(
          ANATOMY_GLB_URL,
          (gltf) => {
            if (disposed) return;
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const scale = 2.6 / Math.max(size.x, size.y, size.z, 0.0001);
            gltf.scene.scale.setScalar(scale);
            gltf.scene.position.copy(center).multiplyScalar(-scale);
            const tagged: THREE.Mesh[] = [];
            gltf.scene.traverse((o) => {
              if (!(o instanceof THREE.Mesh)) return;
              const r = meshRegion(o.name);
              if (r) { o.userData.region = r; o.material = bodyMat(); tagged.push(o); }
            });
            if (tagged.length === 0) { buildProcedural(); return; } // unnamed → mannequin
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

  const label = (hovered && REGION_BY_KEY[hovered]?.label)
    || (selected && REGION_BY_KEY[selected]?.label)
    || null;

  if (failed) return null; // ExploreTab's 2D body map remains the fallback

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
