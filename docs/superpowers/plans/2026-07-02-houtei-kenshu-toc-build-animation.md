# Houtei Kenshu TOC Build Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legal training TOC's simple sliding background with a subtle, endlessly assembling geometric background while preserving readability.

**Architecture:** Keep the change local to the TOC section in `portal.astro`. Add an `aria-hidden` build-animation layer inside `.training-toc-stage`, render repeated decorative parts with Astro data, and animate them with CSS keyframes that assemble, drift, and fade. Existing cards, quiz flow, certificates, LINE auth, and print layout remain unchanged.

**Tech Stack:** Astro, inline CSS in `src/pages/houtei-kenshu/portal.astro`, Node test runner in `tests/houteiKenshuPortal.test.mjs`, Playwright for visual verification.

## Global Constraints

- Only modify the legal training TOC background and its regression tests.
- Preserve card readability on desktop and mobile.
- Keep animation decorative with `aria-hidden="true"`.
- Respect `prefers-reduced-motion: reduce` by disabling animation.
- Do not change videos, quizzes, certificate generation, LINE auth, or PDF print layout.

---

### Task 1: Add Subtle Assembling Background To TOC

**Files:**
- Modify: `src/pages/houtei-kenshu/portal.astro`
- Modify: `tests/houteiKenshuPortal.test.mjs`

**Interfaces:**
- Consumes: existing `.training-toc-stage`, `.training-toc-header`, `.training-toc-grid`, and `trainingModules.map(...)`.
- Produces: `.training-toc-build-layer`, `.training-toc-build-part`, `@keyframes toc-build-assemble`, and reduced-motion coverage for the new animation.

- [ ] **Step 1: Write the failing test**

Insert this test after `training table of contents uses a colorful animated link grid` in `tests/houteiKenshuPortal.test.mjs`:

```js
test("training table of contents uses subtle assembling background graphics", () => {
  const tocSection = portalSource.match(/<nav class="training-toc-stage[\s\S]*?<\/nav>/)?.[0] || "";
  const reducedMotionStyles = portalSource.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(tocSection, /class="training-toc-build-layer"/);
  assert.match(tocSection, /class="training-toc-build-part"/);
  assert.match(tocSection, /aria-hidden="true"/);
  assert.match(portalSource, /@keyframes toc-build-assemble/);
  assert.match(portalSource, /\.training-toc-build-part\s*{[\s\S]*animation:\s*toc-build-assemble/);
  assert.match(reducedMotionStyles, /\.training-toc-build-part/);
  assert.doesNotMatch(portalSource, /animation:\s*toc-accent-slide 14s linear infinite;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/houteiKenshuPortal.test.mjs
```

Expected: FAIL for `training table of contents uses subtle assembling background graphics`, because `.training-toc-build-layer` and `@keyframes toc-build-assemble` do not exist yet.

- [ ] **Step 3: Add decorative part data**

Near the existing `rosterRows` constant in `src/pages/houtei-kenshu/portal.astro`, add:

```js
const tocBuildParts = [
  { tone: "mint", shape: "block", style: "--x: 6%; --y: 66%; --w: 18rem; --h: 5rem; --delay: -2s; --duration: 18s; --lift: -5rem;" },
  { tone: "yellow", shape: "block", style: "--x: 78%; --y: 8%; --w: 12rem; --h: 4rem; --delay: -8s; --duration: 22s; --lift: -7rem;" },
  { tone: "mist", shape: "grid", style: "--x: 48%; --y: 10%; --w: 22rem; --h: 12rem; --delay: -12s; --duration: 26s; --lift: -4rem;" },
  { tone: "white", shape: "block", style: "--x: 28%; --y: 34%; --w: 14rem; --h: 4rem; --delay: -5s; --duration: 20s; --lift: -6rem;" },
  { tone: "mint", shape: "line", style: "--x: 8%; --y: 24%; --w: 16rem; --h: 2px; --delay: -10s; --duration: 17s; --lift: -3rem;" },
  { tone: "yellow", shape: "line", style: "--x: 62%; --y: 68%; --w: 18rem; --h: 2px; --delay: -3s; --duration: 19s; --lift: -5rem;" },
  { tone: "mist", shape: "dot", style: "--x: 88%; --y: 48%; --w: 0.7rem; --h: 0.7rem; --delay: -14s; --duration: 21s; --lift: -6rem;" },
  { tone: "mint", shape: "dot", style: "--x: 36%; --y: 78%; --w: 0.55rem; --h: 0.55rem; --delay: -7s; --duration: 16s; --lift: -4rem;" },
  { tone: "yellow", shape: "bar", style: "--x: 18%; --y: 86%; --w: 7rem; --h: 0.8rem; --delay: -11s; --duration: 18s; --lift: -8rem;" },
  { tone: "white", shape: "bar", style: "--x: 72%; --y: 82%; --w: 9rem; --h: 0.9rem; --delay: -6s; --duration: 24s; --lift: -5rem;" },
  { tone: "mint", shape: "block", style: "--x: 52%; --y: 52%; --w: 8rem; --h: 8rem; --delay: -16s; --duration: 25s; --lift: -6rem;" },
  { tone: "yellow", shape: "dot", style: "--x: 44%; --y: 18%; --w: 0.65rem; --h: 0.65rem; --delay: -1s; --duration: 15s; --lift: -3rem;" },
];
```

