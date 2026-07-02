# Houtei Kenshu Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated legal-training video placement, client-side quizzes, and client-side certificate issuance to the houtei-kenshu portal, with no server-side completion records.

**Architecture:** Keep training metadata and completion logic in a testable ES module. Store videos in Cloudflare R2 and serve them through an authenticated Pages Function so MP4 files are not bundled into Pages. Store completion, quiz pass state, and certificate fields in browser localStorage only.

**Tech Stack:** Astro, Cloudflare Pages Functions, Cloudflare R2, Wrangler, Node built-in test runner, browser localStorage.

---

### Task 1: Training Metadata And Eligibility Logic

**Files:**
- Create: `/Users/goito/Documents/python/gohome-study-hub/tests/houteiKenshu.test.mjs`
- Create: `/Users/goito/Documents/python/gohome-study-hub/src/data/houteiKenshu.mjs`
- Modify: `/Users/goito/Documents/python/gohome-study-hub/package.json`

- [ ] Write a failing Node test that asserts the 13 training modules exist, that `10 ハラスメント...` is displayed as `02`, and that certificate eligibility requires all modules watched plus a passing quiz.
- [ ] Run `npm test` and confirm it fails because `src/data/houteiKenshu.mjs` does not exist.
- [ ] Implement `trainingModules`, `requiredModuleIds`, `PASSING_SCORE`, `calculateQuizScore`, and `isCertificateReady`.
- [ ] Add `"test": "node --test tests/*.test.mjs"` to `package.json`.
- [ ] Run `npm test` and confirm the tests pass.

### Task 2: R2 Video Storage And Authenticated Video Function

**Files:**
- Create: `/Users/goito/Documents/python/gohome-study-hub/wrangler.jsonc`
- Create: `/Users/goito/Documents/python/gohome-study-hub/functions/api/houtei-kenshu/video/[slug].ts`

- [ ] Create R2 bucket `gohome-houtei-kenshu-videos` if it does not already exist.
- [ ] Upload the 13 local MP4 files into R2 using stable slugs from `trainingModules`.
- [ ] Configure Pages with R2 binding `TRAINING_VIDEOS`.
- [ ] Implement authenticated video serving at `/api/houtei-kenshu/video/:slug`, using the existing LINE session cookie and a whitelist from `trainingModules`.
- [ ] Support HTTP range requests enough for HTML video seeking.

### Task 3: Portal UI, Quiz, And Certificate

**Files:**
- Replace: `/Users/goito/Documents/python/gohome-study-hub/src/pages/houtei-kenshu/portal.astro`

- [ ] Render all training modules in display order, with `02` assigned to the harassment video and no blank `02` placeholder.
- [ ] Add video players pointing at `/api/houtei-kenshu/video/{slug}`.
- [ ] Add client-side completion controls stored in `localStorage`.
- [ ] Add one small-test question per module and require all answers correct for quiz pass.
- [ ] Add certificate form and printable certificate section unlocked only when all modules are marked complete and the quiz is passed.
- [ ] Keep certificate issuance browser-only and label it as locally generated.

### Task 4: Build, Deploy, And Verify

**Files:**
- No new source files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Deploy with `npx wrangler pages deploy`.
- [ ] Verify `/houtei-kenshu/portal` redirects when unauthenticated.
- [ ] Verify the deployed portal can reach the LINE-protected video endpoint behaviorally without exposing MP4s as Pages assets.
