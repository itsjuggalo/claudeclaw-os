import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Search, RotateCw, Sparkles, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-preact';
import { formatRelativeTime } from '@/lib/format';

interface HiveEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts: string | null;
  created_at: number;
}

interface Props {
  entries: HiveEntry[];
  agentFilter: string;
  agentColors: Record<string, string>;
  blurOn: boolean;
}

// ── Lobes & agent mapping ──────────────────────────────────────────
// Same shape as the 2D version so the user gets consistent semantics:
// each agent has a "home" lobe, dots cluster in that lobe's region,
// the side panel filters apply identically.

interface Lobe {
  id: string;
  label: string;
  color: THREE.Color;
}

const FRONTAL = new THREE.Color('#5eb6ff');
const PARIETAL = new THREE.Color('#10b981');
const TEMPORAL = new THREE.Color('#f59e0b');
const OCCIPITAL = new THREE.Color('#a78bfa');

const LOBES: Lobe[] = [
  { id: 'frontal',   label: 'Frontal',   color: FRONTAL },
  { id: 'parietal',  label: 'Parietal',  color: PARIETAL },
  { id: 'temporal',  label: 'Temporal',  color: TEMPORAL },
  { id: 'occipital', label: 'Occipital', color: OCCIPITAL },
];

const LOBE_BY_ID = LOBES.reduce<Record<string, Lobe>>((acc, l) => { acc[l.id] = l; return acc; }, {});

const AGENT_LOBE: Record<string, string> = {
  main: 'frontal',
  research: 'parietal',
  comms: 'temporal',
  content: 'occipital',
  ops: 'parietal',
  meta: 'frontal',
};

function lobeFor(agentId: string): string {
  return AGENT_LOBE[agentId] || 'frontal';
}

// ── Hash-based 3D noise ────────────────────────────────────────────
// Cheap, deterministic value noise with smoothstep interpolation.
// Good enough to give the brain mesh a lumpy organic surface.