- [ ] **Step 4: Add the decorative layer markup**

Inside `<nav class="training-toc-stage mt-8" aria-label="研修目次">`, before `<div class="training-toc-header">`, add:

```astro
      <span class="training-toc-build-layer" aria-hidden="true">
        {tocBuildParts.map((part) => (
          <span
            class="training-toc-build-part"
            data-tone={part.tone}
            data-shape={part.shape}
            style={part.style}
          ></span>
        ))}
      </span>
```

- [ ] **Step 5: Replace sliding stripe CSS with assembling background CSS**

In `src/pages/houtei-kenshu/portal.astro`, replace the `.training-toc-stage::before` block and the `@keyframes toc-accent-slide` block with these styles:

```css
    .training-toc-stage::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(243, 243, 243, 0.92)),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.035) 0 1px, transparent 1px 48px),
        repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.025) 0 1px, transparent 1px 48px);
      opacity: 0.95;
    }

    .training-toc-build-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 0;
    }

    .training-toc-build-part {
      position: absolute;
      left: var(--x);
      top: var(--y);
      width: var(--w);
      height: var(--h);
      border-radius: 8px;
      opacity: 0;
      transform: translate3d(-18px, 28px, 0) scaleX(0.72);
      transform-origin: left bottom;
      animation: toc-build-assemble var(--duration) cubic-bezier(0.55, 0, 0.2, 1) infinite;
      animation-delay: var(--delay);
      will-change: transform, opacity;
    }

    .training-toc-build-part[data-tone="mint"] {
      background: rgba(209, 255, 202, 0.42);
    }

    .training-toc-build-part[data-tone="yellow"] {
      background: rgba(255, 241, 0, 0.32);
    }

    .training-toc-build-part[data-tone="white"] {
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(0, 0, 0, 0.06);
    }

    .training-toc-build-part[data-tone="mist"] {
      background:
        linear-gradient(rgba(229, 231, 235, 0.48), rgba(229, 231, 235, 0.48)),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.06) 0 1px, transparent 1px 20px);
    }

    .training-toc-build-part[data-shape="line"],
    .training-toc-build-part[data-shape="bar"] {
      border-radius: 999px;
    }

    .training-toc-build-part[data-shape="dot"] {
      border-radius: 999px;
    }

    @keyframes toc-build-assemble {
      0% {
        opacity: 0;
        transform: translate3d(-18px, 28px, 0) scaleX(0.72) scaleY(0.85);
      }

      18% {
        opacity: 0.72;
        transform: translate3d(0, 0, 0) scaleX(1) scaleY(1);
      }

      58% {
        opacity: 0.62;
        transform: translate3d(18px, calc(var(--lift) * 0.45), 0) scaleX(1.04) scaleY(1);
      }

      100% {
        opacity: 0;
        transform: translate3d(42px, var(--lift), 0) scaleX(0.88) scaleY(0.92);
      }
    }
```

- [ ] **Step 6: Update reduced motion and mobile styles**

In the existing `@media (max-width: 640px)` block, add:

```css
      .training-toc-build-part:nth-child(n + 8) {
        display: none;
      }

      .training-toc-build-part {
        animation-duration: calc(var(--duration) * 1.4);
      }
```

In the existing `@media (prefers-reduced-motion: reduce)` selector list, add `.training-toc-build-part`.

- [ ] **Step 7: Run test to verify it passes**

Run:

```bash
npm test -- tests/houteiKenshuPortal.test.mjs
```

Expected: PASS with 18 tests, including the new assembling background test.

- [ ] **Step 8: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass, Astro build completes successfully.

- [ ] **Step 9: Verify visually with Playwright**

Run a local preview:

```bash
npm run preview -- --host 127.0.0.1 --port 4325
```

Use Playwright to capture:

- Desktop screenshot of the TOC area at 1440px width.
- Mobile screenshot of the TOC area at 430px width.

Expected:

- The background shows multiple faint pieces assembling rather than one big stripe sliding sideways.
- Text is readable.
- No text overlap.
- Mobile title/category wrapping remains readable.

- [ ] **Step 10: Deploy**

Run:

```bash
npx wrangler pages deploy dist --project-name=gohome-study-hub --branch=main --commit-dirty=true
```

Expected: Wrangler reports `Deployment complete` and returns a preview URL.

- [ ] **Step 11: Post-deploy smoke check**

Run:

```bash
curl -sS -I https://study.gohome-clinic.com/houtei-kenshu/portal/ | head -12
```

Expected: `HTTP/2 302` to the authenticated legal training entrance, preserving the auth gate.
