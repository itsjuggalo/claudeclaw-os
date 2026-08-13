#!/usr/bin/env node
// bunker-diagram.mjs — render a diagram spec into self-contained house-style HTML.
//
// This is the codified form of bunker-diagram-spec.md: curved rx:13 boxes, the
// TONES palette, clickable drill-down via data-drill, and breadcrumb navigation. It is
// a self-contained, dependency-free SVG diagram style (no mermaid). Author a diagram
// as a JSON data spec and render it here instead of styling by hand. Pipe the output
// straight into scripts/bunker-add.mjs to drop it on the dashboard Bunker.
//
// Usage:
//   node scripts/bunker-diagram.mjs spec.json            # HTML to stdout
//   node scripts/bunker-diagram.mjs spec.json -o out.html
//   node scripts/bunker-diagram.mjs spec.json | \
//     node scripts/bunker-add.mjs --title "..." --tags a,b
//
// Spec shape (see bunker-diagram-spec.md for the full VIEWS data model):
//   {
//     "title":   "<page title>",            // <title> + og
//     "eyebrow": "See it in motion",        // pill above h1 (optional)
//     "h1":      "<big heading>",
//     "lede":    "<intro paragraph, may contain simple HTML>",
//     "initial": "main",                     // first view id (default "main")
//     "legend":  [ {"sw":"<css background/border>","label":"..."} ],  // optional
//     "tip":     "<tip line, may contain <b>>",                       // optional
//     "views":   { ...VIEWS object... }
//   }
//
// Also importable: `import { renderDiagram } from './bunker-diagram.mjs'`.

import fs from 'fs';

