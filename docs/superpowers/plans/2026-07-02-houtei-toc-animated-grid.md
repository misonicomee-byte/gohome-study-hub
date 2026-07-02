# Houtei Training Animated TOC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain legal training table-of-contents cards with a colorful animated link grid that keeps lecture navigation fast and clear.

**Architecture:** Keep the existing Astro-generated module links and the existing `data-toc-status` hooks so current client-side status rendering continues to work. Add local CSS variables, animated card accents, status-aware visual states, and reduced-motion handling inside `portal.astro`.

**Tech Stack:** Astro, Tailwind utility classes, local CSS in `<style is:global>`, Node test runner, Playwright CLI, Cloudflare Pages.

## Global Constraints

- Preserve `href="#module-${item.id}"` links and `data-toc-status` hooks.
- Keep the UI usable on desktop and mobile.
- Use a colorful palette with mint/yellow accents, not a green-only palette.
- Provide `prefers-reduced-motion` fallback.
- Do not change quiz, certificate, or LINE authentication behavior.

---

### Task 1: Animated TOC Link Grid

**Files:**
- Modify: `/Users/goito/Documents/python/gohome-study-hub/src/pages/houtei-kenshu/portal.astro`
- Modify: `/Users/goito/Documents/python/gohome-study-hub/tests/houteiKenshuPortal.test.mjs`

**Interfaces:**
- Consumes: `trainingModules` array used by the existing TOC.
- Produces: `data-toc-status` spans still updated by `setStatusPill()`.

- [ ] **Step 1: Write failing tests**

Add tests that require `研修を選ぶ`, `training-toc-stage`, `training-toc-card`, theme color variables, `@keyframes toc-accent-slide`, and `prefers-reduced-motion`.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: new TOC tests fail because the current portal still uses the plain `目次` card list.

- [ ] **Step 3: Implement the TOC**

Replace the current `<nav>` with the animated link grid and add CSS styles. Keep link URLs and status spans.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Browser verification**

Run local dev server and use Playwright screenshots at desktop and mobile widths.

- [ ] **Step 6: Build and deploy**

Run `npm run build`, `npx wrangler pages functions build`, and deploy to Cloudflare Pages.
