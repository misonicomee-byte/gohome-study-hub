# Monthly Ranking Shorts Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three reviewable monthly ranking Shorts drafts, rotate visual treatments without repetition, and deliver artifacts without publishing them.

**Architecture:** A Node orchestrator invokes the approved data collector and Python renderer through explicit subprocess boundaries. A six-month history file drives recommendations; GitHub Actions runs a manual pilot first, then a monthly schedule on the 5th at 09:00 JST and uploads review artifacts.

**Tech Stack:** Node.js >=22.12, node:test, Python renderer from the renderer plan, GitHub Actions, ffmpeg, artifact upload.

## Global Constraints

- Generate three independent drafts: YouTube, blog, and Instagram.
- One platform failure does not delete successful platform drafts.
- Never publish to YouTube or Instagram automatically.
- Never render a platform whose manifest is missing, partial, or invalid.
- Keep no more than two special transitions in one video.
- Do not recommend the same `placement + motion` combination for the same platform in consecutive months.
- Preserve immutable `ranking.json`, script, captions, QA results, and final SHA-256.

---

## File Structure

- Create `scripts/monthly-ranking-shorts/history.mjs`: style rotation and history validation.
- Create `scripts/monthly-ranking-shorts/orchestrate.mjs`: subprocess orchestration.
- Create `scripts/monthly-ranking-shorts/copy.mjs`: factual script/caption copy.
- Create `config/monthly-ranking-style-history.json`: six-month rolling history.
- Create `tests/monthlyRankingHistory.test.mjs`, `tests/monthlyRankingOrchestrator.test.mjs`.
- Create `.github/workflows/monthly_ranking_shorts.yml`.
- Create `docs/monthly-ranking-shorts-runbook.md`.

### Task 1: Implement deterministic style recommendations

**Files:**
- Create: `scripts/monthly-ranking-shorts/history.mjs`
- Create: `config/monthly-ranking-style-history.json`
- Test: `tests/monthlyRankingHistory.test.mjs`

**Interfaces:**
- Produces: `recommendStyle(channel, month, history)`.
- Produces: `recordStyle(channel, month, placement, motion, history)`.

- [ ] **Step 1: Write failing history tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { recommendStyle, recordStyle } from "../scripts/monthly-ranking-shorts/history.mjs";

test("does not repeat the prior month combination", () => {
  const history = [{ channel: "youtube", month: "2026-05", placement: "hook", motion: "cutout-zoom" }];
  assert.notDeepEqual(recommendStyle("youtube", "2026-06", history), { placement: "hook", motion: "cutout-zoom" });
});

