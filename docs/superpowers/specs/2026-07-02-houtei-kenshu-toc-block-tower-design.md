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

### The playful object: segmented hex column with docking cubes (v4)
Modelled frame-by-frame on the user's screen recording of the dayos hero:
a column of stacked hexagonal segments — wood grain (SVG pattern), dark
walnut, speckled terrazzo (SVG pattern), electric-yellow band, and a
terrazzo crown with a pink (#ff4fa3) top face standing in for the pink
inner cavity — with bright iso cubes docking at its sides and small cubes
hovering around the top. Light from the upper left; self-shadow via
translucent black overlays on the front (10%) and right (22%) faces.
No ground shadow.

Motion — one beat per element staggered over a 16s loop plus ever-running
floaters, so movement never stops and comes from every direction:
- terrazzo segment slides out left −12px and back (right-to-left drawer)
- yellow peg docks out right +16px and back (left-to-right)
- crown lifts −10px with a settle bounce (bottom-to-top)
- mint peg docks out left −16px and back
- yellow band slides out right +14px and back
- three floaters (magenta, yellow, white) bob ±16–20px with horizontal sway,
  periods 3.6/4.2/4.8s so phases never align

Transform layering rule: position (attribute transform on wrapper g) >
loop motion (`.toc-tower-lifter` / `.toc-tower-docker` / `.toc-tower-floater`
on a middle g) > drop-in (`.toc-tower-block` on the leaf). CSS transforms
replace attribute transforms on the same node, so the layers must be
separate elements; nested groups compose cleanly.

### Accessibility / responsive
- Tower is `aria-hidden`, hidden below 1024px (mobile gets the pure flat canvas).
- `prefers-reduced-motion`: animations off; base styles leave the tower
  fully assembled and visible.
