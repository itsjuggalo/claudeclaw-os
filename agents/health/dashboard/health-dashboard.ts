// Health OS dashboard — self-contained, server-rendered, drag/resize widgets.
//
// One template literal. Chart.js + GridStack from CDN, dark theme. The token is
// embedded (page reached via /healthdb, token kept in a cookie, see dashboard.ts)
// and the client polls /api/healthdb?range=7|30|90 so the board stays live with
// Supabase. Every panel is an independent GridStack widget: drag by its header,
// resize from the edges, layout persisted to localStorage (desktop).
//
// Client JS uses string CONCATENATION (never client-side template literals) so
// nothing collides with this TS template literal's ${...}.

export function getHealthDashboardHtml(token: string, defaultRange = 30): string {
  const tokenJson = JSON.stringify(token);
  const rangeJson = JSON.stringify([7, 30, 90].includes(defaultRange) ? defaultRange : 30);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Health OS</title>
<meta name="theme-color" content="#07080a">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/gridstack@11/dist/gridstack.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/gridstack@11/dist/gridstack-all.js"></script>
<style>
  :root { --bg:#07080a; --muted:#9aa1ad; --dim:#6b7280;
          --green:#34d399; --mint:#6ee7b7; --teal:#22d3ee; --blue:#60a5fa; --amber:#fbbf24; --red:#f87171; --purple:#a78bfa; --magenta:#e879f9;
          --line:rgba(255,255,255,0.07); --line2:rgba(255,255,255,0.12); }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; color: #e7e9ee; background: var(--bg); -webkit-tap-highlight-color: transparent; padding-bottom: env(safe-area-inset-bottom);
         font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-feature-settings: 'cv02','cv03','cv04','ss01'; -webkit-font-smoothing: antialiased; }
  body::before { content:''; position: fixed; inset: 0; z-index: -1; pointer-events: none; transform: translateZ(0);
         background:
           radial-gradient(1100px 560px at 78% -8%, rgba(52,211,153,0.10), transparent 58%),
           radial-gradient(900px 520px at 8% -4%, rgba(96,165,250,0.075), transparent 55%),
           radial-gradient(900px 700px at 50% 120%, rgba(167,139,250,0.06), transparent 60%); }
  .wrap { width: 100%; max-width: 2200px; margin: 0 auto; padding: 16px 16px 72px; }
  /* Opaque + its own compositing layer (translateZ) so GPU-composited card
     content (gradient text, ring drop-shadow, glow shadows) can't paint over
     the sticky header while scrolling on iOS. */
  header.top { position: sticky; top: 0; z-index: 30; background: #0b0d10;
               transform: translateZ(0); -webkit-transform: translateZ(0); will-change: transform;
               margin: -16px -16px 14px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
  @media (max-width: 760px) { .wrap { padding: 14px 10px 60px; } header.top { margin: -14px -10px 12px; padding: 12px 12px; } }
  .hrow { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #fff; display:flex; align-items:center; gap:9px; }
  .title .dot { width:9px; height:9px; border-radius:50%; background: var(--green); box-shadow:0 0 14px var(--green); animation: pulse 2.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.45; transform:scale(.82); } }
  .ctx { font-size: 12.5px; color: var(--muted); margin-top: 3px; letter-spacing:.1px; }
  .htools { display:flex; align-items:center; gap:10px; }
  .live { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; }
  .live .ld { width:7px; height:7px; border-radius:50%; background:var(--mint); box-shadow:0 0 8px var(--mint); animation: pulse 2s ease-in-out infinite; }
  .ghost { background:rgba(255,255,255,0.05); border:1px solid var(--line); color:#9aa1ad; font-size:11px; font-weight:600; font-family:inherit; padding:6px 12px; border-radius:999px; cursor:pointer; transition:all .15s; }
  .ghost:hover { color:#e7e9ee; border-color:var(--line2); }
  a.ghost { text-decoration:none; display:inline-flex; align-items:center; }
  .ghost.whoop-connect { color:#d1fae5; border-color:rgba(52,211,153,0.45); background:rgba(52,211,153,0.12); }
  .ghost.whoop-connect:hover { color:#ecfdf5; border-color:rgba(52,211,153,0.75); }
  .seg { display: inline-flex; gap:2px; background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 999px; padding: 4px; margin-top: 12px; }
  .seg button { border: 0; background: transparent; color: #8b919c; font-size: 13px; font-weight: 700; font-family: inherit; letter-spacing:.2px;
                padding: 7px 18px; border-radius: 999px; cursor: pointer; transition: all .18s; }
  .seg button:hover { color: #cbd5e1; }
  .seg button.on { color: #d1fae5; background: linear-gradient(135deg, rgba(52,211,153,0.22), rgba(34,211,238,0.20));
                   box-shadow: inset 0 0 0 1px rgba(52,211,153,0.30), 0 6px 16px -8px rgba(52,211,153,0.55); }

  /* GridStack container + widget shell */
  .grid-stack { background: transparent; }
  .grid-stack-item-content { inset: 0; overflow: hidden; }
  .card { position: relative; height: 100%; margin: 0; border-radius: 16px; padding: 16px; overflow: auto;
          display: flex; flex-direction: column;
          background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.013));
          border: 1px solid var(--line);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px -20px rgba(0,0,0,0.85);
          transition: border-color .2s ease;
          /* No inner scrollbar chrome — cards still scroll by wheel/touch if a
             desktop cell is tight, but the cheap default bar never shows. */
          scrollbar-width: none; -ms-overflow-style: none; }
  .card::-webkit-scrollbar, .sheet::-webkit-scrollbar { width: 0; height: 0; display: none; }
  @media (hover:hover) { .card:hover { border-color: var(--line2); } }
  .card h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #aeb4bf; margin: 0 0 4px;
             display:flex; align-items:center; gap:8px; cursor: move; flex:0 0 auto; }
  .card h2::before { content:''; width:6px; height:6px; border-radius:50%; background: linear-gradient(135deg, var(--green), var(--teal)); box-shadow: 0 0 8px rgba(52,211,153,0.6); flex:0 0 auto; }
  .card h2::after { content:'⠿'; margin-left:auto; color:#3a3f48; font-size:13px; letter-spacing:-1px; }
  .card .sub { font-size: 11.5px; color: #737984; margin: 0 0 12px; line-height: 1.45; flex:0 0 auto; }
  /* resize handles: subtle, appear on hover */
  .grid-stack-item > .ui-resizable-handle { opacity: 0; transition: opacity .15s; }
  .grid-stack-item:hover > .ui-resizable-handle { opacity: 0.45; }
  .grid-stack-item.ui-draggable-dragging, .grid-stack-item.ui-resizable-resizing { opacity: .95; z-index: 25; }
  .grid-stack-item.ui-draggable-dragging .card { border-color: rgba(52,211,153,0.5); box-shadow: 0 24px 60px -20px rgba(0,0,0,0.95); }
  /* Mobile / static mode: no GridStack, natural document flow so the whole page
     scrolls as one. Cards grow to their content (no fixed height, no per-card
     overflow) which kills the nested-scroll trap. */
  .static-mode .grid-stack-item { position: static !important; left:auto !important; top:auto !important; width:100% !important; height:auto !important; transform:none !important; margin:0 0 14px !important; }
  .static-mode .grid-stack-item-content { position: static !important; inset:auto !important; }
  .static-mode .card { height:auto !important; overflow:visible !important; }
  .static-mode .chartbox { flex:0 0 auto; height: 230px; min-height:0; }
  .static-mode .card h2 { cursor: default; }
  .static-mode .card h2::after { content:none; }
  @media (max-width: 768px) {
    #reset { display: none; }
    /* On iOS the cards' composited layers (gradient text, ring drop-shadow,
       glow shadows) paint over a sticky header no matter the z-index, so the
       content you scroll past ghosts at the top. Make the header scroll away
       like normal content on phones; nothing passes under it, no bleed. */
    header.top { position: static; top: auto; transform: none; -webkit-transform: none; will-change: auto; }
  }
  /* Phone polish: full-width range toggle, tighter hero so the big number never
     crowds, and slightly smaller stat values so 2x2 tile grids stay clean. */
  @media (max-width: 480px) {
    .seg { width: 100%; justify-content: space-between; margin-top: 14px; }
    .seg button { flex: 1; padding: 9px 0; text-align: center; }
    .hero { gap: 16px; }
    .hero-ring, .hero-ring svg { width: 96px; height: 96px; }
    .hero .big { font-size: 40px; letter-spacing: -1.5px; }
    .hero .big small { font-size: 16px; }
    .bpval { font-size: 34px; }
    .tile .v { font-size: 19px; }
    .title { font-size: 20px; }
  }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px,1fr)); gap: 10px; }
  /* Sleep & recovery tiles: a clean 2x2 on phones, one row of 4 on a wide card. */
  .tiles.rec { grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); }
  .tile { position:relative; border-radius:12px; padding:11px 12px; overflow:hidden;
          background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.018)); border:1px solid rgba(255,255,255,0.06); }
  .tile .v { font-size: 21px; font-weight: 800; color:#f4f6fa; line-height:1.05; letter-spacing:-0.5px; font-variant-numeric: tabular-nums; }
  .tile .v small { font-size: 11px; font-weight:600; color: var(--dim); letter-spacing:0; }
  .tile .l { font-size: 9.5px; color: var(--dim); text-transform: uppercase; letter-spacing:.7px; margin-top:5px; font-weight:600; }
  .hero { display:flex; align-items:center; gap:22px; flex-wrap:wrap; margin: 2px 0; flex:0 0 auto; }
  .hero-ring { position:relative; width:120px; height:120px; flex:0 0 auto; }
  .hero-ring svg { width:120px; height:120px; }
  .hero-ring .pc { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .hero-ring .pc b { font-size:25px; font-weight:800; color:#fff; letter-spacing:-1px; font-variant-numeric:tabular-nums; line-height:1; }
  .hero-ring .pc span { font-size:9px; color:var(--dim); text-transform:uppercase; letter-spacing:1px; margin-top:3px; }
  .hero-main { flex:1 1 220px; min-width:180px; }
  .hero .big { font-size: 50px; font-weight: 850; line-height:1; letter-spacing:-2px; font-variant-numeric: tabular-nums;
               background: linear-gradient(135deg, #ffffff 0%, #a7f3d0 130%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .hero .big small { font-size:19px; color:var(--dim); font-weight:700; -webkit-text-fill-color: var(--dim); letter-spacing:0; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  .chip { font-size:12px; font-weight:700; padding:5px 12px; border-radius:999px; letter-spacing:.2px;
          background: rgba(255,255,255,0.05); border:1px solid var(--line); color:#cbd5e1; }
  .chip.good { color: var(--mint); background: rgba(52,211,153,0.10); border-color: rgba(52,211,153,0.25); }
  .chip.warn { color: #fcd34d; background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.25); }
  .bar { height:10px; border-radius:999px; background: rgba(255,255,255,0.06); overflow:hidden; margin-top:16px; flex:0 0 auto; }
  .bar > span { display:block; height:100%; border-radius:999px; background: linear-gradient(90deg, var(--green), var(--teal));
                box-shadow: 0 0 16px rgba(52,211,153,0.5); transition: width .9s cubic-bezier(.2,.8,.2,1); }
  /* blood pressure box */
  .bpval { font-size:42px; font-weight:850; line-height:1; letter-spacing:-1.5px; font-variant-numeric:tabular-nums; margin-top:2px; }
  .bpval span { font-size:22px; color:var(--dim); font-weight:700; }
  .bplabel { font-size:11px; color:var(--dim); margin-top:8px; text-transform:uppercase; letter-spacing:.5px; }
  .prog { margin: 10px 0; }
  .prog .row { display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px; }
  .prog .row b { color:#e7e9ee; font-weight:700; text-transform:capitalize; }
  .prog .row span { color: var(--muted); font-variant-numeric: tabular-nums; }
  .pbar { height:8px; border-radius:999px; background: rgba(255,255,255,0.06); overflow:hidden; }
  .pbar > i { display:block; height:100%; border-radius:999px; transition: width .9s cubic-bezier(.2,.8,.2,1); }
  .chartbox { position: relative; flex: 1 1 auto; min-height: 120px; margin-top: 6px; }
  .note { font-size:12px; color: var(--muted); line-height:1.5; }
  .callout { border-radius:12px; padding:12px 14px; font-size:13px; line-height:1.5; }
  .callout.urgent { background: linear-gradient(180deg, rgba(248,113,113,0.12), rgba(248,113,113,0.03)); border:1px solid rgba(248,113,113,0.28); color:#fca5a5; }
  .labgrid { display:grid; grid-template-columns: repeat(auto-fill,minmax(146px,1fr)); gap:10px; }
  .lab { position:relative; border-left-width:3px; border-radius:12px; padding:10px 12px; overflow:hidden;
         background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012)); border:1px solid var(--line); }
  .lab .m { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; font-weight:600; }
  .lab .vv { font-size:17px; font-weight:800; color:#f4f6fa; font-variant-numeric:tabular-nums; margin-top:2px; }
  .lab .vv small { font-size:10px; color:var(--dim); font-weight:600; }
  .lab .d { font-size:10px; color:#5b616b; margin-top:3px; }
  .flag-magenta { border-left-color: var(--magenta); box-shadow: inset 22px 0 36px -28px rgba(232,121,249,0.9); }
  .flag-orange  { border-left-color:#fb923c; box-shadow: inset 22px 0 36px -30px rgba(251,146,60,0.8); }
  .flag-yellow  { border-left-color:#facc15; }
  .flag-green   { border-left-color: var(--green); }
  .supp { display:flex; align-items:center; gap:10px; margin:8px 0; font-size:12.5px; }
  .supp .name { width: 130px; color: var(--muted); text-transform:capitalize; flex:0 0 auto; }
  .supp .track { flex:1; height:8px; background: rgba(255,255,255,0.06); border-radius:999px; overflow:hidden; }
  .supp .track > i { display:block; height:100%; background: linear-gradient(90deg, var(--green), var(--mint)); border-radius:999px; transition: width .9s cubic-bezier(.2,.8,.2,1); }
  .supp .pc { width:44px; text-align:right; color:#e7e9ee; font-weight:700; font-variant-numeric:tabular-nums; }
  .loading { text-align:center; color: var(--dim); padding: 56px 0; font-size:13px; }
  .err { color: var(--red); font-size:13px; }
  .updated { text-align:center; color:#4b515b; font-size:11px; margin-top:22px; letter-spacing:.2px; }
  /* Arrange-panels sheet */
  .sheet-overlay { position:fixed; inset:0; z-index:50; background:rgba(0,0,0,0.62); display:flex; align-items:flex-end; justify-content:center; }
  @media (min-width:768px){ .sheet-overlay { align-items:center; } }
  .sheet { width:100%; max-width:460px; max-height:82vh; overflow:auto; padding:18px 18px calc(18px + env(safe-area-inset-bottom));
           background:#0e1116; border:1px solid var(--line2); border-radius:18px 18px 0 0; box-shadow:0 -12px 44px rgba(0,0,0,0.6); }
  @media (min-width:768px){ .sheet { border-radius:18px; } }
  .sheet-h { display:flex; justify-content:space-between; align-items:center; }
  .sheet-h b { font-size:15px; color:#fff; }
  .sheet-sub { font-size:12px; color:var(--dim); margin:4px 0 14px; line-height:1.45; }
  .srow { display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid var(--line); border-radius:12px; margin-bottom:8px; background:rgba(255,255,255,0.03); }
  .srow.off { opacity:0.45; }
  .srow .nm { flex:1; font-size:13px; font-weight:600; color:#e7e9ee; }
  .srow .mv { display:flex; gap:4px; }
  .srow button { min-width:32px; height:32px; border-radius:8px; border:1px solid var(--line); background:rgba(255,255,255,0.05); color:#cbd5e1; font-size:12px; font-family:inherit; cursor:pointer; }
  .srow button:hover:not(:disabled) { border-color:var(--line2); color:#fff; }
  .srow button:disabled { opacity:0.3; cursor:default; }
  .srow .eye { padding:0 12px; font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="hrow">
      <div>
        <div class="title"><span class="dot"></span>Health OS</div>
        <div class="ctx" id="ctx">loading…</div>
      </div>
      <div class="htools">
        <a class="ghost whoop-connect" id="whoopconnect" href="/whoop/connect?token=${encodeURIComponent(token)}" style="display:none" title="Authorize WHOOP so recovery, HRV, resting HR and sleep sync automatically">⌚ Connect WHOOP</a>
        <span class="live" id="live"><span class="ld"></span>live</span>
        <button class="ghost" id="settings" title="Arrange panels">☰ arrange</button>
        <button class="ghost" id="reset" title="Reset the layout to default">reset layout</button>
      </div>
    </div>
    <div class="seg" id="seg">
      <button data-r="7">7d</button>
      <button data-r="30">30d</button>
      <button data-r="90">90d</button>
    </div>
  </header>
  <div class="grid-stack" id="grid"><div class="loading">Pulling your numbers…</div></div>
  <div class="updated" id="updated"></div>
</div>
<div id="sheet" class="sheet-overlay" style="display:none">
  <div class="sheet">
    <div class="sheet-h"><b>Arrange panels</b><button class="ghost" id="sheetClose">done</button></div>
    <div class="sheet-sub">Reorder for the phone view, and show or hide any panel. Drag to rearrange on desktop.</div>
    <div id="sheetList"></div>
    <button class="ghost" id="sheetReset" style="margin-top:12px">reset to default order</button>
  </div>
</div>

<script>
"use strict";
var TOKEN = ${tokenJson};
var RANGE = ${rangeJson};
var charts = {};
var lastData = null;
var GRID = null;
var STATIC_BUILT = false;
var LSKEY = 'hdb-layout-v4';

var AX = { grid: 'rgba(255,255,255,0.05)', ticks: '#6b7280' };
var COL = { green:'#34d399', mint:'#6ee7b7', teal:'#22d3ee', blue:'#60a5fa', amber:'#fbbf24', red:'#f87171', purple:'#a78bfa', slate:'#94a3b8' };

Chart.defaults.color = '#7c828c';
Chart.defaults.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.boxHeight = 8;
Chart.defaults.plugins.legend.labels.color = '#9aa1ad';
Chart.defaults.plugins.legend.labels.padding = 12;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(12,14,18,0.96)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.10)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = '#e7e9ee';
Chart.defaults.plugins.tooltip.bodyColor = '#cbd5e1';
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 10;
Chart.defaults.plugins.tooltip.usePointStyle = true;
Chart.defaults.plugins.tooltip.boxPadding = 6;
// Tooltips/hover fire anywhere along the x-axis, not only when the cursor is
// exactly on a (pointRadius:0) data point. Doughnut overrides this back to nearest.
Chart.defaults.interaction.mode = 'index';
Chart.defaults.interaction.intersect = false;
Chart.defaults.plugins.tooltip.mode = 'index';
Chart.defaults.plugins.tooltip.intersect = false;

function $(id){ return document.getElementById(id); }
function n(v, suf){ if(v===null||v===undefined||v==='') return '—'; return (suf? v+suf : ''+v); }
function shortDate(s){ var p = (s||'').split('-'); if(p.length<3) return s; return p[1]+'-'+p[2]; }
function api(range){
  return fetch(location.origin + '/api/healthdb?range=' + range + '&token=' + encodeURIComponent(TOKEN) + '&_=' + Date.now(), { cache:'no-store' })
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
}

function chart(id, cfg){
  var c = $(id); if(!c) return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(c, cfg);
}
function resizeCharts(){ for(var k in charts){ try{ charts[k].resize(); }catch(e){} } }
function baseScales(extra){
  var s = {
    x: { grid: { color: AX.grid, drawTicks:false }, ticks: { color: AX.ticks, maxRotation:0, autoSkip:true, maxTicksLimit:7, padding:6 }, border:{display:false} },
    y: { grid: { color: AX.grid, drawTicks:false }, ticks: { color: AX.ticks, maxTicksLimit:6, padding:6 }, border:{display:false}, beginAtZero:true }
  };
  if(extra) for(var k in extra) s[k] = extra[k];
  return s;
}
function legendTop(){ return { legend:{ display:true, position:'top', align:'end' } }; }
function noLegend(){ return { legend:{display:false}, tooltip:{enabled:true} }; }
function hexA(hex, a){
  var b = hex.replace('#',''); var r=parseInt(b.substr(0,2),16), g=parseInt(b.substr(2,2),16), bl=parseInt(b.substr(4,2),16);
  return 'rgba('+r+','+g+','+bl+','+a+')';
}
function areaGrad(hex){
  return function(ctx){
    var ch = ctx.chart, a = ch.chartArea; if(!a) return hexA(hex, 0.15);
    var g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, hexA(hex, 0.42)); g.addColorStop(0.65, hexA(hex, 0.06)); g.addColorStop(1, hexA(hex, 0));
    return g;
  };
}
function barGrad(hex){
  return function(ctx){
    var ch = ctx.chart, a = ch.chartArea; if(!a) return hexA(hex, 0.7);
    var g = ch.ctx.createLinearGradient(0, a.bottom, 0, a.top);
    g.addColorStop(0, hexA(hex, 0.22)); g.addColorStop(1, hexA(hex, 0.92));
    return g;
  };
}

// ---- panel builders --------------------------------------------------------
function tile(v, label){ return '<div class="tile"><div class="v">'+v+'</div><div class="l">'+label+'</div></div>'; }
function metricLabel(m){ return (m||'').replace(/_/g,' '); }
function fmtSleep(h){ if(h===null||h===undefined||h==='') return '—'; var hh=Math.floor(h), mm=Math.round((h-hh)*60); if(mm===60){hh+=1;mm=0;} return hh+'h '+(mm<10?'0':'')+mm+'<small>m</small>'; }

function renderHeader(d){
  var bits = [];
  if(d.dayN) bits.push('Day '+d.dayN);
  if(d.city) bits.push(d.city + (d.environment? ' · '+d.environment.replace(/_/g,' ') : ''));
  if(d.privateChef && (d.environment||'').indexOf('chef') === -1) bits.push('private chef');
  bits.push(d.range + '-day view');
  $('ctx').textContent = bits.join('  ·  ');
  var btns = $('seg').querySelectorAll('button');
  for(var i=0;i<btns.length;i++){ btns[i].className = (parseInt(btns[i].getAttribute('data-r'),10)===d.range)?'on':''; }
}

function ringSvg(pct){
  var p = Math.max(0, Math.min(100, pct || 0));
  var R = 50, C = 2 * Math.PI * R, off = C * (1 - p / 100);
  return '<svg viewBox="0 0 120 120">'
    + '<defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">'
    +   '<stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>'
    + '<circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="10"/>'
    + '<circle cx="60" cy="60" r="50" fill="none" stroke="url(#ringg)" stroke-width="10" stroke-linecap="round"'
    +   ' stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 60 60)"'
    +   ' style="filter:drop-shadow(0 0 6px rgba(52,211,153,0.55)); transition: stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)"/>'
    + '</svg>';
}

function cardWeight(d){
  var w = d.weight;
  var pct = w.pctToGoal!==null ? w.pctToGoal : 0;
  var rate = w.ratePerWeek!==null ? (w.ratePerWeek>0?'▼ ':'▲ ') + Math.abs(w.ratePerWeek) + ' kg/wk' : '—';
  var proj = w.projectedTargetDate ? 'target ~' + w.projectedTargetDate : 'need more weigh-ins';
  return '<div class="card">'
    + '<h2>Weight · the north star</h2>'
    + '<div class="sub">baseline '+n(w.baselineKg,' kg')+' ('+w.baselineAt+') → target '+n(w.targetKg,' kg')+'</div>'
    + '<div class="hero">'
    +   '<div class="hero-ring">'+ringSvg(pct)+'<div class="pc"><b>'+n(pct)+'%</b><span>to goal</span></div></div>'
    +   '<div class="hero-main">'
    +     '<div class="big">'+n(w.latestKg)+'<small> kg</small></div>'
    +     '<div class="chips">'
    +       '<span class="chip good">▼ '+n(w.lostKg,' kg')+' lost</span>'
    +       '<span class="chip warn">'+n(w.toGoKg,' kg')+' to go</span>'
    +       '<span class="chip">'+rate+'</span>'
    +       '<span class="chip">'+proj+'</span>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '<div class="bar"><span style="width:'+Math.max(0,Math.min(100,pct))+'%"></span></div>'
    + '<div class="chartbox"><canvas id="cWeight"></canvas></div>'
    + '</div>';
}

function cardBP(d){
  var L = d.vitals.latest;
  var body;
  if(L && L.systolic!=null){
    var s = L.systolic, di = L.diastolic;
    var col = s<=120 ? 'var(--mint)' : (s<=135 ? 'var(--amber)' : 'var(--red)');
    var status = s<=120 ? 'in range' : (s<=135 ? 'elevated' : 'high');
    body = '<div class="bpval" style="color:'+col+'">'+s+'<span>/'+(di!=null?di:'—')+'</span></div>'
      + '<div class="bplabel">mmHg · '+status+' · target ≤120</div>'
      + (L.at? '<div class="sub" style="margin:8px 0 0">last reading '+L.at+'</div>':'');
  } else {
    body = '<div class="callout urgent" style="margin-top:6px">Not measured yet. Blood pressure is often the key missing data point. Log a reading.</div>';
  }
  return '<div class="card"><h2>Blood pressure</h2><div class="sub">your central number</div>'+body+'</div>';
}

function cardNutStats(d){
  var nu = d.nutrition;
  return '<div class="card"><h2>Nutrition</h2>'
    + '<div class="sub">'+nu.totalMeals+' meals logged · protein protects muscle while you cut</div>'
    + '<div class="tiles">'
    +   tile(n(nu.avgCalories), 'avg kcal/day')
    +   tile(n(nu.avgProtein)+'<small> /150-190</small>', 'avg protein g')
    +   tile(n(nu.avgCarbs), 'avg carbs g')
    +   tile(n(nu.avgFat), 'avg fat g')
    +   tile(n(nu.pctDaysProteinHit,'%'), 'days hit protein')
    +   tile(nu.daysLogged+'<small> /'+d.range+'</small>', 'days logged')
    + '</div></div>';
}
function cardCalories(){ return '<div class="card"><h2>Calories / day</h2><div class="sub">daily intake</div><div class="chartbox"><canvas id="cCal"></canvas></div></div>'; }
function cardProtein(){ return '<div class="card"><h2>Protein / day</h2><div class="sub">band = 150 to 190 g</div><div class="chartbox"><canvas id="cPro"></canvas></div></div>'; }
function cardMacro(){ return '<div class="card"><h2>Macro split</h2><div class="sub">by calories</div><div class="chartbox"><canvas id="cMacro"></canvas></div></div>'; }
function cardCarbsFat(){ return '<div class="card"><h2>Carbs vs fat</h2><div class="sub">daily grams</div><div class="chartbox"><canvas id="cCF"></canvas></div></div>'; }

function cardFlags(d){
  var f = d.flags;
  return '<div class="card">'
    + '<h2>Risk flags</h2><div class="sub">days flagged from your profile: saturated fat, sodium, sugar</div>'
    + '<div class="tiles">'
    +   tile(f.satFatDays+'<small> d</small>', 'sat-fat days')
    +   tile(f.sodiumDays+'<small> d</small>', 'sodium days')
    +   tile(f.sugarDays+'<small> d</small>', 'sugar days')
    + '</div>'
    + '<div class="chartbox" style="margin-top:12px"><canvas id="cFlags"></canvas></div>'
    + '</div>';
}
function cardCaffeine(d){
  var c = d.caffeine;
  return '<div class="card">'
    + '<h2>Caffeine</h2><div class="sub">daily caffeine vs your ceiling ~'+c.ceiling+' mg</div>'
    + '<div class="tiles">'
    +   tile(n(c.avgMgPerDay)+'<small> mg</small>', 'avg / day')
    +   tile(c.daysOverCeiling+'<small> d</small>', 'over ceiling')
    + '</div>'
    + '<div class="chartbox" style="margin-top:12px"><canvas id="cCaf"></canvas></div>'
    + '</div>';
}
function cardBody(d){
  var b = d.bodyComp;
  return '<div class="card">'
    + '<h2>Body composition</h2><div class="sub">keep the muscle, lose the fat'+(b.measuredAt?' · InBody '+b.measuredAt:'')+'</div>'
    + '<div class="tiles">'
    +   tile(n(b.latestBodyFatPct,'%'), 'body fat')
    +   tile(n(b.skeletalMuscleKg,' kg'), 'skeletal muscle')
    +   tile(n(b.visceralLevel), 'visceral level')
    +   tile(n(b.trunkFatKg,' kg'), 'trunk fat')
    +   tile(n(b.waistCm,' cm'), 'waist')
    + '</div>'
    + (b.skeletalMuscleKg===null ? '<div class="note" style="margin-top:10px">Log a tape measurement or a fresh InBody to trend body comp.</div>' : '')
    + '</div>';
}
function cardTraining(d){
  var tr = d.training;
  var types = Object.keys(tr.byType||{}).sort(function(a,b){ return tr.byType[b]-tr.byType[a]; });
  var rows = '', max = 1, i;
  for(i=0;i<types.length;i++) max = Math.max(max, tr.byType[types[i]]);
  for(i=0;i<types.length;i++){
    var k = types[i], c = tr.byType[k];
    rows += '<div class="supp"><div class="name">'+k+'</div><div class="track"><i style="width:'+Math.round(c/max*100)+'%;background:'+COL.purple+'"></i></div><div class="pc">'+c+'</div></div>';
  }
  return '<div class="card">'
    + '<h2>Training</h2><div class="sub">resistance is ~99% of the work</div>'
    + '<div class="tiles">'
    +   tile(tr.sessions, 'sessions')
    +   tile(n(tr.perWeek)+'<small> /wk</small>', 'frequency')
    +   tile(n(tr.totalMinutes)+'<small> min</small>', 'total time')
    +   tile(n(tr.avgRpe), 'avg RPE')
    + '</div>'
    + (rows? '<div style="margin-top:12px">'+rows+'</div>' : '')
    + '</div>';
}
function cardVitals(d){
  var v = d.vitals;
  var inner = v.hasBP
    ? '<div class="chartbox"><canvas id="cBP"></canvas></div>'
    : '<div class="callout urgent">Blood pressure trend needs at least a couple of readings. Log them and the chart fills in here.</div>';
  var extra = (v.sleep && v.sleep.length) ? '<div class="sub" style="margin-top:10px">Sleep logged '+v.sleep.length+' nights in range</div>' : '';
  return '<div class="card"><h2>BP trend</h2><div class="sub">target systolic ≤120</div>'+inner+extra+'</div>';
}
function cardRecovery(d){
  var r = d.recovery || {};
  if(!r.hasData){
    return '<div class="card">'
      + '<h2>Sleep &amp; recovery</h2><div class="sub">WHOOP · recovery, HRV, resting HR, sleep</div>'
      + '<div class="callout urgent" style="margin-top:6px">No sleep or recovery logged yet. Tell the coach your WHOOP numbers (recovery %, HRV, resting HR, hours slept) and they fill in here.</div>'
      + '</div>';
  }
  // WHOOP recovery banding: green ≥67, yellow 34-66, red <34.
  function rcol(v){ if(v===null||v===undefined) return '#f4f6fa'; return v>=67?'var(--mint)':(v>=34?'var(--amber)':'var(--red)'); }
  var rv = r.latestRecovery;
  var sub = 'WHOOP · recovery, HRV, resting HR, sleep'
    + (r.nights ? ' · ' + r.nights + (r.nights===1?' night':' nights') : '')
    + (r.avgRecovery!==null ? ' · avg recovery '+r.avgRecovery+'%' : '');
  return '<div class="card">'
    + '<h2>Sleep &amp; recovery</h2><div class="sub">'+sub+'</div>'
    + '<div class="tiles rec">'
    +   '<div class="tile"><div class="v" style="color:'+rcol(rv)+'">'+n(rv,'%')+'</div><div class="l">recovery</div></div>'
    +   tile(n(r.latestHrv)+'<small> ms</small>', 'HRV')
    +   tile(n(r.latestRhr)+'<small> bpm</small>', 'resting HR')
    +   tile(fmtSleep(r.latestSleep), 'last sleep')
    + '</div>'
    + '<div class="chartbox" style="margin-top:14px"><canvas id="cRecovery"></canvas></div>'
    + '</div>';
}
function cardCheckins(d){
  var c = d.checkins;
  return '<div class="card">'
    + '<h2>Energy &amp; mood</h2><div class="sub">how the day actually felt, your subjective read</div>'
    + '<div class="tiles">'
    +   tile(n(c.avgEnergy)+'<small> /10</small>', 'avg energy')
    +   tile(n(c.avgSleep,' h'), 'logged sleep')
    + '</div>'
    + '<div class="chartbox" style="margin-top:12px"><canvas id="cCheck"></canvas></div>'
    + '</div>';
}
function cardSupplements(d){
  var s = d.supplements, rows = '';
  for(var i=0;i<s.bySupplement.length;i++){
    var x = s.bySupplement[i];
    rows += '<div class="supp"><div class="name">'+x.name.replace(/_/g,' ')+'</div><div class="track"><i style="width:'+(x.pct||0)+'%"></i></div><div class="pc">'+n(x.pct,'%')+'</div></div>';
  }
  return '<div class="card">'
    + '<h2>Supplements</h2><div class="sub">'+n(s.adherencePct,'%')+' overall adherence · '+s.taken+'/'+s.total+' doses</div>'
    + (rows || '<div class="note">No supplement doses logged in this range.</div>')
    + '</div>';
}
function cardGoals(d){
  var rows = '', palette = [COL.green, COL.blue, COL.amber, COL.purple, COL.red, COL.slate];
  for(var i=0;i<d.goals.length;i++){
    var g = d.goals[i];
    var pct = g.pct!==null ? g.pct : 0;
    var col = palette[i % palette.length];
    var cur = g.current!==null ? g.current : '—';
    var tgt = g.target!==null ? g.target : '—';
    rows += '<div class="prog"><div class="row"><b>'+metricLabel(g.metric)+'</b><span>'+cur+' → '+tgt+'</span></div>'
      + '<div class="pbar"><i style="width:'+pct+'%;background:'+col+'"></i></div></div>';
  }
  return '<div class="card"><h2>Goals</h2><div class="sub">progress from baseline toward target</div>'+rows+'</div>';
}
function cardLabs(d){
  var order = { magenta:0, orange:1, yellow:2, green:3 };
  var ms = d.labs.markers.slice().sort(function(a,b){ return (order[a.flag]===undefined?9:order[a.flag]) - (order[b.flag]===undefined?9:order[b.flag]); });
  var cells = '';
  for(var i=0;i<ms.length;i++){
    var m = ms[i], fc = 'flag-' + (m.flag||'green');
    cells += '<div class="lab '+fc+'"><div class="m">'+metricLabel(m.marker)+'</div>'
      + '<div class="vv">'+n(m.value)+' <small>'+n(m.unit==null?'':m.unit)+'</small></div>'
      + '<div class="d">'+(m.draws>1? m.draws+' draws · ':'')+'as of '+n(m.drawnAt)+'</div></div>';
  }
  return '<div class="card"><h2>Labs</h2><div class="sub">latest per marker · magenta = alarm, then orange, yellow, green</div>'
    + '<div class="labgrid">'+cells+'</div></div>';
}

// ---- widget registry + default layout (12-col grid) ------------------------
var WIDGETS = [
  { id:'weight',      name:'Weight',          x:0,  y:0,  w:8, h:6, fn:cardWeight },
  { id:'bp',          name:'Blood pressure',  x:8,  y:0,  w:4, h:3, fn:cardBP },
  { id:'caffeine',    name:'Caffeine',        x:8,  y:3,  w:4, h:4, fn:cardCaffeine },
  { id:'recovery',    name:'Sleep & recovery',x:0,  y:7,  w:12,h:5, fn:cardRecovery },
  { id:'nutstats',    name:'Nutrition stats', x:0,  y:12, w:12,h:2, fn:cardNutStats },
  { id:'calories',    name:'Calories',        x:0,  y:14, w:3, h:4, fn:cardCalories },
  { id:'protein',     name:'Protein',         x:3,  y:14, w:3, h:4, fn:cardProtein },
  { id:'macro',       name:'Macro split',     x:6,  y:14, w:3, h:4, fn:cardMacro },
  { id:'carbsfat',    name:'Carbs vs fat',    x:9,  y:14, w:3, h:4, fn:cardCarbsFat },
  { id:'flags',       name:'Risk flags',      x:0,  y:18, w:4, h:5, fn:cardFlags },
  { id:'training',    name:'Training',        x:4,  y:18, w:4, h:5, fn:cardTraining },
  { id:'body',        name:'Body composition',x:8,  y:18, w:4, h:4, fn:cardBody },
  { id:'checkins',    name:'Energy & mood',   x:0,  y:23, w:4, h:5, fn:cardCheckins },
  { id:'vitals',      name:'BP trend',        x:4,  y:23, w:4, h:5, fn:cardVitals },
  { id:'supplements', name:'Supplements',     x:8,  y:23, w:4, h:6, fn:cardSupplements },
  { id:'goals',       name:'Goals',           x:0,  y:29, w:5, h:5, fn:cardGoals },
  { id:'labs',        name:'Labs',            x:5,  y:29, w:7, h:6, fn:cardLabs }
];

// ---- panel order + visibility (the "arrange panels" sheet) -----------------
var OKEY = 'hdb-order-v2', HKEY = 'hdb-hidden-v1';
function fullOrder(){
  var saved = null; try { saved = JSON.parse(localStorage.getItem(OKEY) || 'null'); } catch(e){}
  var byId = {}; WIDGETS.forEach(function(w){ byId[w.id] = w; });
  var out = [], used = {};
  if(Array.isArray(saved)) saved.forEach(function(id){ if(byId[id] && !used[id]){ out.push(byId[id]); used[id] = 1; } });
  WIDGETS.forEach(function(w){ if(!used[w.id]) out.push(w); });
  return out;
}
function hiddenSet(){ var h = {}; try { (JSON.parse(localStorage.getItem(HKEY) || '[]') || []).forEach(function(id){ h[id] = 1; }); } catch(e){} return h; }
function widgetOrder(){ var h = hiddenSet(); return fullOrder().filter(function(w){ return !h[w.id]; }); }

var sheetWork = [];
function renderSheet(){
  var html = '';
  for(var i=0;i<sheetWork.length;i++){
    var r = sheetWork[i];
    html += '<div class="srow'+(r.hidden?' off':'')+'" data-i="'+i+'">'
      + '<div class="mv"><button data-act="up"'+(i===0?' disabled':'')+'>▲</button><button data-act="down"'+(i===sheetWork.length-1?' disabled':'')+'>▼</button></div>'
      + '<div class="nm">'+r.name+'</div>'
      + '<button class="eye" data-act="toggle">'+(r.hidden?'show':'hide')+'</button></div>';
  }
  $('sheetList').innerHTML = html;
}
function openSettings(){
  var h = hiddenSet();
  sheetWork = fullOrder().map(function(w){ return { id:w.id, name:w.name, hidden: !!h[w.id] }; });
  renderSheet();
  $('sheet').style.display = 'flex';
}
function applySettings(){
  try {
    localStorage.setItem(OKEY, JSON.stringify(sheetWork.map(function(r){ return r.id; })));
    localStorage.setItem(HKEY, JSON.stringify(sheetWork.filter(function(r){ return r.hidden; }).map(function(r){ return r.id; })));
  } catch(e){}
  location.reload();
}

// ---- charts ----------------------------------------------------------------
function drawCharts(d){
  var labels = d.nutrition.daily.map(function(x){ return shortDate(x.date); });
  var ws = d.weight.series;
  chart('cWeight', { type:'line',
    data:{ labels: ws.map(function(p){return shortDate(p.date);}), datasets:[
      { label:'kg', data: ws.map(function(p){return p.kg;}), borderColor:COL.mint, backgroundColor:areaGrad('#6ee7b7'), fill:true, tension:0.4, spanGaps:true, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:COL.mint, pointBorderColor:'#0b0d10', pointBorderWidth:2, borderWidth:2.5 },
      { label:'target', data: ws.map(function(){return d.weight.targetKg;}), borderColor:hexA('#f87171',0.55), borderDash:[6,6], pointRadius:0, borderWidth:1.5, fill:false } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:noLegend(), scales: baseScales({ y:{ grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:6,padding:6}, border:{display:false}, beginAtZero:false } }) } });

  chart('cCal', { type:'bar',
    data:{ labels: labels, datasets:[{ data: d.nutrition.daily.map(function(x){return x.calories;}), backgroundColor: barGrad('#60a5fa'), hoverBackgroundColor: hexA('#60a5fa',0.95), borderRadius:6, borderSkipped:false, maxBarThickness:40 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:noLegend(), scales: baseScales() } });

  chart('cPro', { type:'line',
    data:{ labels: labels, datasets:[
      { label:'protein', data: d.nutrition.daily.map(function(x){return x.protein;}), borderColor:COL.mint, backgroundColor:areaGrad('#6ee7b7'), fill:true, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5 },
      { label:'lo', data: labels.map(function(){return d.nutrition.proteinTargetLow;}), borderColor:hexA('#fbbf24',0.45), borderDash:[5,5], pointRadius:0, borderWidth:1, fill:false },
      { label:'hi', data: labels.map(function(){return d.nutrition.proteinTargetHigh;}), borderColor:hexA('#fbbf24',0.45), borderDash:[5,5], pointRadius:0, borderWidth:1, fill:false } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:noLegend(), scales: baseScales() } });

  var ms = d.nutrition.macroSplit;
  chart('cMacro', { type:'doughnut',
    data:{ labels:['protein','carbs','fat'], datasets:[{ data:[ms.proteinPct||0, ms.carbsPct||0, ms.fatPct||0], backgroundColor:[COL.mint, COL.blue, COL.amber], borderColor:'#0e1014', borderWidth:3, hoverOffset:6, spacing:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'66%', interaction:{ mode:'nearest', intersect:true }, plugins:{ legend:{ position:'bottom' }, tooltip:{ mode:'nearest', intersect:true, callbacks:{ label:function(c){ return c.label+': '+c.parsed+'%'; } } } } } });

  chart('cCF', { type:'line',
    data:{ labels: labels, datasets:[
      { label:'carbs', data: d.nutrition.daily.map(function(x){return x.carbs;}), borderColor:COL.blue, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5, fill:false },
      { label:'fat', data: d.nutrition.daily.map(function(x){return x.fat;}), borderColor:COL.amber, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5, fill:false } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:legendTop(), scales: baseScales() } });

  chart('cFlags', { type:'bar',
    data:{ labels: d.flags.daily.map(function(x){return shortDate(x.date);}), datasets:[
      { label:'sat-fat', data: d.flags.daily.map(function(x){return x.sat;}), backgroundColor:hexA('#f87171',0.9), borderRadius:4, borderSkipped:false, maxBarThickness:26 },
      { label:'sodium', data: d.flags.daily.map(function(x){return x.sodium;}), backgroundColor:hexA('#fbbf24',0.9), borderRadius:4, borderSkipped:false, maxBarThickness:26 },
      { label:'sugar', data: d.flags.daily.map(function(x){return x.sugar;}), backgroundColor:hexA('#a78bfa',0.9), borderRadius:4, borderSkipped:false, maxBarThickness:26 } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:legendTop(), scales: baseScales({ x:{ stacked:true, grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:7,autoSkip:true,padding:6}, border:{display:false} }, y:{ stacked:true, grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,precision:0,maxTicksLimit:6,padding:6}, border:{display:false}, beginAtZero:true } }) } });

  chart('cCaf', { type:'line',
    data:{ labels: d.caffeine.daily.map(function(x){return shortDate(x.date);}), datasets:[
      { label:'mg', data: d.caffeine.daily.map(function(x){return x.mg;}), borderColor:COL.amber, backgroundColor:areaGrad('#fbbf24'), fill:true, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5 },
      { label:'ceiling', data: d.caffeine.daily.map(function(){return d.caffeine.ceiling;}), borderColor:hexA('#f87171',0.6), borderDash:[6,6], pointRadius:0, borderWidth:1.5, fill:false } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:noLegend(), scales: baseScales() } });

  if(d.vitals.hasBP){
    chart('cBP', { type:'line',
      data:{ labels: d.vitals.bp.map(function(x){return shortDate(x.date);}), datasets:[
        { label:'systolic', data: d.vitals.bp.map(function(x){return x.systolic;}), borderColor:COL.red, tension:0.4, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:COL.red, pointBorderColor:'#0b0d10', pointBorderWidth:2, borderWidth:2.5, spanGaps:true, fill:false },
        { label:'diastolic', data: d.vitals.bp.map(function(x){return x.diastolic;}), borderColor:COL.blue, tension:0.4, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:COL.blue, pointBorderColor:'#0b0d10', pointBorderWidth:2, borderWidth:2.5, spanGaps:true, fill:false } ]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:legendTop(), scales: baseScales({ y:{ grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:6,padding:6}, border:{display:false}, beginAtZero:false } }) } });
  }

  if(d.recovery && d.recovery.hasData){
    chart('cRecovery', { type:'line',
      data:{ labels: d.recovery.daily.map(function(x){return shortDate(x.date);}), datasets:[
        { label:'recovery %', data: d.recovery.daily.map(function(x){return x.recovery;}), borderColor:COL.mint, backgroundColor:areaGrad('#6ee7b7'), fill:true, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5, spanGaps:true, yAxisID:'y' },
        { label:'sleep h', data: d.recovery.daily.map(function(x){return x.sleep;}), borderColor:COL.blue, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5, spanGaps:true, yAxisID:'y1' } ]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:legendTop(),
        scales:{ x:{ grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:7,autoSkip:true,padding:6}, border:{display:false} },
                 y:{ position:'left', grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:6,padding:6,callback:function(v){return v+'%';}}, border:{display:false}, beginAtZero:true, suggestedMax:100 },
                 y1:{ position:'right', grid:{display:false}, ticks:{color:AX.ticks,maxTicksLimit:6,padding:6}, border:{display:false}, beginAtZero:true, suggestedMax:12 } } } });
  }

  chart('cCheck', { type:'line',
    data:{ labels: d.checkins.daily.map(function(x){return shortDate(x.date);}), datasets:[
      { label:'energy', data: d.checkins.daily.map(function(x){return x.energy;}), borderColor:COL.mint, backgroundColor:areaGrad('#6ee7b7'), fill:true, tension:0.4, pointRadius:0, pointHoverRadius:5, borderWidth:2.5, spanGaps:true } ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:noLegend(),
      scales: baseScales({ y:{ grid:{color:AX.grid,drawTicks:false}, ticks:{color:AX.ticks,maxTicksLimit:6,padding:6}, border:{display:false}, beginAtZero:true, suggestedMax:10 } }) } });
}

// ---- layout persistence (desktop only) -------------------------------------
function isDesktop(){ return window.innerWidth >= 768; }
function saveLayout(){ if(!GRID || !isDesktop()) return; try{ localStorage.setItem(LSKEY, JSON.stringify(GRID.save(false))); }catch(e){} }
function applySaved(){
  if(!GRID || !isDesktop()) return;
  var raw; try{ raw = localStorage.getItem(LSKEY); }catch(e){ return; }
  if(!raw) return;
  var saved; try{ saved = JSON.parse(raw); }catch(e){ return; }
  if(!Array.isArray(saved)) return;
  GRID.batchUpdate();
  saved.forEach(function(nd){
    if(!nd || !nd.id) return;
    var el = document.querySelector('.grid-stack-item[gs-id="'+nd.id+'"]');
    if(el) GRID.update(el, { x:nd.x, y:nd.y, w:nd.w, h:nd.h });
  });
  GRID.commit();
}

// ---- orchestration ---------------------------------------------------------
function widgetHtml(wd, d){
  return '<div class="grid-stack-item" gs-id="'+wd.id+'" gs-x="'+wd.x+'" gs-y="'+wd.y+'" gs-w="'+wd.w+'" gs-h="'+wd.h+'">'
    + '<div class="grid-stack-item-content">'+wd.fn(d)+'</div></div>';
}
function fallbackRender(d){
  // GridStack failed to load: stack the cards so the dashboard still works.
  var g = $('grid'); g.className = '';
  g.style.display = 'grid';
  g.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(360px,100%), 1fr))';
  g.style.gap = '14px';
  g.innerHTML = widgetOrder().map(function(wd){ return '<div style="min-height:160px">'+wd.fn(d)+'</div>'; }).join('');
  drawCharts(d);
}
function buildGrid(d){
  var g = $('grid');
  g.innerHTML = widgetOrder().map(function(wd){ return widgetHtml(wd, d); }).join('');
  try {
    GRID = GridStack.init({
      column: 12, cellHeight: 76, margin: 7, float: true,
      handle: '.card h2',
      resizable: { handles: 'e, se, s, sw, w' },
      columnOpts: { breakpointForWindow: true, breakpoints: [{ w: 768, c: 1 }] }
    }, '#grid');
  } catch(e){ GRID = null; fallbackRender(d); return; }
  applySaved();
  GRID.on('change', saveLayout);
  GRID.on('resizestop dragstop', function(){ resizeCharts(); saveLayout(); });
  drawCharts(d);
  // Calm subsequent (auto-refresh / range) repaints: no chart animation.
  Chart.defaults.animation = false;
}
function isMobileView(){ return window.innerWidth < 768; }
function buildStatic(d){
  // Mobile: plain stacked cards, natural heights, normal page scroll. No
  // GridStack (its fixed-height + overflow widgets trap scrolling on touch).
  var g = $('grid');
  g.classList.add('static-mode');
  g.innerHTML = widgetOrder().map(function(wd){ return widgetHtml(wd, d); }).join('');
  drawCharts(d);
  STATIC_BUILT = true;
  Chart.defaults.animation = false;
}
function fillContents(d){
  for(var i=0;i<WIDGETS.length;i++){
    var wd = WIDGETS[i];
    var el = document.querySelector('.grid-stack-item[gs-id="'+wd.id+'"] > .grid-stack-item-content');
    if(el) el.innerHTML = wd.fn(d);
  }
  drawCharts(d);
}
function paint(d){
  renderHeader(d);
  // Surface the "Connect WHOOP" button only until recovery data starts flowing.
  var wc = $('whoopconnect');
  if(wc) wc.style.display = (d.recovery && !d.recovery.hasData) ? 'inline-flex' : 'none';
  var when = new Date(d.generatedAt);
  $('updated').textContent = 'Updated ' + when.toLocaleTimeString() + ' · live from Supabase · ' + d.timezone;
}
function render(d){
  lastData = d;
  paint(d);
  if(typeof GridStack === 'undefined'){ fallbackRender(d); return; }
  if(isMobileView()){
    if(!STATIC_BUILT) buildStatic(d); else fillContents(d);
  } else {
    if(!GRID) buildGrid(d); else fillContents(d);
  }
}

function load(range){
  RANGE = range;
  // Cookie (server reads it for the default on next load) survives in-app
  // browsers where localStorage is dropped.
  try{ document.cookie = 'hdbrange=' + range + '; path=/; max-age=31536000; samesite=lax'; }catch(e){}
  // Only show the loading placeholder on the very first load. Once the grid or
  // the static stack is built, a range switch updates contents in place (wiping
  // here would delete the widgets that render()/fillContents needs to update).
  if(!GRID && !STATIC_BUILT){ $('grid').innerHTML = '<div class="loading">Pulling your numbers…</div>'; }
  api(range).then(render).catch(function(e){
    if(!GRID && !STATIC_BUILT) $('grid').innerHTML = '<div class="card err" style="height:auto">Could not load health data: ' + e.message + '</div>';
  });
}
function refresh(){ if(document.hidden || !lastData) return; api(RANGE).then(render).catch(function(){}); }

$('seg').addEventListener('click', function(ev){
  var b = ev.target.closest('button'); if(!b) return;
  load(parseInt(b.getAttribute('data-r'),10));
});
$('reset').addEventListener('click', function(){ try{ localStorage.removeItem(LSKEY); }catch(e){} location.reload(); });

// Arrange-panels sheet wiring.
$('settings').addEventListener('click', openSettings);
$('sheetClose').addEventListener('click', applySettings);
$('sheet').addEventListener('click', function(ev){ if(ev.target === $('sheet')) applySettings(); });
$('sheetReset').addEventListener('click', function(){ try{ localStorage.removeItem(OKEY); localStorage.removeItem(HKEY); }catch(e){} location.reload(); });
$('sheetList').addEventListener('click', function(ev){
  var btn = ev.target.closest('button'); if(!btn) return;
  var row = ev.target.closest('.srow'); if(!row) return;
  var i = parseInt(row.getAttribute('data-i'), 10);
  var act = btn.getAttribute('data-act'), t;
  if(act === 'up' && i > 0){ t = sheetWork[i-1]; sheetWork[i-1] = sheetWork[i]; sheetWork[i] = t; }
  else if(act === 'down' && i < sheetWork.length-1){ t = sheetWork[i+1]; sheetWork[i+1] = sheetWork[i]; sheetWork[i] = t; }
  else if(act === 'toggle'){ sheetWork[i].hidden = !sheetWork[i].hidden; }
  renderSheet();
});

// Tether to Supabase: poll while visible, and refresh on focus / tab return.
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', function(){ if(!document.hidden) refresh(); });
window.addEventListener('focus', refresh);

// Switch cleanly between mobile (static flow) and desktop (GridStack) when the
// viewport crosses the breakpoint (e.g. rotate / resize).
var __wasMobile = isMobileView(), __rzt = null;
window.addEventListener('resize', function(){
  clearTimeout(__rzt);
  __rzt = setTimeout(function(){ if(isMobileView() !== __wasMobile){ location.reload(); } }, 250);
});

// RANGE is already the remembered pick (server injects it from the hdbrange cookie).
load(RANGE);
</script>
</body>
</html>`;
}
