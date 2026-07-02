# LINE Mobile Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep QR-code LINE Login on desktop while allowing mobile users to launch LINE app or use LINE auto login.

**Architecture:** The Pages Function that starts LINE Login will detect likely mobile user agents. Desktop authorization URLs keep the QR-forcing parameters. Mobile authorization URLs keep `bot_prompt=aggressive` and core OAuth parameters, but omit QR/auto-login disabling parameters so LINE can use app-based login.

**Tech Stack:** Cloudflare Pages Functions, TypeScript, Node test runner, Astro static build, Wrangler.

## Global Constraints

- Preserve `bot_prompt=aggressive` so official LINE friend-add flow remains available.
- Preserve callback URL, state, nonce, returnTo sanitization, and signed state cookie behavior.
- Do not add server-side storage.
- Use tests before implementation.

---

### Task 1: Device-Aware LINE Login Parameters

**Files:**
- Modify: `/Users/goito/Documents/python/gohome-study-hub/functions/api/auth/line/start.ts`
- Test: `/Users/goito/Documents/python/gohome-study-hub/tests/lineAuthStart.test.mjs`

**Interfaces:**
- Consumes: `onRequestGet(context)` from `functions/api/auth/line/start.ts`
- Produces: Authorization redirect where desktop keeps `initial_amr_display=lineqr`, `switch_amr=false`, `disable_auto_login=true`, `prompt=login`; mobile omits those four parameters.

- [ ] **Step 1: Write failing tests**

Create a test that calls `onRequestGet()` with desktop and iPhone user agents and inspects the redirected `Location` URL.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: mobile test fails because the current implementation always includes QR-forcing parameters.

- [ ] **Step 3: Implement minimal code**

Add `isMobileUserAgent()` and wrap the four QR/auto-login parameters in a desktop-only branch.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Build and deploy**

Run: `npm run build`, `npx wrangler pages functions build functions --outdir .wrangler/tmp-pages-functions`, then deploy with Wrangler.