const DEFAULT_LEGEND = [
  { sw: 'background:rgba(6,182,212,0.5);border:1px solid #06b6d4', label: 'a step it does' },
  { sw: 'background:rgba(245,124,0,0.5);border:1px solid #f57c00', label: 'a moment you decide' },
  { sw: 'background:rgba(20,184,166,0.6);border:1px solid #14b8a6', label: 'a useful result' },
  { sw: 'background:rgba(139,92,246,0.5);border:1px solid #a78bfa', label: 'it learns' },
  { sw: 'background:rgba(120,30,30,0.45);border:1px dashed #b04a4a', label: 'dropped' },
];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// `lede`/`tip`/legend labels may carry simple inline HTML (<b>, <span style>), so they
// are intentionally NOT escaped — they are authored content, not untrusted input.
export function renderDiagram(spec) {
  const {
    title = 'Diagram',
    eyebrow = 'See it in motion',
    h1 = title,
    lede = '',
    initial = 'main',
    legend = DEFAULT_LEGEND,
    tip = '',
    views = {},
  } = spec;

  const legendHtml = legend
    .map((l) => `    <i><span class="sw" style="${l.sw}"></span> ${l.label}</i>`)
    .join('\n');

  // Machine-readable text index: a flat, visually-hidden outline of every view,
  // node, branch and drop label. The diagram itself is drawn by JS at runtime
  // (so its labels live in a <script> and vanish from any text extraction), but
  // the dashboard's "promote to vault" strips <script>/<style> and keeps plain
  // text — so this block is what lets a promoted diagram land in the vault with
  // all of its content searchable, not just the page chrome.
  const textIndex = Object.entries(views)
    .map(([id, v]) => {
      const lines = [`${v.title || id}: ${v.intro || ''}`.trim()];
      for (const n of v.nodes || []) lines.push(`- ${n.label}${n.sub ? ` (${n.sub})` : ''}`);
      for (const o of v.outs || [])
        lines.push(`- ${o.tag ? `${o.tag}: ` : ''}${o.label}${o.sub ? ` (${o.sub})` : ''}`);
      for (const d of v.drops || []) lines.push(`- dropped: ${d.label}`);
      return lines.join('\n');
    })
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="theme-color" content="#0b0b13" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0b0b13; --teal:#14b8a6; --cyan:#06b6d4; --orange:#e85d04; --orange-light:#f57c00;
    --purple:#a78bfa; --card:rgba(30,41,59,0.90); --txt:#fff; --txt2:#e6f7f7;
    --accent:#7dd3fc; --rule:rgba(20,184,166,0.18); --muted:#9aa6b2;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{
    background:var(--bg); color:var(--txt2);
    font-family:'Inter',system-ui,-apple-system,sans-serif; line-height:1.55;
    -webkit-font-smoothing:antialiased;
    background-image:
      radial-gradient(1200px 600px at 50% -10%, rgba(6,182,212,0.16), transparent 60%),
      radial-gradient(900px 500px at 85% 20%, rgba(232,93,4,0.07), transparent 55%),
      linear-gradient(rgba(125,211,252,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(125,211,252,0.035) 1px, transparent 1px);
    background-size:auto, auto, 48px 48px, 48px 48px;
    background-attachment:fixed;
  }
  a{color:var(--accent);text-decoration:none}
  a:hover{color:var(--cyan)}
  .wrap{max-width:1000px;margin:0 auto;padding:0 18px}

  .head{padding:40px 0 8px;text-align:center}
  .eyebrow{display:inline-block;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--cyan);border:1px solid var(--rule);padding:6px 14px;border-radius:999px;margin-bottom:18px}
  h1{font-size:clamp(28px,5vw,44px);line-height:1.08;color:#fff;font-weight:800;letter-spacing:-0.5px}
  .lede{margin:14px auto 0;max-width:620px;font-size:16px;color:var(--muted)}

  /* breadcrumb + controls */
  .controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:26px 0 6px;min-height:38px}
  .crumb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
  .crumb b{color:var(--txt2);font-weight:600}
  .crumb .sep{color:#3a4a5a}
  .crumb .clk{color:var(--accent);cursor:pointer}
  .crumb .clk:hover{color:var(--cyan)}
  .backbtn{margin-left:auto;display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:8px;
    font-weight:600;font-size:14px;border:1px solid var(--rule);color:var(--txt2);background:rgba(30,41,59,0.6);cursor:pointer}
  .backbtn:hover{border-color:var(--cyan);color:#fff}
  .backbtn[disabled]{opacity:0.35;cursor:default}

  .stage{background:var(--card);border:1px solid var(--rule);border-radius:18px;padding:14px 8px 8px;box-shadow:0 10px 36px rgba(0,0,0,0.35)}
  .view-title{color:#fff;font-weight:700;font-size:18px;padding:6px 12px 0}
  .view-intro{color:var(--muted);font-size:14px;padding:2px 12px 8px}
  svg{width:100%;height:auto;display:block}
  .node{cursor:default}
  .clickable{cursor:pointer}
  .clickable rect, .clickable polygon{transition:filter .15s, stroke-width .15s}
  .clickable:hover rect, .clickable:hover polygon{filter:brightness(1.35);stroke-width:2.6}

  .legend{display:flex;gap:18px;flex-wrap:wrap;margin:16px 4px 0;font-size:12.5px;color:var(--muted)}
  .legend i{font-style:normal;display:inline-flex;align-items:center;gap:7px}
  .sw{width:18px;height:12px;border-radius:3px;display:inline-block}
  .tip{margin:14px 4px 0;font-size:13px;color:var(--muted)}
  .tip b{color:var(--orange-light)}
  footer{border-top:1px solid var(--rule);padding:34px 0;margin-top:34px;text-align:center;color:var(--muted);font-size:13px}
</style>
</head>
<body>

<div class="wrap">
  <div class="head">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
    <h1>${esc(h1)}</h1>
    ${lede ? `<p class="lede">${lede}</p>` : ''}
  </div>

  <div class="controls">
    <div class="crumb" id="crumb"></div>
    <button class="backbtn" id="back">&larr; Back</button>
  </div>

  <div class="stage">
    <div class="view-title" id="vtitle"></div>
    <div class="view-intro" id="vintro"></div>
    <div id="canvas"></div>
  </div>

  <div class="legend">
${legendHtml}
  </div>
  ${tip ? `<p class="tip">${tip}</p>` : ''}
  <div class="diagram-text" hidden aria-hidden="true">
${esc(textIndex)}
  </div>
</div>

<script>
/* View model — see bunker-diagram-spec.md. nodes: vertical spine
   (start|step|decision|end), drill -> open another view; outs: result boxes
   to the right; drops: dead-ends to the left (dashed). */
const VIEWS = ${JSON.stringify(views, null, 2)};
const INITIAL = ${JSON.stringify(initial)};

/* ----------------------------- renderer ----------------------------- */
const CX = 300, NW = 216, NH = 60, GAP = 46;       // spine geometry
const OUTX = 470, OW = 300, OH = 56;               // result boxes (right)
const DROPX = 18, DRW = 150, DRH = 46;             // dead-ends (left)
const SVGNS = "http://www.w3.org/2000/svg";

const TONES = {
  step:    {fill:"rgba(6,182,212,0.12)",  stroke:"#06b6d4", text:"#dff6ff"},
  start:   {fill:"rgba(6,182,212,0.18)",  stroke:"#22d3ee", text:"#eafbff"},
  decision:{fill:"rgba(245,124,0,0.13)",  stroke:"#f57c00", text:"#ffe9d2"},
  end:     {fill:"rgba(20,184,166,0.22)", stroke:"#2dd4bf", text:"#e9fff9"},
  result:  {fill:"rgba(20,184,166,0.16)", stroke:"#14b8a6", text:"#e9fff9"},
  cal:     {fill:"rgba(232,93,4,0.16)",   stroke:"#f57c00", text:"#ffe9d2"},
  know:    {fill:"rgba(6,182,212,0.16)",  stroke:"#06b6d4", text:"#dff6ff"},
  taste:   {fill:"rgba(139,92,246,0.16)", stroke:"#a78bfa", text:"#efe9ff"},
  drop:    {fill:"rgba(120,30,30,0.20)",  stroke:"#b04a4a", text:"#e8b9b9"}
};

let stack = [];   // breadcrumb of {id,title}
let bounds;

function resetBounds(){ bounds = {x0:1e9,y0:1e9,x1:-1e9,y1:-1e9}; }
function reg(x,y){ bounds.x0=Math.min(bounds.x0,x); bounds.y0=Math.min(bounds.y0,y);
                   bounds.x1=Math.max(bounds.x1,x); bounds.y1=Math.max(bounds.y1,y); }

function el(name, attrs, parent){
  const e = document.createElementNS(SVGNS, name);
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  if(parent) parent.appendChild(e);
  return e;
}

function textBlock(parent, cx, cy, label, sub, color){
  if(sub){
    const t1 = el("text",{x:cx,y:cy-4,"text-anchor":"middle","font-size":"14.5","font-weight":"600",fill:color},parent);
    t1.textContent = label;
    const t2 = el("text",{x:cx,y:cy+15,"text-anchor":"middle","font-size":"12",fill:color,"fill-opacity":"0.82"},parent);
    t2.textContent = sub;
  } else {
    const t = el("text",{x:cx,y:cy+5,"text-anchor":"middle","font-size":"14.5","font-weight":"600",fill:color},parent);
    t.textContent = label;
  }
}

function box(parent, x, y, w, h, tone, label, sub, opts){
  opts = opts || {};
  const g = el("g",{class: opts.drill ? "node clickable" : "node"}, parent);
  if(opts.drill) g.setAttribute("data-drill", opts.drill);
  const t = TONES[tone] || TONES.step;
  const r = el("rect",{x,y,width:w,height:h,rx:13,fill:t.fill,stroke:t.stroke,
    "stroke-width": opts.bold?2.4:1.6}, g);
  if(opts.dash) r.setAttribute("stroke-dasharray","6 4");
  textBlock(g, x+w/2, y+h/2, label, sub, t.text);
  reg(x-4,y-4); reg(x+w+4,y+h+4);
  return g;
}

function arrow(parent, x1,y1,x2,y2, color, dash){
  const ln = el("line",{x1,y1,x2,y2,stroke:color,"stroke-width":2.2,
    "marker-end":"url(#mk-"+color.replace('#','')+")"}, parent);
  if(dash) ln.setAttribute("stroke-dasharray","6 4");
  reg(Math.min(x1,x2),Math.min(y1,y2)); reg(Math.max(x1,x2),Math.max(y1,y2));
}

function tagText(parent, x, y, txt, color){
  const t = el("text",{x,y,"text-anchor":"middle","font-size":"12",fill:color,"font-weight":"600"},parent);
  t.textContent = txt;
  reg(x-txt.length*3.2, y-10); reg(x+txt.length*3.2, y+4);
}

function markers(svg){
  const defs = el("defs",{},svg);
  const colors = ["#7f97a6","#f57c00","#14b8a6","#06b6d4","#a78bfa","#b04a4a"];
  colors.forEach(c=>{
    const m = el("marker",{id:"mk-"+c.replace('#',''),markerWidth:9,markerHeight:9,
      refX:6.5,refY:3,orient:"auto"},defs);
    el("path",{d:"M0,0 L7,3 L0,6 z",fill:c},m);
  });
}

function render(id, push){
  const v = VIEWS[id];
  if(!v) return;
  if(push) stack.push({id, title:v.title});

  document.getElementById("vtitle").textContent = v.title;
  document.getElementById("vintro").textContent = v.intro || "";

  // layout spine
  const ys = {}; let y = 30;
  v.nodes.forEach((n)=>{ ys[n.id] = y; y += NH + (n.gapAfter!=null ? n.gapAfter : GAP); });

  const canvas = document.getElementById("canvas");
  canvas.innerHTML = "";
  const svg = el("svg",{role:"img","aria-label":v.title}, canvas);
  markers(svg);
  resetBounds();

  // spine arrows first (behind boxes)
  for(let i=0;i<v.nodes.length-1;i++){
    const a = v.nodes[i], b = v.nodes[i+1];
    arrow(svg, CX, ys[a.id]+NH, CX, ys[b.id], "#7f97a6");
  }

  // result boxes (right)
  (v.outs||[]).forEach(o=>{
    const ny = ys[o.at] + NH/2 + (o.off||0);
    const t = TONES[o.tone] || TONES.result;
    arrow(svg, CX+NW/2, ys[o.at]+NH/2, OUTX-6, ny, t.stroke);
    if(o.tag) tagText(svg, (CX+NW/2+OUTX)/2, Math.min(ys[o.at]+NH/2, ny)-7, o.tag, t.stroke);
    box(svg, OUTX, ny-OH/2, OW, OH, o.tone, o.label, o.sub, {drill:o.drill, bold:true});
  });

  // dead-ends (left)
  (v.drops||[]).forEach(d=>{
    const ny = ys[d.at] + NH/2 + (d.off||0);
    arrow(svg, CX-NW/2, ys[d.at]+NH/2, DROPX+DRW+6, ny, "#b04a4a", true);
    box(svg, DROPX, ny-DRH/2, DRW, DRH, "drop", d.label, null, {dash:true});
  });

  // spine boxes (on top)
  v.nodes.forEach(n=>{
    box(svg, CX-NW/2, ys[n.id], NW, NH, n.kind, n.label, n.sub,
      {drill:n.drill, bold:(n.kind==="end"||n.kind==="start")});
  });

  // size viewBox to content with padding
  const pad = 16;
  const vbX = bounds.x0-pad, vbY = bounds.y0-pad;
  const vbW = (bounds.x1-bounds.x0)+pad*2, vbH = (bounds.y1-bounds.y0)+pad*2;
  svg.setAttribute("viewBox", \`\${vbX} \${vbY} \${vbW} \${vbH}\`);
  svg.setAttribute("style", \`max-height:\${Math.min(vbH,1500)}px\`);

  drawCrumb();
  document.getElementById("back").disabled = stack.length<=1;
}

function drawCrumb(){
  const c = document.getElementById("crumb");
  c.innerHTML = "";
  stack.forEach((s,i)=>{
    if(i>0){ const sep=document.createElement("span"); sep.className="sep"; sep.textContent=" › "; c.appendChild(sep); }
    const span = document.createElement("span");
    if(i===stack.length-1){ const b=document.createElement("b"); b.textContent=s.title; span.appendChild(b); }
    else { span.className="clk"; span.textContent=s.title; span.onclick=()=>goTo(i); }
    c.appendChild(span);
  });
}

function goTo(i){ stack = stack.slice(0,i+1); render(stack[i].id, false); }
function back(){ if(stack.length>1){ stack.pop(); render(stack[stack.length-1].id, false); } }

document.getElementById("canvas").addEventListener("click", e=>{
  const g = e.target.closest("[data-drill]");
  if(g) render(g.getAttribute("data-drill"), true);
});
document.getElementById("back").addEventListener("click", back);

render(INITIAL, true);
</script>
</body>
</html>
`;
}

// ----------------------------- CLI -----------------------------
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2);
  let specPath = null;
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--out') outPath = argv[++i];
    else if (!argv[i].startsWith('-')) specPath = argv[i];
  }
  if (!specPath) {
    console.error('Usage: bunker-diagram.mjs <spec.json> [-o out.html]');
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const html = renderDiagram(spec);
  if (outPath) {
    fs.writeFileSync(outPath, html);
    console.error(`Wrote ${outPath}`);
  } else {
    process.stdout.write(html);
  }
}
