# Bunker diagram style — template spec

A small, dependency-free way to author flow diagrams for the dashboard Bunker:
**hand-built SVG + vanilla JS**, no mermaid, no build step. `scripts/bunker-diagram.mjs`
renders a JSON data spec into a single self-contained HTML file you can pipe straight into
`scripts/bunker-add.mjs`.

The look: rounded boxes, a small semantic color palette, and optional clickable **drill-down**
(a node opens a deeper sub-view, with breadcrumb navigation back out). Author diagrams as a data
spec rather than styling them by hand, so every diagram comes out consistent.

## 1. Rounded boxes

Every node/result/drop box is an SVG `<rect rx="13">` (13px corner radius). Stroke `1.6`, or
`2.4` when `bold` (start/end nodes and result boxes). Dead-ends use `stroke-dasharray="6 4"`.

## 2. TONES palette

```js
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
```

Spine nodes are colored by their `kind` (start/step/decision/end); `outs` and `drops` take an
explicit `tone`. The page uses a dark theme (`--bg:#0b0b13`) and the Inter font.

## 3. VIEWS data model

The whole diagram is one `VIEWS` object; each named view is one screen:

```js
VIEWS = {
  <viewId>: {
    title: "...",            // shown as the view heading
    intro: "...",            // one-line subhead
    nodes: [                 // vertical spine, top to bottom
      {id, kind, label, sub?, drill?, gapAfter?}
      // kind: start | step | decision | end
      // drill: another viewId -> this node becomes clickable
      // sub: second line (e.g. "open >" to signal a drill target)
      // gapAfter: extra vertical px before the next node
    ],
    outs: [                  // result boxes to the RIGHT of a node
      {at, tone, tag?, label, sub?, drill?, off?}
      // at: node id to attach to; tone: a TONES key
      // tag: label on the connector arrow; off: vertical px nudge
    ],
    drops: [                 // dead-ends to the LEFT (dashed)
      {at, label, off?}
    ]
  }
}
```

## 4. Drill-down + breadcrumb mechanics

- A node or out with `drill:"<viewId>"` renders with class `node clickable` and a
  `data-drill="<viewId>"` attribute.
- One delegated click listener on `#canvas` reads `e.target.closest("[data-drill]")` and calls
  `render(viewId, true)`, pushing onto a breadcrumb `stack`.
- `#crumb` renders the trail (intermediate crumbs clickable, last one bold); `#back` pops the
  stack and is disabled at the root view.
- `render(id, push)` lays out the spine, draws spine arrows behind boxes, then outs, then drops,
  then spine boxes on top, then auto-sizes the `viewBox` to the content bounds with 16px padding.

## 5. Geometry constants

```js
const CX = 300, NW = 216, NH = 60, GAP = 46;   // spine
const OUTX = 470, OW = 300, OH = 56;           // result boxes (right)
const DROPX = 18, DRW = 150, DRH = 46;         // dead-ends (left)
```

## 6. Usage

```bash
# render a spec to stdout
node scripts/bunker-diagram.mjs scripts/diagram-specs/example-flow.json

# render and drop it on the dashboard Bunker
node scripts/bunker-diagram.mjs scripts/diagram-specs/example-flow.json \
  | node scripts/bunker-add.mjs --title "My flow" --tags diagram
```

See `scripts/diagram-specs/example-flow.json` for a complete worked example, including a
drill-down sub-view. Page head copy (eyebrow, h1, lede, legend, tip) and the `initial` view are
all set in the spec; only `VIEWS` and that copy change per diagram.

## 7. Agent-readable (promote-safe)

The diagram is drawn by JavaScript at runtime, so its box and branch labels live inside a
`<script>` block. The dashboard's "promote to vault" strips `<script>`/`<style>` before saving
the searchable note, which would otherwise leave a promoted diagram with only its page chrome.
To avoid that, the generator also emits a visually-hidden `<div class="diagram-text" hidden>`
containing a flat outline of every view title, node, branch, and drop label. It is invisible in
the browser but survives text extraction, so a promoted diagram lands in the vault with all of
its content searchable, not just the picture.