test("keeps only the latest six entries per channel", () => {
  let history = [];
  for (let i = 1; i <= 8; i++) history = recordStyle("blog", `2026-${String(i).padStart(2,"0")}`, "chapter", "split-reveal", history);
  assert.equal(history.filter((x) => x.channel === "blog").length, 6);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/monthlyRankingHistory.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement rotation**

```js
const CANDIDATES = [
  { placement: "hook", motion: "cutout-zoom" },
  { placement: "chapter", motion: "split-reveal" },
  { placement: "hook", motion: "letter-scatter" },
  { placement: "chapter", motion: "cutout-zoom" },
  { placement: "none", motion: "split-reveal" },
];

export function recommendStyle(channel, month, history) {
  const prior = history.filter((x) => x.channel === channel && x.month < month).sort((a,b) => b.month.localeCompare(a.month))[0];
  return CANDIDATES.find((x) => !prior || x.placement !== prior.placement || x.motion !== prior.motion);
}

export function recordStyle(channel, month, placement, motion, history) {
  const withoutCurrent = history.filter((x) => !(x.channel === channel && x.month === month));
  const updated = [...withoutCurrent, { channel, month, placement, motion }];
  return updated.filter((entry) => updated.filter((x) => x.channel === entry.channel).sort((a,b) => b.month.localeCompare(a.month)).slice(0,6).some((x) => x.month === entry.month));
}
```

- [ ] **Step 4: Initialize history and commit**

```json
{
  "schemaVersion": 1,
  "entries": []
}
```

```bash
node --test tests/monthlyRankingHistory.test.mjs
git add scripts/monthly-ranking-shorts/history.mjs tests/monthlyRankingHistory.test.mjs config/monthly-ranking-style-history.json
git commit -m "feat: rotate monthly ranking Shorts styles"
```

### Task 2: Generate factual scripts and publication copy

**Files:**
- Create: `scripts/monthly-ranking-shorts/copy.mjs`
- Create: `tests/monthlyRankingCopy.test.mjs`

**Interfaces:**
- Produces: `buildCopy(manifest): { narration, captions, postTitle, postDescription }`.

- [ ] **Step 1: Write failing copy tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildCopy } from "../scripts/monthly-ranking-shorts/copy.mjs";

test("copy preserves all titles and numbers", () => {
  const manifest = { channel: "youtube", period: { month: "2026-06" }, rankingLabel: "2026年6月の再生回数", items: [1,2,3].map((rank) => ({ rank, title: `タイトル${rank}`, metricValue: rank * 100, url: `https://example.test/${rank}` })) };
  const copy = buildCopy(manifest);
  for (const item of manifest.items) {
    assert.match(copy.narration, new RegExp(item.title));
    assert.match(copy.narration, new RegExp(String(item.metricValue)));
  }
  assert.doesNotMatch(copy.narration, /治る|必ず|最高の医療/);
});
```

- [ ] **Step 2: Implement templated, non-evaluative copy**

```js
export function buildCopy(manifest) {
  const month = manifest.period.month.replace("-", "年") + "月";
  const ordered = [...manifest.items].sort((a,b) => b.rank - a.rank);
  const lines = [`${month}の人気コンテンツ、トップ3をご紹介します。`];
  for (const item of ordered) lines.push(`第${item.rank}位、${item.title}。${manifest.rankingLabel}は${item.metricValue.toLocaleString("ja-JP")}回でした。`);
  lines.push("気になる内容は、ごうホームクリニック公式チャンネルとサイトからご覧ください。");
  const captions = lines.map((text, index) => ({ id: index + 1, text }));
  return {
    narration: lines.join("\n"), captions,
    postTitle: `【${month}】${manifest.channel} 人気コンテンツTOP3`,
    postDescription: `${month}に多く見られたコンテンツをご紹介します。\n${manifest.items.sort((a,b) => a.rank-b.rank).map((x) => `${x.rank}位 ${x.title}\n${x.url}`).join("\n")}\n※集計期間：${month}1日〜末日`,
  };
}
```

- [ ] **Step 3: Test and commit**

```bash
node --test tests/monthlyRankingCopy.test.mjs
git add scripts/monthly-ranking-shorts/copy.mjs tests/monthlyRankingCopy.test.mjs
git commit -m "feat: generate factual ranking Shorts copy"
```

### Task 3: Implement independent platform orchestration

**Files:**
- Create: `scripts/monthly-ranking-shorts/orchestrate.mjs`
- Create: `tests/monthlyRankingOrchestrator.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `runMonthlyRanking({ month, outDir, spawnImpl, env })`.
- Produces: `npm run ranking:shorts -- --month YYYY-MM --out output/monthly-ranking/YYYY-MM`.

- [ ] **Step 1: Write failing orchestration tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { runMonthlyRanking } from "../scripts/monthly-ranking-shorts/orchestrate.mjs";

test("continues other channels when one render fails", async () => {
  const calls = [];
  const spawnImpl = async (command, args) => { calls.push([command, ...args]); if (args.some((x) => String(x).includes("instagram"))) throw new Error("fixture failure"); };
  const result = await runMonthlyRanking({ month: "2026-06", outDir: "/tmp/ranking-test", spawnImpl, env: { ...process.env } });
  assert.equal(result.youtube.status, "ok");
  assert.equal(result.blog.status, "ok");
  assert.equal(result.instagram.status, "failed");
});
```

- [ ] **Step 2: Implement subprocess execution**

```js
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCopy } from "./copy.mjs";
import { recommendStyle } from "./history.mjs";

