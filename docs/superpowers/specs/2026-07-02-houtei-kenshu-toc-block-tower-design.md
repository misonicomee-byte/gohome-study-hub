# Houtei Kenshu TOC Block-Tower Design

## v7: Three.js WebGL scene (current)

`src/scripts/houteiTowerScene.mjs` renders the hero object in real 3D when
WebGL is available (`.training-toc-tower.is-gl` hides the SVG fallback):

- Hex column of five CylinderGeometry(6-seg) segments — wood-grain and
  terrazzo CanvasTextures, walnut, yellow, pink-capped crown — flat-shaded
  MeshStandardMaterial, ACES tone mapping, PCF shadows on a ShadowMaterial
  floor disc, transparent canvas over the mist stage.
- Five RoundedBox cubes (mint / terrazzo / yellow / magenta / wood) run the
  24s formation cycle: docked ring → exploded halo with wobble → tumbling
  (full 2π around per-cube axes) criss-cross flight → pyramid stacked on the
  crown → staggered cascade home. The whole object slowly rotates (48s/turn)
  while column beats (crown lift, segment drawer slides) fire between phases.
- Lifecycle: IntersectionObserver + visibilitychange pause the RAF loop;
  pixel ratio clamped to 2; prefers-reduced-motion and WebGL failure keep
  the SVG tower (below) instead. Bundle cost ≈130KB gzip, portal page only.

---

# (SVG fallback) v2 history

## Problem

Two prior iterations decorated the TOC background with ambient motion
(40 free-floating shapes, then a 27-part "blueprint grid" of pulses, beams,
dots, rules, and marks). Both contradicted the reference style, which the
user pointed out.

## Reference (verified against the actual source)

Refero style `ee403055-480e-4bd4-9216-07c9ae2dde2e` = dayos.com,
"Swiss editorial spread on cool paper". Key rules taken from the style text
and confirmed by inspecting dayos.com:

- **Surfaces are flat — no shadows, no gradients.** Separation comes from a
  5-level tonal stack: canvas mist → white card → surface mist → mint → yellow.
- **Generous whitespace rather than dividers or rules.** No background
  patterns, no grid lines, no ambient particles. The canvas is empty.
- **Color used surgically.** Mint (#d1ffca) and electric yellow (#fff100)
  appear as flat highlight washes, not gradients.
- **"Engineered restraint with a playful object at the center."** The only
  delight is ONE 3D block object (yellow/mint/white/black blocks) that
  restacks itself. Everything else is still.
- Tiny mono voice for tags; monumental black headings.

## Implementation

### Flat canvas
- Stage: flat `--color-canvas-mist` (#e5e7eb), hairline border, 24px radius,
  no box-shadow, no ::before layer, no repeating-gradient grid.
- Cards: flat pure white, 12px radius, no border, no shadows (hover = lift only).
- Status tints and card accent washes: flat `color-mix` solids, no gradients.
- Kicker pill: mono uppercase on electric yellow.

### The playful object: segmented hex column with docking cubes (v4)
Modelled frame-by-frame on the user's screen recording of the dayos hero:
a column of stacked hexagonal segments — wood grain (SVG pattern), dark
walnut, speckled terrazzo (SVG pattern), electric-yellow band, and a
terrazzo crown with a pink (#ff4fa3) top face standing in for the pink
inner cavity — with bright iso cubes docking at its sides and small cubes
hovering around the top. Light from the upper left; self-shadow via
translucent black overlays on the front (10%) and right (22%) faces.
No ground shadow.

Motion — the cubes perpetually restack (v5 carousel):
- Five uniform cubes ride a carousel around the column over an 18s loop:
  stations left-mid → left-top → top → right-top → right-mid → across the
  floor in front → left-mid. Every 3.6s all five hop one station forward
  (1.6s arcs with raised midpoints), so the arrangement visibly swaps and
  re-stacks forever. Keyframes `toc-orbit-a`–`toc-orbit-e`.
- Column beats on a separate 16s loop: terrazzo segment drawer-slides left,
  yellow band slides right, crown lifts with a settle bounce. 16s vs 18s
  drift means the combined pattern repeats only every 144s.

Transform layering rule: position (attribute transform on wrapper g) >
loop motion (`.toc-tower-lifter` / `.toc-tower-docker` / `.toc-tower-floater`
on a middle g) > drop-in (`.toc-tower-block` on the leaf). CSS transforms
replace attribute transforms on the same node, so the layers must be
separate elements; nested groups compose cleanly.

### Accessibility / responsive
- Tower is `aria-hidden`, hidden below 1024px (mobile gets the pure flat canvas).
- `prefers-reduced-motion`: animations off; base styles leave the tower
  fully assembled and visible.
