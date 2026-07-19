# Monthly Ranking Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce validated previous-month TOP3 manifests for YouTube Shorts, clinic blog posts, and Instagram posts.

**Architecture:** Keep API access and ranking logic separate. A managed GAS source supplies exact-range GA4 data and persistent Instagram media snapshots; Node ESM collectors in `gohome-study-hub` normalize all three platforms into one versioned manifest schema.

**Tech Stack:** Node.js >=22.12, node:test, Google Apps Script, YouTube Analytics API, GA4 Data API, Instagram Graph API v24+, clasp.

## Global Constraints

- All date ranges use `Asia/Tokyo` and cover an exact calendar month.
- Never silently replace previous-month metrics with lifetime metrics.
- YouTube ranking uses `creatorContentType=SHORTS`, `views`, then `engagedViews`.
- Blog ranking uses `screenPageViews`, then `totalUsers`.
- Instagram ranking uses stored `views` deltas, then `total_interactions` deltas; `reach` is reference-only.
- Every emitted manifest has exactly three ranked items or fails closed.
- Existing untracked `docs/tiktok-app-review-application.md` remains untouched.

---

## File Structure

- Create `gas/content-analytics/`: source-controlled clone of Apps Script ID `1CsRK5Z-9YTi07Y2S_qEwkkPHIVeVa7xC3AN1fZXx19z7kyi_rSf7M8JA`.
- Create `scripts/monthly-ranking-data/period.mjs`: exact JST month boundaries.
- Create `scripts/monthly-ranking-data/schema.mjs`: manifest validation and stable JSON writing.
- Create `scripts/monthly-ranking-data/youtube.mjs`: YouTube Analytics/Data API collector.
- Create `scripts/monthly-ranking-data/blog.mjs`: exact-range GAS blog collector.
- Create `scripts/monthly-ranking-data/instagram.mjs`: snapshot-delta collector.
- Create `scripts/monthly-ranking-data/collect.mjs`: three-platform CLI.
- Create `tests/monthlyRankingPeriod.test.mjs`, `tests/monthlyRankingSchema.test.mjs`, `tests/monthlyRankingCollectors.test.mjs`, `tests/contentAnalyticsGas.test.mjs`.

### Task 1: Put the live GAS source under version control

**Files:**
- Create: `gas/content-analytics/.clasp.json`
- Create: `gas/content-analytics/appsscript.json`
- Create: `gas/content-analytics/Code.js`
- Create: `gas/content-analytics/index.html`
- Create: `gas/content-analytics/scripts.html`
- Create: `gas/content-analytics/styles.html`

**Interfaces:**
- Consumes: live Apps Script ID `1CsRK5Z-9YTi07Y2S_qEwkkPHIVeVa7xC3AN1fZXx19z7kyi_rSf7M8JA`.
- Produces: a clasp-managed source tree used by Tasks 4 and 5.

- [ ] **Step 1: Clone the live script into the managed directory**

```bash
mkdir -p gas/content-analytics
cd gas/content-analytics
clasp clone 1CsRK5Z-9YTi07Y2S_qEwkkPHIVeVa7xC3AN1fZXx19z7kyi_rSf7M8JA
```

Expected: `Code.js`, HTML files, `appsscript.json`, and `.clasp.json` exist; no credentials are printed.

- [ ] **Step 2: Compare the clone with the audited snapshot**

```bash
diff -u ../../../../infra/gas-inventory/review/scan/068/Code.js Code.js
```

Expected: either no diff, or a reviewed live-newer diff. Do not overwrite the live clone with the older inventory copy.

- [ ] **Step 3: Run secret and syntax checks**

```bash
rg -n "AIza|EA[A-Za-z0-9]{20,}|CHATWORK_API_TOKEN\s*:\s*['\"][^'\"]" .
node --check Code.js
```

Expected: no literal tokens; `node --check` exits 0.

- [ ] **Step 4: Commit the managed baseline**

```bash
git add gas/content-analytics
git commit -m "chore: manage content analytics GAS source"
```

### Task 2: Implement exact JST month boundaries and manifest validation

**Files:**
- Create: `scripts/monthly-ranking-data/period.mjs`
- Create: `scripts/monthly-ranking-data/schema.mjs`
- Test: `tests/monthlyRankingPeriod.test.mjs`
- Test: `tests/monthlyRankingSchema.test.mjs`

