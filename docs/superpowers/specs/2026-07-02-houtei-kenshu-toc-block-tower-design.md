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

### The playful object: isometric block tower
Inline SVG in the header row (between heading and 合格基準 card), built from
one reusable `#toc-iso-block` (3 polygons, 2:1 dimetric). Iso cell math:
`x = 80 + (i - j) * 24`, `y = 110 + (i + j) * 12 - k * 20`.

Blocks: yellow base + mint and white flanking columns + yellow second story +
one ink-black block on top.

12s loop (`toc-tower-drop` / `toc-tower-hop`):
1. Blocks drop in staggered with a small bounce (0–1.6s).
2. Hold.
3. The black block hops from the yellow column onto the white column (~5.3s),
   perches there, hops back (~9.6s).
4. Tower scatters upward and reassembles — the dayos "restack" beat.

### Accessibility / responsive
- Tower is `aria-hidden`, hidden below 1024px (mobile gets the pure flat canvas).
- `prefers-reduced-motion`: animations off; base styles leave the tower
  fully assembled and visible.
