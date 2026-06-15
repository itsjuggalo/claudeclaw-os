// BodyMap — an interactive front+back human figure. Each hotspot is a body
// region whose `key` matches a technique-frame region tag. Click a region to
// drive the explorer panel (muscles + Erik's techniques for that area). Pure
// SVG, fully offline. Emerald = Erik Dalton accent.
import { useState } from 'preact/hooks';

const ACCENT = '#10b981';

export function BodyMap({ selected, onSelect }: {
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  // Shared interactive props for a hotspot shape. Typed loosely: we spread these
  // onto several SVG element kinds (ellipse/rect), so Preact's per-element strict
  // attribute typing would reject a single shared shape — the attrs are valid SVG.
  const zp = (key: string): Record<string, unknown> => ({
    fill: ACCENT,
    opacity: selected === key ? 0.74 : hover === key ? 0.5 : 0.16,
    stroke: selected === key ? ACCENT : 'transparent',
    'stroke-width': 1.4,
    style: { cursor: 'pointer', transition: 'opacity .12s, stroke .12s' },
    onClick: () => onSelect(key),
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover(null),
  });

  const bodyFill = 'var(--color-bg)';
  const bodyStroke = 'var(--color-border)';

  // A simple humanoid backdrop (non-interactive) drawn behind the hotspots.
  const backdrop = (
    <g fill={bodyFill} stroke={bodyStroke} stroke-width="1.2">
      <circle cx="60" cy="22" r="16" />
      <rect x="40" y="37" width="40" height="94" rx="16" />
      <rect x="21" y="52" width="14" height="84" rx="7" />
      <rect x="85" y="52" width="14" height="84" rx="7" />
      <rect x="43" y="120" width="34" height="26" rx="11" />
      <rect x="45" y="142" width="13" height="162" rx="6" />
      <rect x="62" y="142" width="13" height="162" rx="6" />
      <ellipse cx="51" cy="312" rx="10" ry="7" />
      <ellipse cx="69" cy="312" rx="10" ry="7" />
    </g>
  );

  const Title = ({ children }: { children: string }) => <title>{children}</title>;

  // FRONT view hotspots.
  const front = (
    <svg viewBox="0 0 120 330" width="100%" style={{ maxWidth: '190px' }} role="img" aria-label="Front body map">
      {backdrop}
      <ellipse cx="60" cy="22" rx="15" ry="16" {...zp('head/face')}><Title>Head / Face</Title></ellipse>
      <ellipse cx="60" cy="36" rx="12" ry="5" {...zp('jaw/TMJ')}><Title>Jaw / TMJ</Title></ellipse>
      <rect x="51" y="41" width="18" height="10" rx="3" {...zp('neck')}><Title>Neck</Title></rect>
      <ellipse cx="37" cy="60" rx="12" ry="9" {...zp('shoulder')}><Title>Shoulder</Title></ellipse>
      <ellipse cx="83" cy="60" rx="12" ry="9" {...zp('shoulder')}><Title>Shoulder</Title></ellipse>
      <rect x="43" y="56" width="34" height="26" rx="7" {...zp('thoracic/ribs')}><Title>Thoracic / Ribs</Title></rect>
      <rect x="44" y="84" width="32" height="28" rx="7" {...zp('core/abdomen')}><Title>Core / Abdomen</Title></rect>
      <rect x="22" y="66" width="14" height="28" rx="7" {...zp('arm')}><Title>Upper Arm</Title></rect>
      <rect x="84" y="66" width="14" height="28" rx="7" {...zp('arm')}><Title>Upper Arm</Title></rect>
      <rect x="21" y="96" width="14" height="30" rx="6" {...zp('elbow')}><Title>Elbow / Forearm</Title></rect>
      <rect x="85" y="96" width="14" height="30" rx="6" {...zp('elbow')}><Title>Elbow / Forearm</Title></rect>
      <ellipse cx="27" cy="133" rx="8" ry="9" {...zp('wrist/hand')}><Title>Wrist / Hand</Title></ellipse>
      <ellipse cx="93" cy="133" rx="8" ry="9" {...zp('wrist/hand')}><Title>Wrist / Hand</Title></ellipse>
      <rect x="44" y="114" width="32" height="22" rx="7" {...zp('hip/glutes')}><Title>Hip / Glutes</Title></rect>
      <ellipse cx="51" cy="210" rx="9" ry="12" {...zp('knee')}><Title>Knee / Thigh</Title></ellipse>
      <ellipse cx="69" cy="210" rx="9" ry="12" {...zp('knee')}><Title>Knee / Thigh</Title></ellipse>
      <ellipse cx="50" cy="296" rx="9" ry="11" {...zp('foot/ankle')}><Title>Foot / Ankle</Title></ellipse>
      <ellipse cx="70" cy="296" rx="9" ry="11" {...zp('foot/ankle')}><Title>Foot / Ankle</Title></ellipse>
    </svg>
  );

  // BACK view hotspots (spine, low back, SI, glutes are the back-specific ones).
  const back = (
    <svg viewBox="0 0 120 330" width="100%" style={{ maxWidth: '190px' }} role="img" aria-label="Back body map">
      {backdrop}
      <ellipse cx="60" cy="22" rx="15" ry="16" {...zp('head/face')}><Title>Occiput / Head</Title></ellipse>
      <rect x="51" y="41" width="18" height="10" rx="3" {...zp('neck')}><Title>Neck</Title></rect>
      <ellipse cx="37" cy="60" rx="12" ry="9" {...zp('shoulder')}><Title>Shoulder</Title></ellipse>
      <ellipse cx="83" cy="60" rx="12" ry="9" {...zp('shoulder')}><Title>Shoulder</Title></ellipse>
      <rect x="43" y="55" width="34" height="24" rx="6" {...zp('thoracic/ribs')}><Title>Thoracic / Ribs</Title></rect>
      <rect x="22" y="66" width="14" height="28" rx="7" {...zp('arm')}><Title>Upper Arm</Title></rect>
      <rect x="84" y="66" width="14" height="28" rx="7" {...zp('arm')}><Title>Upper Arm</Title></rect>
      <rect x="21" y="96" width="14" height="30" rx="6" {...zp('elbow')}><Title>Elbow / Forearm</Title></rect>
      <rect x="85" y="96" width="14" height="30" rx="6" {...zp('elbow')}><Title>Elbow / Forearm</Title></rect>
      <rect x="46" y="100" width="28" height="20" rx="5" {...zp('low back')}><Title>Low Back</Title></rect>
      <rect x="49" y="120" width="22" height="14" rx="4" {...zp('pelvis/SI')}><Title>Pelvis / SI</Title></rect>
      <ellipse cx="51" cy="142" rx="11" ry="11" {...zp('hip/glutes')}><Title>Hip / Glutes</Title></ellipse>
      <ellipse cx="69" cy="142" rx="11" ry="11" {...zp('hip/glutes')}><Title>Hip / Glutes</Title></ellipse>
      <ellipse cx="51" cy="210" rx="9" ry="12" {...zp('knee')}><Title>Knee / Thigh</Title></ellipse>
      <ellipse cx="69" cy="210" rx="9" ry="12" {...zp('knee')}><Title>Knee / Thigh</Title></ellipse>
      <ellipse cx="50" cy="296" rx="9" ry="11" {...zp('foot/ankle')}><Title>Foot / Ankle (calf)</Title></ellipse>
      <ellipse cx="70" cy="296" rx="9" ry="11" {...zp('foot/ankle')}><Title>Foot / Ankle (calf)</Title></ellipse>
      {/* spine strip drawn last so it stays clickable over the thoracic plate */}
      <rect x="56" y="54" width="8" height="66" rx="4" {...zp('spine/general')}><Title>Spine</Title></rect>
    </svg>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          {front}
          <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '1px' }}>Front</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {back}
          <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '1px' }}>Back</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: '6px', minHeight: '18px', fontSize: '12px', fontWeight: 600, color: ACCENT }}>
        {hover || selected
          ? (hover || selected)!.replace(/\b\w/g, (c) => c.toUpperCase()).replace('/', ' / ')
          : 'Click a body region to learn'}
      </div>
    </div>
  );
}