function hash(x: number, y: number, z: number): number {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function smooth(t: number) { return t * t * (3 - 2 * t); }

function noise3D(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  // Trilinear interpolation of corner hashes
  const c000 = hash(xi,     yi,     zi    );
  const c100 = hash(xi + 1, yi,     zi    );
  const c010 = hash(xi,     yi + 1, zi    );
  const c110 = hash(xi + 1, yi + 1, zi    );
  const c001 = hash(xi,     yi,     zi + 1);
  const c101 = hash(xi + 1, yi,     zi + 1);
  const c011 = hash(xi,     yi + 1, zi + 1);
  const c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 * (1 - u) + c100 * u;
  const x10 = c010 * (1 - u) + c110 * u;
  const x01 = c001 * (1 - u) + c101 * u;
  const x11 = c011 * (1 - u) + c111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
}

function fbm(x: number, y: number, z: number): number {
  return noise3D(x, y, z) * 0.55 + noise3D(x * 2.3, y * 2.3, z * 2.3) * 0.28 + noise3D(x * 5.1, y * 5.1, z * 5.1) * 0.17;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Brain hemisphere builder ────────────────────────────────────────
// Returns a deformed ellipsoid mesh with vertex colors painted by
// soft lobe membership. The same lobe-weight function is later
// re-used to assign dots to surface positions.

function lobeWeights(x: number, y: number, z: number) {
  // Coordinate frame: +x = right, +y = up, +z = back
  // (dots use +z = front in their own coords; we flip below for clarity)
  const front = -z; // larger = more frontal
  // Frontal: dominant where front is large (positive)
  const wFrontal = smoothstep(0.0, 0.8, front);
  // Occipital: dominant where front is very negative (back)
  const wOccipital = smoothstep(-0.1, -0.7, front);
  // Parietal: top middle (high y, mid front)
  const wParietal = smoothstep(0.0, 0.55, y) * smoothstep(-0.5, 0.4, front) * (1 - wFrontal);
  // Temporal: lower band (low y), away from poles
  const wTemporal = smoothstep(0.1, -0.4, y) * smoothstep(-0.7, 0.7, front);
  return { wFrontal, wParietal, wTemporal, wOccipital };
}

function buildHemisphere(side: 'left' | 'right'): { mesh: THREE.Mesh; surface: THREE.Vector3[] } {
  const detail = 5; // 4 = 642 verts, 5 = 2562 verts — smoother surface
  const geo = new THREE.IcosahedronGeometry(1, detail);
  // Stretch into brain proportions: a bit narrower than a sphere on x,
  // shorter on y, longer front-to-back on z.
  geo.scale(0.55, 0.78, 1.0);

  const positions = geo.attributes.position;
  const count = positions.count;
  const colors = new Float32Array(count * 3);
  const surface: THREE.Vector3[] = [];

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    // Multi-octave noise displacement along the radial direction.
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = x / len, ny = y / len, nz = z / len;
    const n = fbm(nx * 2.4, ny * 2.4, nz * 2.4);
    const factor = 1 + n * 0.085;

    const px = x * factor;
    const py = y * factor;
    const pz = z * factor;

    positions.setXYZ(i, px, py, pz);

    // Lobe colors: blended by weight
    const w = lobeWeights(nx, ny, nz);
    const sum = w.wFrontal + w.wParietal + w.wTemporal + w.wOccipital + 0.0001;
    const wf = w.wFrontal / sum;
    const wp = w.wParietal / sum;
    const wt = w.wTemporal / sum;
    const wo = w.wOccipital / sum;

    const r = wf * FRONTAL.r + wp * PARIETAL.r + wt * TEMPORAL.r + wo * OCCIPITAL.r;
    const g = wf * FRONTAL.g + wp * PARIETAL.g + wt * TEMPORAL.g + wo * OCCIPITAL.g;
    const b = wf * FRONTAL.b + wp * PARIETAL.b + wt * TEMPORAL.b + wo * OCCIPITAL.b;

    // Tone the colors a bit so they read as a brain rather than a
    // candy-colored ball. Mix with a desaturated base.
    const baseR = 0.34, baseG = 0.32, baseB = 0.42;
    const mix = 0.55;
    colors[i * 3]     = r * mix + baseR * (1 - mix);
    colors[i * 3 + 1] = g * mix + baseG * (1 - mix);
    colors[i * 3 + 2] = b * mix + baseB * (1 - mix);

    // Save outward-facing surface vertices for dot placement (skip
    // the inner-facing wall where it touches the midline).
    if (side === 'left' && x < -0.05) surface.push(new THREE.Vector3(px, py, pz));
    if (side === 'right' && x > 0.05) surface.push(new THREE.Vector3(px, py, pz));
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 22,
    transparent: true,
    opacity: 0.95,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.x = side === 'left' ? -0.018 : 0.018; // tiny gap = longitudinal fissure
  return { mesh, surface };
}

// Pick a deterministic dot position for an entry inside its lobe's
// surface points. Stable across renders so the visualization doesn't
// shuffle on every poll.
function pickSurface(surface: THREE.Vector3[], lobeId: string, slotIdx: number): THREE.Vector3 | null {
  // Filter surface points to the lobe's region
  const region = surface.filter((v) => {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const nx = v.x / len, ny = v.y / len, nz = v.z / len;
    const w = lobeWeights(nx, ny, nz);
    if (lobeId === 'frontal') return w.wFrontal > 0.45;
    if (lobeId === 'parietal') return w.wParietal > 0.35;
    if (lobeId === 'temporal') return w.wTemporal > 0.4;
    if (lobeId === 'occipital') return w.wOccipital > 0.45;
    return false;
  });
  if (region.length === 0) return null;
  return region[slotIdx % region.length];
}

// ── Component ───────────────────────────────────────────────────────

interface BrainFilters {
  query: string;
  hiddenAgents: Set<string>;
  hiddenLobes: Set<string>;
  nodeSize: number;
}

const DEFAULT_FILTERS: BrainFilters = {
  query: '',
  hiddenAgents: new Set(),
  hiddenLobes: new Set(),
  nodeSize: 1,
};

interface DotData {
  entry: HiveEntry & { lobe: string };
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
}

export function BrainGraph3D({ entries, agentFilter, agentColors, blurOn }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    leftSurface: THREE.Vector3[];
    rightSurface: THREE.Vector3[];
    dotsGroup: THREE.Group;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    dotMap: Map<THREE.Object3D, DotData>;
    rafId: number;
    lastInteract: number;
    brainGroup: THREE.Group;
    cleanup: () => void;
  } | null>(null);

  const [hovered, setHovered] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<HiveEntry | null>(null);
  const [filters, setFilters] = useState<BrainFilters>(DEFAULT_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Init scene once
  useEffect(() => {
    if (!wrapRef.current) return;
    const wrap = wrapRef.current;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0.1, 3.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.outline = 'none';

    // Lighting — soft, with a key light from upper-front.
    scene.add(new THREE.AmbientLight(0x7080a0, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6090ff, 0.35);
    fill.position.set(-3, -1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa080ff, 0.4);
    rim.position.set(0, 1, -3);
    scene.add(rim);

    // Brain
    const brainGroup = new THREE.Group();
    const left = buildHemisphere('left');
    const right = buildHemisphere('right');
    brainGroup.add(left.mesh);
    brainGroup.add(right.mesh);
    scene.add(brainGroup);

    // Subtle ambient halo behind the brain
    const haloGeo = new THREE.PlaneGeometry(5, 5);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x6080ff) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        void main() {
          float d = length(vUv - vec2(0.5));
          float a = smoothstep(0.5, 0.0, d) * 0.18;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.z = -1.2;
    scene.add(halo);

    // Dots group
    const dotsGroup = new THREE.Group();
    scene.add(dotsGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;
    controls.minDistance = 2.2;
    controls.maxDistance = 5.5;
    controls.enablePan = false;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dotMap = new Map<THREE.Object3D, DotData>();
    let lastInteract = Date.now();
    controls.addEventListener('start', () => { lastInteract = Date.now(); });
    controls.addEventListener('change', () => { lastInteract = Date.now(); });

    let rafId = 0;
    const start = performance.now();
    function animate() {
      rafId = requestAnimationFrame(animate);
      const t = (performance.now() - start) / 1000;

      // Idle drift: slow auto-rotation when not interacting.
      const idle = Date.now() - lastInteract > 2200;
      if (idle) brainGroup.rotation.y += 0.0014;

      // Subtle breathing pulse — the whole brain scales gently.
      const breathe = 1 + Math.sin(t * 0.7) * 0.012;
      brainGroup.scale.setScalar(breathe);

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      const nw = wrap.clientWidth;
      const nh = wrap.clientHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(wrap);

    sceneStateRef.current = {
      scene, camera, renderer, controls,
      leftSurface: left.surface, rightSurface: right.surface,
      dotsGroup, raycaster, pointer, dotMap,
      rafId, lastInteract, brainGroup,
      cleanup: () => {
        cancelAnimationFrame(rafId);
        ro.disconnect();
        controls.dispose();
        // Dispose meshes & materials
        scene.traverse((obj) => {
          if ((obj as any).geometry) (obj as any).geometry.dispose();
          if ((obj as any).material) {
            const m = (obj as any).material;
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
            else m.dispose();
          }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
    setReady(true);

    return () => { sceneStateRef.current?.cleanup(); sceneStateRef.current = null; };
  }, []);

  // Sync dots whenever entries / agentColors / filters / agentFilter change.
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state || !ready) return;

    // Clear old dots
    while (state.dotsGroup.children.length > 0) {
      const child = state.dotsGroup.children[0];
      state.dotsGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    }
    state.dotMap.clear();

    // Track slot index per (lobe, side) so dots spread out evenly.
    const slotIdx: Record<string, number> = {};

    for (const e of entries) {
      const lobe = lobeFor(e.agent_id);
      // Alternate sides per entry index to fill both hemispheres.
      const side = (e.id % 2 === 0) ? 'left' : 'right';
      const surface = side === 'left' ? state.leftSurface : state.rightSurface;
      const key = `${lobe}-${side}`;
      const idx = slotIdx[key] = (slotIdx[key] ?? -1) + 1;
      const pos = pickSurface(surface, lobe, idx);
      if (!pos) continue;

      // Push the dot a bit outward along the surface normal so it
      // sits *on* the brain rather than embedded in it.
      const len = pos.length();
      const outward = pos.clone().multiplyScalar(1 + 0.015 / len);

      const colorHex = agentColors[e.agent_id] || '#888';
      const color = new THREE.Color(colorHex);

      const r = 0.022 * filters.nodeSize;
      const dotGeo = new THREE.SphereGeometry(r, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(outward);
      state.dotsGroup.add(dot);

      // Halo (additive sprite-style sphere)
      const haloGeo = new THREE.SphereGeometry(r * 3.5, 8, 8);
      const haloMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(outward);
      state.dotsGroup.add(halo);

      const entryWithLobe = { ...e, lobe };
      state.dotMap.set(dot, { entry: entryWithLobe, pos: outward, mesh: dot, halo });
    }
  }, [entries, agentColors, filters.nodeSize, ready]);

  // Apply visibility (agent / lobe / search filter) without rebuilding meshes.
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.dotMap.forEach((d) => {
      const e = d.entry;
      let visible = true;
      if (filters.hiddenAgents.has(e.agent_id)) visible = false;
      if (filters.hiddenLobes.has(e.lobe)) visible = false;
      if (agentFilter !== 'all' && e.agent_id !== agentFilter) visible = false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!e.summary.toLowerCase().includes(q) && !e.action.toLowerCase().includes(q)) visible = false;
      }
      const dotMat = d.mesh.material as THREE.MeshBasicMaterial;
      const haloMat = d.halo.material as THREE.MeshBasicMaterial;
      dotMat.opacity = visible ? 1 : 0.12;
      haloMat.opacity = visible ? 0.18 : 0.04;
    });
  }, [filters.hiddenAgents, filters.hiddenLobes, filters.query, agentFilter]);

  // Pointer move → raycast against dots
  function handleMove(e: MouseEvent) {
    const state = sceneStateRef.current;
    if (!state || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setMousePos({ x: cx, y: cy });

    state.pointer.x = (cx / rect.width) * 2 - 1;
    state.pointer.y = -(cy / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const dotMeshes = Array.from(state.dotMap.keys());
    const hits = state.raycaster.intersectObjects(dotMeshes, false);
    if (hits.length > 0) {
      const data = state.dotMap.get(hits[0].object);
      if (data) {
        setHovered(data.entry.id);
        return;
      }
    }
    setHovered(null);
  }

  function handleClick() {
    const state = sceneStateRef.current;
    if (!state) return;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const dotMeshes = Array.from(state.dotMap.keys());
    const hits = state.raycaster.intersectObjects(dotMeshes, false);
    if (hits.length > 0) {
      const data = state.dotMap.get(hits[0].object);
      if (data) {
        setSelected(data.entry);
        setPanelOpen(true);
      }
    }
  }

  // Pulse hovered dot
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.dotMap.forEach((d) => {
      const target = d.entry.id === hovered ? 1.6 : 1;
      d.mesh.scale.setScalar(target);
      d.halo.scale.setScalar(target);
    });
  }, [hovered]);

  const hoveredEntry = useMemo(() => {
    if (!hovered) return null;
    const state = sceneStateRef.current;
    if (!state) return null;
    for (const d of state.dotMap.values()) {
      if (d.entry.id === hovered) return d.entry;
    }
    return null;
  }, [hovered]);

  const visibleAgents = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.agent_id] = (counts[e.agent_id] || 0) + 1;
    return counts;
  }, [entries]);

  const visibleEntryCount = useMemo(() => {
    let n = 0;
    sceneStateRef.current?.dotMap.forEach((d) => {
      const e = d.entry;
      if (filters.hiddenAgents.has(e.agent_id)) return;
      if (filters.hiddenLobes.has(e.lobe)) return;
      if (agentFilter !== 'all' && e.agent_id !== agentFilter) return;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!e.summary.toLowerCase().includes(q) && !e.action.toLowerCase().includes(q)) return;
      }
      n++;
    });
    return n;
  }, [filters, agentFilter, entries]);

  function update<K extends keyof BrainFilters>(key: K, value: BrainFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function toggleHidden(set: 'hiddenAgents' | 'hiddenLobes', id: string) {
    setFilters((f) => {
      const next = new Set(f[set]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...f, [set]: next };
    });
  }

  return (
    <div class="flex-1 flex min-h-0 relative">
      <div
        ref={wrapRef}
        class="flex-1 relative overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, color-mix(in srgb, var(--color-accent) 7%, transparent), transparent 70%), var(--color-bg)',
          cursor: 'grab',
        }}
        onMouseMove={handleMove as any}
        onMouseDown={(e: any) => { (e.currentTarget as HTMLElement).style.cursor = 'grabbing'; }}
        onMouseUp={(e: any) => { (e.currentTarget as HTMLElement).style.cursor = 'grab'; }}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick as any}
      >
        {!panelOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPanelOpen(true); }}
            class="absolute top-4 right-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-card)]/90 border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[11.5px] text-[var(--color-text)] shadow-lg transition-colors z-10"
            style={{ backdropFilter: 'blur(8px)' }}
          >
            <SlidersHorizontal size={12} />
            Filters
            <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">
              {visibleEntryCount}
            </span>
          </button>
        )}

        {/* Drag hint */}
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10.5px] text-[var(--color-text-faint)] pointer-events-none select-none">
          drag to rotate · scroll to zoom
        </div>

        {hoveredEntry && mousePos && !selected && (
          <div
            class="absolute pointer-events-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl px-3 py-2 text-[11.5px] text-[var(--color-text)] max-w-[320px] z-10"
            style={{
              left: Math.min(mousePos.x + 14, (wrapRef.current?.clientWidth || 800) - 340),
              top: Math.min(mousePos.y + 14, (wrapRef.current?.clientHeight || 500) - 110),
              backdropFilter: 'blur(8px)',
            }}
          >
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: agentColors[hoveredEntry.agent_id] || 'var(--color-text-muted)' }}
              />
              <span class="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                @{hoveredEntry.agent_id} · {hoveredEntry.action}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)] ml-auto tabular-nums">
                {formatRelativeTime(hoveredEntry.created_at)}
              </span>
            </div>
            <div class={'leading-snug ' + (blurOn ? 'privacy-blur revealed' : '')}>
              {hoveredEntry.summary}
            </div>
          </div>
        )}
      </div>

      <aside
        class={[
          'absolute top-0 right-0 bottom-0 w-[320px] bg-[var(--color-card)] border-l border-[var(--color-border)] flex flex-col min-h-0 shadow-2xl z-20',
          'transition-transform duration-300 ease-out',
          panelOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        style={{ backdropFilter: 'blur(8px)' }}
      >
        {selected ? (
          <DetailPanel
            entry={selected}
            color={agentColors[selected.agent_id] || 'var(--color-text-muted)'}
            blurOn={blurOn}
            lobeLabel={LOBE_BY_ID[lobeFor(selected.agent_id)]?.label}
            onClose={() => { setSelected(null); setPanelOpen(false); }}
          />
        ) : (
          <FilterPanel
            filters={filters}
            update={update}
            toggleHidden={toggleHidden}
            visibleAgents={visibleAgents}
            agentColors={agentColors}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            totalEntries={entries.length}
            visibleEntries={visibleEntryCount}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </aside>
    </div>
  );
}

// Detail + Filter panels: identical to the 2D version visually.

function DetailPanel({
  entry, color, blurOn, lobeLabel, onClose,
}: {
  entry: HiveEntry; color: string; blurOn: boolean; lobeLabel?: string; onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      <header class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <span class="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span class="font-mono text-[12px] text-[var(--color-text)]">@{entry.agent_id}</span>
        {lobeLabel && (
          <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] ml-1">{lobeLabel}</span>
        )}
        <span class="text-[10.5px] text-[var(--color-text-faint)] ml-auto tabular-nums">
          {formatRelativeTime(entry.created_at)}
        </span>
        <button type="button" onClick={onClose} class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          <X size={13} />
        </button>
      </header>
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <Field label="Action"><span class="font-mono text-[11.5px] text-[var(--color-text)]">{entry.action}</span></Field>
        <Field label="Summary">
          <div
            class={'text-[12.5px] text-[var(--color-text)] leading-relaxed ' + (blurOn && !revealed ? 'privacy-blur' : (blurOn && revealed ? 'privacy-blur revealed' : ''))}
            onClick={() => blurOn && setRevealed((v) => !v)}
          >
            {entry.summary}
          </div>
        </Field>
        {entry.artifacts && (
          <Field label="Artifacts">
            <div class="font-mono text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words">{entry.artifacts}</div>
          </Field>
        )}
        <Field label="Chat">
          <div class="font-mono text-[11px] text-[var(--color-text-muted)] truncate">{entry.chat_id}</div>
        </Field>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{label}</div>
      {children}
    </div>
  );
}

function FilterPanel({
  filters, update, toggleHidden, visibleAgents, agentColors, onReset, totalEntries, visibleEntries, onClose,
}: {
  filters: BrainFilters;
  update: <K extends keyof BrainFilters>(key: K, value: BrainFilters[K]) => void;
  toggleHidden: (set: 'hiddenAgents' | 'hiddenLobes', id: string) => void;
  visibleAgents: Record<string, number>;
  agentColors: Record<string, string>;
  onReset: () => void;
  totalEntries: number;
  visibleEntries: number;
  onClose: () => void;
}) {
  const [openSection, setOpenSection] = useState({ agents: true, lobes: false, display: false });
  return (
    <>
      <header class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <Sparkles size={13} class="text-[var(--color-accent)]" />
        <span class="text-[12.5px] font-semibold text-[var(--color-text)]">Filters</span>
        <span class="text-[10.5px] text-[var(--color-text-faint)] ml-auto tabular-nums">
          {visibleEntries} / {totalEntries}
        </span>
        <button type="button" onClick={onReset} class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title="Reset">
          <RotateCw size={11} />
        </button>
        <button type="button" onClick={onClose} class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title="Close">
          <X size={13} />
        </button>
      </header>
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div class="relative">
          <Search size={12} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            value={filters.query}
            onInput={(e) => update('query', (e.target as HTMLInputElement).value)}
            placeholder="Search summaries…"
            class="w-full pl-7 pr-2.5 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none text-[12px] text-[var(--color-text)]"
          />
        </div>
        <Section label="Agents" open={openSection.agents} onToggle={() => setOpenSection((s) => ({ ...s, agents: !s.agents }))}>
          <div class="space-y-1">
            {Object.entries(visibleAgents).sort((a, b) => b[1] - a[1]).map(([id, count]) => {
              const on = !filters.hiddenAgents.has(id);
              const color = agentColors[id] || 'var(--color-text-muted)';
              const lobe = LOBE_BY_ID[lobeFor(id)];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleHidden('hiddenAgents', id)}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left"
                >
                  <span class="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: on ? `0 0 6px ${color}` : 'none' }} />
                  <span class={'font-mono text-[11.5px] ' + (on ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>@{id}</span>
                  {lobe && <span class="text-[10px]" style={{ color: on ? `#${lobe.color.getHexString()}` : 'var(--color-text-faint)', opacity: on ? 0.75 : 0.4 }}>{lobe.label.toLowerCase()}</span>}
                  <span class="ml-auto text-[10.5px] tabular-nums text-[var(--color-text-faint)]">{count}</span>
                  <span class={'brain-switch ' + (on ? 'is-on' : '')} />
                </button>
              );
            })}
          </div>
        </Section>
        <Section label="Regions" open={openSection.lobes} onToggle={() => setOpenSection((s) => ({ ...s, lobes: !s.lobes }))}>
          <div class="space-y-1">
            {LOBES.map((l) => {
              const on = !filters.hiddenLobes.has(l.id);
              const colorHex = `#${l.color.getHexString()}`;
              return (
                <button key={l.id} type="button" onClick={() => toggleHidden('hiddenLobes', l.id)} class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left">
                  <span class="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorHex, opacity: on ? 1 : 0.3, boxShadow: on ? `0 0 6px ${colorHex}` : 'none' }} />
                  <span class={'text-[12px] ' + (on ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>{l.label}</span>
                  <span class={'brain-switch ml-auto ' + (on ? 'is-on' : '')} />
                </button>
              );
            })}
          </div>
        </Section>
        <Section label="Display" open={openSection.display} onToggle={() => setOpenSection((s) => ({ ...s, display: !s.display }))}>
          <SliderRow label="Node size" value={filters.nodeSize} min={0.5} max={2} step={0.05} onInput={(v) => update('nodeSize', v)} />
        </Section>
      </div>
    </>
  );
}

function Section({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: any }) {
  return (
    <div>
      <button type="button" onClick={onToggle} class="w-full flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] mb-1.5">
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onInput, fmt }: { label: string; value: number; min: number; max: number; step: number; onInput: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" class="brain-slider" min={min} max={max} step={step} value={value} onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}