**Interfaces:**
- Produces: `previousMonthPeriod(now): { month, startDate, endDate, timezone }`.
- Produces: `validateManifest(value)` and `writeManifest(path, value)`.

- [ ] **Step 1: Write failing period tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { previousMonthPeriod } from "../scripts/monthly-ranking-data/period.mjs";

test("previousMonthPeriod handles year rollover in JST", () => {
  assert.deepEqual(previousMonthPeriod(new Date("2026-01-04T23:00:00Z")), {
    month: "2025-12", startDate: "2025-12-01", endDate: "2025-12-31", timezone: "Asia/Tokyo",
  });
});

test("previousMonthPeriod handles leap February", () => {
  assert.equal(previousMonthPeriod(new Date("2028-03-05T00:00:00Z")).endDate, "2028-02-29");
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test tests/monthlyRankingPeriod.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the period helper**

```js
export function previousMonthPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const targetYear = month === 1 ? year - 1 : year;
  const targetMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const mm = String(targetMonth).padStart(2, "0");
  return {
    month: `${targetYear}-${mm}`,
    startDate: `${targetYear}-${mm}-01`,
    endDate: `${targetYear}-${mm}-${String(lastDay).padStart(2, "0")}`,
    timezone: "Asia/Tokyo",
  };
}
```

- [ ] **Step 4: Write failing schema tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../scripts/monthly-ranking-data/schema.mjs";

const valid = {
  schemaVersion: 1,
  channel: "youtube",
  period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" },
  rankingMetric: "views",
  rankingLabel: "2026年6月の再生回数",
  generatedAt: "2026-07-05T09:00:00+09:00",
  items: [1, 2, 3].map((rank) => ({ rank, contentId: `id-${rank}`, title: `title-${rank}`, url: "https://example.test", publishedAt: "2026-01-01", metricValue: 4-rank, secondaryMetricValue: 0 })),
};

test("accepts an exact TOP3 manifest", () => assert.equal(validateManifest(valid), valid));
test("rejects fewer than three items", () => assert.throws(() => validateManifest({ ...valid, items: valid.items.slice(0, 2) }), /exactly 3/));
test("rejects duplicate ranks", () => assert.throws(() => validateManifest({ ...valid, items: valid.items.map((x) => ({ ...x, rank: 1 })) }), /ranks 1,2,3/));
```

- [ ] **Step 5: Implement validation and stable writing**

```js
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function validateManifest(value) {
  if (value?.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!['youtube', 'blog', 'instagram'].includes(value.channel)) throw new Error("invalid channel");
  if (value.period?.timezone !== "Asia/Tokyo") throw new Error("timezone must be Asia/Tokyo");
  if (!Array.isArray(value.items) || value.items.length !== 3) throw new Error("manifest must contain exactly 3 items");
  if (value.items.map((x) => x.rank).join(",") !== "1,2,3") throw new Error("items must have ranks 1,2,3");
  for (const item of value.items) {
    if (!item.contentId || !item.title || !item.url || !Number.isFinite(item.metricValue)) throw new Error(`invalid rank ${item.rank}`);
  }
  return value;
}

export async function writeManifest(path, value) {
  validateManifest(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/monthlyRankingPeriod.test.mjs tests/monthlyRankingSchema.test.mjs
git add scripts/monthly-ranking-data/period.mjs scripts/monthly-ranking-data/schema.mjs tests/monthlyRankingPeriod.test.mjs tests/monthlyRankingSchema.test.mjs
git commit -m "feat: define monthly ranking manifest contract"
```

Expected: 5 tests pass.

### Task 3: Add the YouTube previous-month collector

**Files:**
- Create: `scripts/monthly-ranking-data/youtube.mjs`
- Test: `tests/monthlyRankingCollectors.test.mjs`

**Interfaces:**
- Consumes: `{ accessToken, channelId, period, fetchImpl }`.
- Produces: `collectYouTubeRanking(options): Promise<Manifest>`.

- [ ] **Step 1: Write a failing ranking test with mocked API responses**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { collectYouTubeRanking } from "../scripts/monthly-ranking-data/youtube.mjs";

test("YouTube sorts by monthly views then engagedViews", async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => url.includes("youtubeAnalytics")
    ? { rows: [["a", 100, 30], ["b", 120, 20], ["c", 100, 40], ["d", 20, 10]] }
    : { items: ["a", "b", "c", "d"].map((id) => ({ id, snippet: { title: id, publishedAt: "2026-01-01T00:00:00Z" } })) } });
  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" }, fetchImpl });
  assert.deepEqual(result.items.map((x) => x.contentId), ["b", "c", "a"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/monthlyRankingCollectors.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the collector**

```js
export async function collectYouTubeRanking({ accessToken, channelId, period, fetchImpl = fetch }) {
  const query = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  query.search = new URLSearchParams({
    ids: `channel==${channelId}`, startDate: period.startDate, endDate: period.endDate,
    metrics: "views,engagedViews", dimensions: "video", filters: "creatorContentType==SHORTS",
    sort: "-views,-engagedViews", maxResults: "50",
  });
  const analytics = await fetchImpl(query, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!analytics.ok) throw new Error(`YouTube Analytics status=${analytics.status}`);
  const rows = (await analytics.json()).rows ?? [];
  if (rows.length < 3) throw new Error("YouTube returned fewer than 3 Shorts");
  const ids = rows.map((row) => row[0]);
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}`;
  const detailsResponse = await fetchImpl(detailsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!detailsResponse.ok) throw new Error(`YouTube Data status=${detailsResponse.status}`);
  const byId = new Map((await detailsResponse.json()).items.map((x) => [x.id, x.snippet]));
  const items = rows.map(([id, views, engagedViews]) => ({ id, views: Number(views), engagedViews: Number(engagedViews), snippet: byId.get(id) }))
    .sort((a, b) => b.views - a.views || b.engagedViews - a.engagedViews || String(b.snippet.publishedAt).localeCompare(String(a.snippet.publishedAt)))
    .slice(0, 3)
    .map((x, index) => ({ rank: index + 1, contentId: x.id, title: x.snippet.title, url: `https://www.youtube.com/shorts/${x.id}`, publishedAt: x.snippet.publishedAt.slice(0, 10), metricValue: x.views, secondaryMetricValue: x.engagedViews }));
  return { schemaVersion: 1, channel: "youtube", period, rankingMetric: "views", rankingLabel: `${period.month}の再生回数`, generatedAt: new Date().toISOString(), items };
}
```

- [ ] **Step 4: Test and commit**

```bash
node --test tests/monthlyRankingCollectors.test.mjs
git add scripts/monthly-ranking-data/youtube.mjs tests/monthlyRankingCollectors.test.mjs
git commit -m "feat: collect monthly YouTube Shorts ranking"
```

### Task 4: Extend GAS with exact-range blog data and Instagram views

**Files:**
- Modify: `gas/content-analytics/Code.js`
- Test: `tests/contentAnalyticsGas.test.mjs`

**Interfaces:**
- Produces: `?api=blog-ranking&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=100`.
- Produces: `?api=instagram-posts&limit=100` including `views`.

- [ ] **Step 1: Write source contract tests**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("../gas/content-analytics/Code.js", import.meta.url), "utf8");

test("blog API accepts explicit start and end dates", () => {
  assert.match(source, /params\.startDate/);
  assert.match(source, /params\.endDate/);
  assert.match(source, /getBlogRankingFromGA4_\(startDate, endDate, limit\)/);
});
test("Instagram media insights request views", () => assert.match(source, /metric=views,reach,saved,shares,total_interactions/));
```

- [ ] **Step 2: Verify the contract tests fail**

Run: `node --test tests/contentAnalyticsGas.test.mjs`

Expected: both tests fail.

- [ ] **Step 3: Change the blog route to explicit dates**

```js
case "blog-ranking": {
  const startDate = String(params.startDate || "");
  const endDate = String(params.endDate || "");
  const limit = parseInt(params.limit, 10) || 100;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new Error("blog-ranking requires valid startDate and endDate");
  }
  result = getBlogRankingFromGA4_(startDate, endDate, limit);
  break;
}
```

Change the function signature to `getBlogRankingFromGA4_(startDate, endDate, limit)` and remove the rolling-day calculation while retaining the existing GA4 query, aggregation, and returned `period` object.

- [ ] **Step 4: Request and return Instagram views**

```js
function getPostInsights(mediaId) {
  const data = callInstagramApi(`${mediaId}/insights?metric=views,reach,saved,shares,total_interactions`);
  if (data.error) return { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 };
  const result = { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 };
  (data.data || []).forEach(function (metric) {
    if (metric.values && metric.values.length) result[metric.name] = Number(metric.values[0].value || 0);
  });
  return result;
}
```

Add `views: insights.views` to `getInstagramPostsWithInsights()`.

- [ ] **Step 5: Test, push, and verify the live endpoints**

```bash
node --test tests/contentAnalyticsGas.test.mjs
cd gas/content-analytics
clasp push
clasp deploy --description "monthly ranking exact ranges and Instagram views"
```

Expected: tests pass; deployment returns a deployment ID. Open the deployed web app with an exact previous-month query and confirm JSON `period.startDate`, `period.endDate`, and Instagram `views`.

- [ ] **Step 6: Commit**

```bash
git add gas/content-analytics/Code.js tests/contentAnalyticsGas.test.mjs
git commit -m "feat: expose exact content ranking metrics"
```

### Task 5: Add Instagram daily snapshots and monthly delta API

**Files:**
- Modify: `gas/content-analytics/Code.js`
- Modify: `gas/content-analytics/appsscript.json`
- Test: `tests/contentAnalyticsGas.test.mjs`

**Interfaces:**
- Produces: `setupInstagramSnapshotStore()` and `runDailyInstagramSnapshot()`.
- Produces: `?api=instagram-monthly-ranking&month=YYYY-MM&limit=3`.

- [ ] **Step 1: Add failing source contract tests**

```js
test("GAS defines snapshot setup, daily capture, and monthly ranking", () => {
  for (const name of ["setupInstagramSnapshotStore", "runDailyInstagramSnapshot", "getInstagramMonthlyRanking_"]) {
    assert.match(source, new RegExp(`function ${name}\\(`));
  }
});
```

- [ ] **Step 2: Implement snapshot setup and append-only daily capture**

```js
function setupInstagramSnapshotStore() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create("Instagram content snapshots");
  if (!id) props.setProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID", ss.getId());
  const sheet = ss.getSheetByName("instagram_daily") || ss.insertSheet("instagram_daily");
  if (sheet.getLastRow() === 0) sheet.appendRow(["snapshotDate", "mediaId", "timestamp", "permalink", "caption", "mediaType", "views", "reach", "totalInteractions", "saved", "shares"]);
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === "runDailyInstagramSnapshot"; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("runDailyInstagramSnapshot").timeBased().everyDays(1).atHour(6).create();
  return { spreadsheetId: ss.getId(), sheet: sheet.getName() };
}

function runDailyInstagramSnapshot() {
  const id = PropertiesService.getScriptProperties().getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!id) throw new Error("Run setupInstagramSnapshotStore first");
  const sheet = SpreadsheetApp.openById(id).getSheetByName("instagram_daily");
  const date = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  const posts = getInstagramPostsWithInsights(100);
  if (posts.error) throw new Error(posts.error);
  const rows = (posts.data || []).map(function (p) { return [date, p.id, p.timestamp, p.permalink, p.caption, p.media_type, p.views, p.reach, p.total_interactions, p.saved, p.shares]; });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
```

- [ ] **Step 3: Implement strict boundary deltas**

```js
function getInstagramMonthlyRanking_(month, limit) {
  var id = PropertiesService.getScriptProperties().getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!id) throw new Error("Instagram snapshot store is not configured");
  var values = SpreadsheetApp.openById(id).getSheetByName("instagram_daily").getDataRange().getValues();
  var start = month + "-01";
  var parts = month.split("-").map(Number);
  var next = Utilities.formatDate(new Date(Date.UTC(parts[0], parts[1], 1)), "UTC", "yyyy-MM-dd");
  var headers = values.shift();
  var index = {}; headers.forEach(function (name, i) { index[name] = i; });
  var byDate = {};
  values.forEach(function (row) {
    var date = String(row[index.snapshotDate]);
    if (date !== start && date !== next) return;
    byDate[date] = byDate[date] || {};
    byDate[date][String(row[index.mediaId])] = row;
  });
  if (!byDate[start] || !byDate[next]) throw new Error("Complete month boundary snapshots are required");
  var rows = Object.keys(byDate[next]).filter(function (mediaId) { return byDate[start][mediaId]; }).map(function (mediaId) {
    var a = byDate[start][mediaId], b = byDate[next][mediaId];
    return {
      id: mediaId, timestamp: String(b[index.timestamp]), permalink: String(b[index.permalink]), caption: String(b[index.caption]), media_type: String(b[index.mediaType]),
      viewsDelta: Math.max(0, Number(b[index.views]) - Number(a[index.views])),
      totalInteractionsDelta: Math.max(0, Number(b[index.totalInteractions]) - Number(a[index.totalInteractions])),
    };
  });
  rows.sort(function (a, b) { return b.viewsDelta - a.viewsDelta || b.totalInteractionsDelta - a.totalInteractionsDelta || b.timestamp.localeCompare(a.timestamp); });
  return { data: rows.slice(0, limit), period: { month: month, startDate: start, endDate: next }, partial: false };
}
```

Do not use the nearest partial date.

- [ ] **Step 4: Wire the API route and verify locally**

```js
case "instagram-monthly-ranking": {
  const month = String(params.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month must be YYYY-MM");
  result = getInstagramMonthlyRanking_(month, parseInt(params.limit, 10) || 3);
  break;
}
```

Run: `node --test tests/contentAnalyticsGas.test.mjs`

Expected: all contract tests pass.

- [ ] **Step 5: Deploy, run setup once, and inspect the real sheet**

```bash
cd gas/content-analytics
clasp push
clasp open
```

In the live editor run `setupInstagramSnapshotStore`, then `runDailyInstagramSnapshot`. Confirm the sheet contains one header and one row per returned post, no duplicate tokens, and numeric `views` values.

- [ ] **Step 6: Commit**

```bash
git add gas/content-analytics/Code.js gas/content-analytics/appsscript.json tests/contentAnalyticsGas.test.mjs
git commit -m "feat: store daily Instagram media snapshots"
```

### Task 6: Add blog/Instagram collectors and the three-platform CLI

**Files:**
- Create: `scripts/monthly-ranking-data/blog.mjs`
- Create: `scripts/monthly-ranking-data/instagram.mjs`
- Create: `scripts/monthly-ranking-data/collect.mjs`
- Modify: `tests/monthlyRankingCollectors.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectBlogRanking(options)` and `collectInstagramRanking(options)`.
- Produces: `npm run ranking:collect -- --month YYYY-MM --out output/monthly-ranking/YYYY-MM`.

- [ ] **Step 1: Add mocked collector tests**

Test exact URL parameters, TOP3 sorting, a hard failure for fewer than three items, and a hard failure for Instagram responses marked `partial: true`.

```js
test("blog collector sends exact month boundaries", async () => {
  let requested = "";
  const fetchImpl = async (url) => { requested = String(url); return { ok: true, json: async () => ({ data: [1,2,3].map((n) => ({ url: `https://gohome-clinic.com/2026/01/0${n}/x/`, title: `post-${n}`, date: `2026-01-0${n}`, pageViews: 10-n, totalUsers: n })) }) }; };
  await collectBlogRanking({ gasUrl: "https://example.test/exec", period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" }, fetchImpl });
  assert.match(requested, /startDate=2026-06-01/);
  assert.match(requested, /endDate=2026-06-30/);
});
```

- [ ] **Step 2: Implement both collectors**

```js
async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`ranking API status=${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error);
  return json;
}

export async function collectBlogRanking({ gasUrl, period, fetchImpl = fetch }) {
  const url = new URL(gasUrl);
  url.search = new URLSearchParams({ api: "blog-ranking", startDate: period.startDate, endDate: period.endDate, limit: "100" });
  const json = await getJson(url, fetchImpl);
  const items = [...json.data].sort((a,b) => b.pageViews-a.pageViews || b.totalUsers-a.totalUsers || b.date.localeCompare(a.date)).slice(0,3)
    .map((x,i) => ({ rank:i+1, contentId:x.url, title:x.title, url:x.url, publishedAt:x.date, metricValue:Number(x.pageViews), secondaryMetricValue:Number(x.totalUsers) }));
  return validateManifest({ schemaVersion:1, channel:"blog", period, rankingMetric:"screenPageViews", rankingLabel:`${period.month}のページビュー`, generatedAt:new Date().toISOString(), items });
}

export async function collectInstagramRanking({ gasUrl, period, fetchImpl = fetch }) {
  const url = new URL(gasUrl);
  url.search = new URLSearchParams({ api: "instagram-monthly-ranking", month: period.month, limit: "3" });
  const json = await getJson(url, fetchImpl);
  if (json.partial !== false) throw new Error("Instagram ranking is partial");
  const items = json.data.map((x,i) => ({ rank:i+1, contentId:x.id, title:x.caption.split("\n")[0], url:x.permalink, publishedAt:x.timestamp.slice(0,10), metricValue:Number(x.viewsDelta), secondaryMetricValue:Number(x.totalInteractionsDelta) }));
  return validateManifest({ schemaVersion:1, channel:"instagram", period, rankingMetric:"viewsDelta", rankingLabel:`${period.month}のviews増加数`, generatedAt:new Date().toISOString(), items });
}
```

- [ ] **Step 3: Implement the CLI**

```js
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => index % 2 === 0 ? [...pairs, [value.replace(/^--/, ""), all[index + 1]]] : pairs, []));
const period = args.month ? periodFromMonth(args.month) : previousMonthPeriod();
const out = args.out || `output/monthly-ranking/${period.month}`;
const manifests = await Promise.all([
  collectYouTubeRanking({ accessToken: process.env.YOUTUBE_ACCESS_TOKEN, channelId: "UCJ2B_z_pz0R_yTZkRbSl4Lg", period }),
  collectBlogRanking({ gasUrl: process.env.CONTENT_ANALYTICS_GAS_URL, period }),
  collectInstagramRanking({ gasUrl: process.env.CONTENT_ANALYTICS_GAS_URL, period }),
]);
for (const manifest of manifests) await writeManifest(`${out}/${manifest.channel}/ranking.json`, manifest);
```

Add `periodFromMonth(month)` to `period.mjs` and reject invalid or future months.

- [ ] **Step 4: Add the package script**

```json
"ranking:collect": "node scripts/monthly-ranking-data/collect.mjs"
```

- [ ] **Step 5: Run all tests and a dry run with fixture endpoints**

```bash
npm test
npm run ranking:collect -- --month 2026-06 --out /tmp/monthly-ranking-fixture
```

Expected: tests pass; dry run produces three validated `ranking.json` files when pointed at fixtures. Do not use production tokens in test output.

- [ ] **Step 6: Commit**

```bash
git add scripts/monthly-ranking-data tests/monthlyRankingCollectors.test.mjs package.json
git commit -m "feat: export monthly content ranking manifests"
```

### Task 7: Production verification and handoff

**Files:**
- Create: `docs/monthly-ranking-data-runbook.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: verified production manifests and operator instructions.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test && npm run build`

Expected: all node tests pass and Astro builds without ranking API credentials.

- [ ] **Step 2: Collect a real previous month without rendering**

```bash
YOUTUBE_ACCESS_TOKEN='from-secure-env' \
CONTENT_ANALYTICS_GAS_URL='deployed-web-app-url' \
npm run ranking:collect -- --month 2026-06 --out output/monthly-ranking/2026-06
```

Expected: YouTube and blog manifests contain strict June data. Instagram either returns a strict full-month manifest or an explicit missing-boundary error; never a mislabeled partial result.

- [ ] **Step 3: Cross-check real surfaces**

Compare YouTube TOP3 to YouTube Studio advanced analytics for the same dates, blog TOP3 to the GA4 exploration, and Instagram snapshot rows to the Instagram insights page. Record only content IDs/titles and aggregate metrics; do not retain private message or patient content.

- [ ] **Step 4: Write the runbook and commit**

Document required Script Properties, GitHub secrets, manual retry commands, exact-period semantics, and how to inspect the snapshot sheet.

```bash
git add docs/monthly-ranking-data-runbook.md
git commit -m "docs: add monthly ranking data runbook"
```
