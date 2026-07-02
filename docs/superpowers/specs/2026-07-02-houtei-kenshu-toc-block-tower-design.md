# Houtei Kenshu TOC Block-Tower Design (v2)

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

### The playful object: hex column with bursting cubes (v3)
Inline SVG in the header row (between heading and 合格基準 card), matching the
reference's 3D hero object: a neutral stone hexagonal column with bright cubes
bursting from the top. Cubes reuse one `#toc-iso-block` (3 polygons, 2:1
dimetric); light from the upper left, so left faces are lighter (self-shadow).
No ground shadow.

Composition (painter's order, back to front): hex column → mint cube (back) →
big yellow cube (front, the dominant hue) → small white cube (front-left) →
two floaters above (small magenta, small yellow).

Motion (`toc-tower-drop` / `toc-tower-float`): every piece drops in once on
load with a staggered bounce (0.8s each, 0–0.75s delays, fill both), then the
two floaters bob continuously (±6px, 3.8s/4.6s ease-in-out alternate) while
the seated pieces stay still. Nothing vanishes or loops through re-assembly.
Positioning `transform` attributes live on wrapper `<g>` elements; CSS
animation transforms live on the inner element — never both on one node
(CSS transform replaces the attribute transform).

### Accessibility / responsive
- Tower is `aria-hidden`, hidden below 1024px (mobile gets the pure flat canvas).
- `prefers-reduced-motion`: animations off; base styles leave the tower
  fully assembled and visible.
