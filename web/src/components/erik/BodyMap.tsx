// BodyMap — interactive front+back anatomical muscle figure for the Erik Dalton
// explorer. Real muscle plates (react-native-body-highlighter, MIT) vendored in
// ./bodyFigureData, re-themed for Erik: a neutral body that glows emerald on the
// active region. Click a region to drive the explorer (lessons + technique clips).
// Same `{ selected, onSelect }` contract as the 3D <AnatomyViewer> above it.
import { useState } from 'preact/hooks';
import { FRONT, BACK, FRONT_BOX, BACK_BOX, type MusclePart } from './bodyFigureData';
import { REGION_BY_KEY } from './regions';

const ACCENT = '#10b981';

// Muscle slug (react-native-body-highlighter) → Erik region key (regions.ts).
// The key MUST equal the technique-frame `region` tag so a click filters lessons.
// Anatomy is honored: trapezius→neck, adductors→hip/glutes, gastroc/soleus→foot.
const SLUG_TO_REGION: Record<string, string> = {
  head: 'head/face', hair: 'head/face',
  neck: 'neck', trapezius: 'neck',
  deltoids: 'shoulder',
  chest: 'thoracic/ribs', 'upper-back': 'thoracic/ribs',
  abs: 'core/abdomen', obliques: 'core/abdomen',
  'lower-back': 'low back',
  gluteal: 'hip/glutes', adductors: 'hip/glutes',
  biceps: 'arm', triceps: 'arm',
  forearm: 'elbow',
  hands: 'wrist/hand',
  quadriceps: 'knee', hamstring: 'knee', knees: 'knee',
  calves: 'foot/ankle', tibialis: 'foot/ankle', ankles: 'foot/ankle', feet: 'foot/ankle',
};

// Flatten a figure's parts to { slug, ds[] } (left + right + common path strings).
function slugDs(figure: MusclePart[]): { slug: string; ds: string[] }[] {
  return (figure || []).map((o) => ({
    slug: o.slug,
    ds: [...(o.path.left || []), ...(o.path.right || []), ...(o.path.common || [])],
  }));
}

// ── Static layout (path data is constant, so bbox transforms are computed once) ──
// Scale both figures to a common drawn height H and lay them side by side.
const H = 330, PAD = 12, GAP = 46, LABEL_H = 30;
const fW = FRONT_BOX[2] - FRONT_BOX[0], fH = FRONT_BOX[3] - FRONT_BOX[1];
const bW = BACK_BOX[2] - BACK_BOX[0], bH = BACK_BOX[3] - BACK_BOX[1];
const fS = H / fH, bS = H / bH;
const fDrawW = fW * fS, bDrawW = bW * bS;
const fTx = PAD - FRONT_BOX[0] * fS, fTy = PAD - FRONT_BOX[1] * fS;
const bOffX = PAD + fDrawW + GAP;
const bTx = bOffX - BACK_BOX[0] * bS, bTy = PAD - BACK_BOX[1] * bS;
const TOTAL_W = Math.round(PAD + fDrawW + GAP + bDrawW + PAD);
const TOTAL_H = Math.round(PAD + H + LABEL_H);
const FRONT_PARTS = slugDs(FRONT);
const BACK_PARTS = slugDs(BACK);

const titleCase = (k: string) => REGION_BY_KEY[k]?.label || k;

export function BodyMap({ selected, onSelect }: {
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (!FRONT_PARTS.length) return null; // data failed to load — let the 3D / chips carry it

  // Render one figure (front or back) as scaled, region-tinted muscle paths.
  const figure = (parts: { slug: string; ds: string[] }[], tx: number, ty: number, s: number, view: string) => {
    const out: preact.JSX.Element[] = [];
    parts.forEach(({ slug, ds }, pi) => {
      const region = SLUG_TO_REGION[slug] || null;
      const isSel = !!region && selected === region;
      const isHov = !!region && hover === region;
      // Neutral body by default; emerald wash on hover, bright on select.
      const fill = isSel || isHov ? ACCENT : 'var(--color-border)';
      const fillOp = isSel ? 0.66 : isHov ? 0.4 : 0.2;
      const stroke = isSel || isHov ? ACCENT : 'var(--color-border)';
      ds.forEach((d, di) => {
        out.push(
          <path
            key={`${view}-${pi}-${di}`}
            d={d}
            fill={fill}
            fill-opacity={fillOp}
            stroke={stroke}
            stroke-width={isSel ? 1.6 : isHov ? 1.3 : 0.8}
            vector-effect="non-scaling-stroke"
            style={{ cursor: region ? 'pointer' : 'default', transition: 'fill-opacity .12s, stroke .12s, fill .12s' }}
            onClick={region ? () => onSelect(region) : undefined}
            onMouseEnter={region ? () => setHover(region) : undefined}
            onMouseLeave={region ? () => setHover(null) : undefined}
          >
            {region && <title>{titleCase(region)}</title>}
          </path>,
        );
      });
    });
    return <g transform={`translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${s.toFixed(4)})`}>{out}</g>;
  };

  const labelY = (PAD + H + 20).toFixed(0);
  const active = hover || selected;

  return (
    <div style={{ width: '440px', maxWidth: '100%' }}>
      <svg
        viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
        width="100%"
        style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
        role="img"
        aria-label="Interactive muscle body map — click a region to learn Erik Dalton techniques"
      >
        {figure(FRONT_PARTS, fTx, fTy, fS, 'f')}
        {figure(BACK_PARTS, bTx, bTy, bS, 'b')}
        <text x={(PAD + fDrawW / 2).toFixed(0)} y={labelY} text-anchor="middle"
          fill="var(--color-text-faint)" font-size="12" font-weight="600" style={{ letterSpacing: '1px' }}>FRONT</text>
        <text x={(bOffX + bDrawW / 2).toFixed(0)} y={labelY} text-anchor="middle"
          fill="var(--color-text-faint)" font-size="12" font-weight="600" style={{ letterSpacing: '1px' }}>BACK</text>
      </svg>
      <div style={{ textAlign: 'center', marginTop: '6px', minHeight: '18px', fontSize: '12px', fontWeight: 600, color: ACCENT }}>
        {active ? titleCase(active) : 'Click a body region to learn'}
      </div>
    </div>
  );
}
