# Houtei Kenshu TOC Blueprint-Grid Background Design

## Problem

The previous TOC background animated ~40 free-floating parts (slabs, tiles,
beams, corners) at random positions, rotations, and sizes. The area outside the
training cards read as visual noise rather than a designed surface.

## Reference

Refero style `ee403055-480e-4bd4-9216-07c9ae2dde2e` — Swiss/International
Typographic system: ink black on white/mist surfaces, `#d1ffca` (mint pulse)
and `#fff100` (electric yellow) as the only accents, grid precision, restraint.

## Concept: Blueprint Grid

Every background element snaps to the 48px grid the stage already draws, and
moves only along grid axes. No rotation, no random drift. The motion reads as
an orchestrated system rather than floating debris.

| Element | Class | Behavior |
|---|---|---|
| Cell pulses (14) | `.training-toc-build-part` | Grid cells (48/96px) light up in mint/yellow; delay follows `col + row`, producing a diagonal wave |
| Scan beam (1) | `.training-toc-grid-beam` | 2px electric-yellow vertical line sweeps left→right (~7.6s travel, 18s cycle) with a 120px afterglow |
| Travelling dots (3) | `.training-toc-grid-dot` | 6px graphite dots run along one grid line, one axis at a time |
| Hairline rules (3) | `.training-toc-grid-rule` | 1px ink lines draw in (`scaleX 0→1`) along grid rows, hold, fade |
| Registration marks (6) | `.training-toc-grid-mark` | CSS-drawn `+` at grid intersections, subtle opacity pulse |

## Constraints

- Layer stays `aria-hidden`, `z-index` below content, `pointer-events: none`.
- Colors limited to mint pulse, electric yellow, ink/graphite low-alpha.
- `prefers-reduced-motion: reduce` disables all animation; every element's
  base state is invisible (opacity 0) except the static `+` marks.
- Mobile (≤640px): marks/dots/rules hidden, pulses reduced and slowed.
- Cards, quizzes, certificates, LINE auth, and print layout unchanged.

## Data model

Positions are authored in grid cells (`col`, `row`, `size`/`span`) in
`portal.astro` frontmatter and converted to px via `GRID_UNIT = 48`, so
alignment with the painted grid is guaranteed by construction.