export function spawnChecked(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
```

`runMonthlyRanking` first invokes `npm run ranking:collect -- --month ...`. It then loops over `youtube`, `blog`, and `instagram`; reads and validates that platform manifest; writes `narration.txt`, `captions.json`, `post-title.txt`, and `post-description.txt`; chooses a style; calls the Python renderer; and records `{status, output, error}` without throwing away other channel results. It writes a final `run-summary.json` and exits nonzero only after all platform attempts finish.

- [ ] **Step 3: Add CLI and package script**

```json
"ranking:shorts": "node scripts/monthly-ranking-shorts/orchestrate.mjs"
```

The CLI must accept only `--month YYYY-MM`, `--out DIR`, and optional per-channel `--youtube-style`, `--blog-style`, `--instagram-style` values formatted as `placement:motion`.

- [ ] **Step 4: Test and commit**

```bash
node --test tests/monthlyRankingOrchestrator.test.mjs
npm test
git add scripts/monthly-ranking-shorts tests/monthlyRankingOrchestrator.test.mjs package.json
git commit -m "feat: orchestrate monthly ranking Shorts drafts"
```

### Task 4: Add manual GitHub Actions pilot

**Files:**
- Create: `.github/workflows/monthly_ranking_shorts.yml`

**Interfaces:**
- Consumes: Tasks 1–3 and both prerequisite plans.
- Produces: a downloadable artifact containing three draft folders and `run-summary.json`.

- [ ] **Step 1: Add a workflow-dispatch-only workflow**

```yaml
name: Monthly ranking Shorts drafts

on:
  workflow_dispatch:
    inputs:
      month:
        description: Target month in YYYY-MM
        required: true
        type: string

permissions:
  contents: read

jobs:
  render:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg fonts-ipafont-gothic
      - run: npm ci
      - run: python -m pip install -r scripts/ranking-shorts-renderer/requirements.txt
      - run: npm test
      - run: PYTHONPATH=scripts/ranking-shorts-renderer python -m unittest discover -s scripts/ranking-shorts-renderer/tests -v
      - name: Generate drafts
        run: npm run ranking:shorts -- --month "${{ inputs.month }}" --out "output/monthly-ranking/${{ inputs.month }}"
        env:
          CONTENT_ANALYTICS_GAS_URL: ${{ secrets.CONTENT_ANALYTICS_GAS_URL }}
          YOUTUBE_CLIENT_ID: ${{ secrets.YOUTUBE_CLIENT_ID }}
          YOUTUBE_CLIENT_SECRET: ${{ secrets.YOUTUBE_CLIENT_SECRET }}
          YOUTUBE_REFRESH_TOKEN: ${{ secrets.YOUTUBE_REFRESH_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: monthly-ranking-shorts-${{ inputs.month }}
          path: output/monthly-ranking/${{ inputs.month }}
          retention-days: 30
```

- [ ] **Step 2: Validate workflow syntax and commit**

```bash
npx prettier --check .github/workflows/monthly_ranking_shorts.yml || true
git add .github/workflows/monthly_ranking_shorts.yml
git commit -m "ci: add monthly ranking Shorts pilot workflow"
```

- [ ] **Step 3: Configure secrets and run the pilot**

Configure the six named repository secrets without printing their values. Dispatch a completed previous month. Expected: the job runs all tests, uploads an artifact, and performs no publish API call.

### Task 5: Review the pilot and enable the monthly schedule

**Files:**
- Modify: `.github/workflows/monthly_ranking_shorts.yml`
- Create: `docs/monthly-ranking-shorts-runbook.md`

**Interfaces:**
- Produces: scheduled execution on the 5th at 09:00 JST.
- Produces: operator review and retry instructions.

- [ ] **Step 1: Verify the pilot artifact**

For each platform, compare `ranking.json` to the real analytics surface, listen to the full narration, inspect the QA sheet, fully play the MP4, and confirm `qa.json` SHA-256 matches the reviewed file. Approve or reject each platform independently.

- [ ] **Step 2: Add the schedule only after all three pilot drafts pass**

```yaml
on:
  schedule:
    - cron: "0 0 5 * *" # 09:00 JST on the 5th
  workflow_dispatch:
    inputs:
      month:
        description: Optional YYYY-MM override; blank uses previous JST month
        required: false
        type: string
```

Update the generate command so blank input omits `--month` and uses `previousMonthPeriod()`.

- [ ] **Step 3: Write the runbook**

Document data definitions, required secrets, the Instagram full-boundary rule, how to override styles, how to retry one failed platform, artifact retention, human approval checklist, and the explicit rule that publishing remains manual.

- [ ] **Step 4: Run final verification**

```bash
npm test
npm run build
PYTHONPATH=scripts/ranking-shorts-renderer python3 -m unittest discover -s scripts/ranking-shorts-renderer/tests -v
```

Expected: all tests pass; build succeeds; workflow contains no YouTube upload or Instagram publishing endpoint.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/monthly_ranking_shorts.yml docs/monthly-ranking-shorts-runbook.md
git commit -m "feat: schedule reviewed monthly ranking Shorts drafts"
```
