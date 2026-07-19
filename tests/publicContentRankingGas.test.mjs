import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ROOT = new URL("../gas/public-content-ranking-api/", import.meta.url);
const source = await readFile(new URL("Code.js", ROOT), "utf8");

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ["2026-07-19T03:00:00.000Z"]));
  }

  static now() { return Date.parse("2026-07-19T03:00:00.000Z"); }
  static parse(value) { return Date.parse(value); }
  static UTC(...args) { return Date.UTC(...args); }
}

function formatDate(date, timeZone) {
  if (timeZone === "UTC") return date.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function createHarness({
  cacheGetError = false,
  cachePutError = false,
  lockAvailable = true,
  spreadsheetRows = [],
  podcastRows = [],
  analyticsRows = [],
  instagramFetch,
} = {}) {
  const cache = new Map();
  const properties = new Map([
    ["META_PAGE_ACCESS_TOKEN", "secret-token"],
    ["CONTENT_SNAPSHOT_SPREADSHEET_ID", "snapshot-sheet"],
    ["PODCAST_SPREADSHEET_ID", "podcast-sheet"],
  ]);
  const events = [];
  let lockHeld = false;
  let spreadsheetReads = 0;
  let blobCalls = 0;
  const context = vm.createContext({
    console: { error() {}, warn() {} },
    Date: FixedDate,
    Intl,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(content) {
        return { content, setMimeType() { return this; } };
      },
    },
    CacheService: {
      getScriptCache() {
        return {
          get(key) {
            events.push({ type: "cacheGet", key, lockHeld });
            if (cacheGetError) throw new Error("cache get failed");
            return cache.get(key) ?? null;
          },
          put(key, value, ttl) {
            events.push({ type: "cachePut", key, value, ttl, lockHeld });
            if (cachePutError) throw new Error("cache put failed");
            cache.set(key, value);
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock(timeout) {
            events.push({ type: "tryLock", timeout, lockHeld });
            if (!lockAvailable || lockHeld) return false;
            lockHeld = true;
            return true;
          },
          releaseLock() {
            events.push({ type: "releaseLock", lockHeld });
            lockHeld = false;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty(name) { return properties.get(name) ?? null; } };
      },
    },
    Utilities: {
      formatDate,
      newBlob(value) {
        blobCalls += 1;
        return { getBytes() { return [...Buffer.from(value, "utf8")]; } };
      },
    },
    UrlFetchApp: {
      fetch(url, options) {
        if (instagramFetch) return instagramFetch(url, options);
        return {
          getResponseCode() { return 503; },
          getContentText() { return "{}"; },
        };
      },
    },
    AnalyticsData: {
      Properties: { runReport() { return { rows: analyticsRows }; } },
    },
    SpreadsheetApp: {
      openById(id) {
        const rows = id === "podcast-sheet" ? podcastRows : spreadsheetRows;
        const expectedName = id === "podcast-sheet" ? "Podcast一覧" : "instagram_daily";
        return {
          getSheetByName(name) {
            if (name !== expectedName) return null;
            return { getDataRange() { return { getValues() { spreadsheetReads += 1; return rows; } }; } };
          },
        };
      },
    },
  });
  vm.runInContext(source, context, { filename: "PublicCode.js" });
  return {
    context,
    cache,
    events,
    properties,
    get blobCalls() { return blobCalls; },
    get lockHeld() { return lockHeld; },
    get spreadsheetReads() { return spreadsheetReads; },
  };
}

function callApi(harness, params, parameterLists = null) {
  harness.context.__params = params;
  harness.context.__parameterLists = parameterLists ?? Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, [String(value)]]),
  );
  const response = vm.runInContext(
    "doGet({ parameter: __params, parameters: __parameterLists })",
    harness.context,
  );
  return JSON.parse(response.content);
}

function installLoader(harness, name, valueOrFunction) {
  harness.context.__loader = typeof valueOrFunction === "function"
    ? valueOrFunction
    : () => valueOrFunction;
  vm.runInContext(`${name} = __loader`, harness.context);
}

const snapshotHeaders = [
  "snapshotDate", "mediaId", "timestamp", "permalink", "caption", "mediaType",
  "views", "reach", "totalInteractions", "saved", "shares",
];

test("public GAS is an anonymous JSON-only deployment with exact read-only scopes", async () => {
  const manifest = JSON.parse(await readFile(new URL("appsscript.json", ROOT), "utf8"));

  assert.deepEqual(manifest.webapp, {
    executeAs: "USER_DEPLOYING",
    access: "ANYONE_ANONYMOUS",
  });
  assert.deepEqual(manifest.oauthScopes, [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/script.external_request",
  ]);
  assert.doesNotMatch(
    source,
    /HtmlService|google\.script\.run|getAdsToken|sendToChatWork|ScriptApp|DriveApp|setProperty\(|deleteProperty\(|deleteAllProperties\(/,
  );
  assert.doesNotMatch(source, /access_token=/);
  assert.doesNotMatch(source, /appendRow|setValue\(|setValues\(|insertSheet|newTrigger|createTrigger/);

  const propertyNames = [...source.matchAll(/getProperty\("([A-Z0-9_]+)"\)/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(propertyNames)].sort(), [
    "CONTENT_SNAPSHOT_SPREADSHEET_ID",
    "META_PAGE_ACCESS_TOKEN",
    "PODCAST_SPREADSHEET_ID",
  ]);

  const publicFunctions = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)]
    .map((match) => match[1])
    .filter((name) => !name.endsWith("_"));
  assert.deepEqual(publicFunctions, ["doGet"]);
});

test("doGet returns allowlisted JSON errors without caught details", () => {
  const harness = createHarness();
  assert.deepEqual(callApi(harness, {}), {
    error: "Unknown api",
    errorCode: "INVALID_REQUEST",
    data: [],
  });

  installLoader(harness, "getBlogRankingFromGA4_", () => {
    throw new Error("SECRET_SENTINEL");
  });
  const result = callApi(harness, {
    api: "blog-ranking",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    limit: "100",
  });
  assert.equal(result.errorCode, "UPSTREAM_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL/);
});

test("routes accept only canonical consumer query shapes", () => {
  const valid = { data: [], count: 0 };
  const accepted = [
    [{ api: "blog-ranking", startDate: "2026-06-01", endDate: "2026-06-30", limit: "100" }, "getBlogRankingFromGA4_"],
    [{ api: "blog-ranking", startDate: "2026-01-21", endDate: "2026-07-19", limit: "100" }, "getBlogRankingFromGA4_"],
    [{ api: "instagram-posts" }, "getInstagramPostsWithInsights_"],
    [{ api: "instagram-posts", limit: "30" }, "getInstagramPostsWithInsights_"],
    [{ api: "instagram-posts", limit: "50" }, "getInstagramPostsWithInsights_"],
    [{ api: "instagram-posts", limit: "100" }, "getInstagramPostsWithInsights_"],
    [{ api: "instagram-monthly-ranking", month: "2020-01", limit: "3" }, "getInstagramMonthlyRanking_"],
    [{ api: "podcast-list" }, "getPodcastList_"],
  ];
  for (const [params, loader] of accepted) {
    const harness = createHarness();
    installLoader(harness, loader, valid);
    assert.equal(callApi(harness, params).errorCode, undefined, JSON.stringify(params));
  }

  const rejected = [
    { api: "blog-ranking", startDate: "2026-06-02", endDate: "2026-06-30", limit: "100" },
    { api: "blog-ranking", startDate: "2026-01-21", endDate: "2026-07-18", limit: "100" },
    { api: "blog-ranking", startDate: "2026-06-01", endDate: "2026-06-30", limit: "99" },
    { api: "blog-ranking", startDate: "0000-01-01", endDate: "0000-01-31", limit: "100" },
    { api: "instagram-posts", limit: "1" },
    { api: "instagram-posts", limit: "abc" },
    { api: "instagram-monthly-ranking", month: "0000-01", limit: "3" },
    { api: "instagram-monthly-ranking", month: "2019-12", limit: "3" },
    { api: "instagram-monthly-ranking", month: "2026-08", limit: "3" },
    { api: "instagram-monthly-ranking", month: "2026-07", limit: "3" },
    { api: "instagram-monthly-ranking", month: "2026-06", limit: "100" },
    { api: "podcast-list", limit: "1" },
  ];
  for (const params of rejected) {
    const result = callApi(createHarness(), params);
    assert.equal(result.errorCode, "INVALID_REQUEST", JSON.stringify(params));
  }

  const canonical = {
    api: "blog-ranking",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    limit: "100",
  };
  for (const duplicateName of Object.keys(canonical)) {
    const parameterLists = Object.fromEntries(
      Object.entries(canonical).map(([name, value]) => [name, [value]]),
    );
    parameterLists[duplicateName].push(canonical[duplicateName]);
    const duplicate = callApi(createHarness(), canonical, parameterLists);
    assert.equal(duplicate.errorCode, "INVALID_REQUEST", duplicateName);
  }
});

test("cache failures and oversized values never fail a successful loader", () => {
  for (const option of [{ cacheGetError: true }, { cachePutError: true }]) {
    const harness = createHarness(option);
    harness.context.__calls = 0;
    harness.context.__loader = function () {
      harness.context.__calls += 1;
      return { data: [{ id: "ok" }] };
    };
    const result = vm.runInContext("cachedJson_('key', 600, __loader)", harness.context);
    assert.equal(result.data[0].id, "ok");
    assert.equal(harness.context.__calls, 1);
    assert.equal(harness.lockHeld, false);
  }

  const harness = createHarness();
  harness.context.__loader = () => ({ data: [{ caption: "x".repeat(90000) }] });
  const result = vm.runInContext("cachedJson_('large', 600, __loader)", harness.context);
  assert.equal(result.data[0].caption.length, 90000);
  assert.equal(harness.events.some((event) => event.type === "cachePut"), false);
});

test("cache miss is loaded once under a bounded script lock with a second cache check", () => {
  const harness = createHarness();
  harness.context.__calls = 0;
  harness.context.__loader = function () {
    harness.context.__calls += 1;
    return { data: [{ id: "loaded" }] };
  };
  const result = vm.runInContext("cachedJson_('stampede', 600, __loader)", harness.context);
  assert.equal(result.data[0].id, "loaded");
  assert.equal(harness.context.__calls, 1);
  assert.deepEqual(harness.events.map((event) => event.type), [
    "cacheGet", "tryLock", "cacheGet", "cachePut", "releaseLock",
  ]);
  assert.equal(harness.events.find((event) => event.type === "cachePut").lockHeld, true);
  assert.equal(harness.lockHeld, false);

  const busy = createHarness({ lockAvailable: false });
  busy.context.__calls = 0;
  busy.context.__loader = function () { busy.context.__calls += 1; return { data: [] }; };
  const unavailable = vm.runInContext("cachedJson_('busy', 600, __loader)", busy.context);
  assert.equal(unavailable.errorCode, "UPSTREAM_UNAVAILABLE");
  assert.equal(busy.context.__calls, 0);
});

test("blog route executes and preserves its public response schema", () => {
  const analyticsRows = [{
    dimensionValues: [{ value: "/2026/06/05/example/?source=x" }, { value: "Title｜Clinic" }],
    metricValues: [{ value: "8" }, { value: "3" }],
  }];
  const result = callApi(createHarness({ analyticsRows }), {
    api: "blog-ranking",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    limit: "100",
  });
  assert.deepEqual(result, {
    data: [{
      url: "https://gohome-clinic.com/2026/06/05/example/",
      title: "Title",
      date: "2026-06-05",
      pageViews: 8,
      totalUsers: 3,
    }],
    count: 1,
    period: { startDate: "2026-06-01", endDate: "2026-06-30" },
  });
});

test("Instagram post route executes and returns finite public metrics", () => {
  const instagramFetch = (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret-token");
    const payload = url.includes("/media?")
      ? { data: [{
        id: "post-1", caption: "Caption", media_type: "VIDEO",
        permalink: "https://example.test/post-1", timestamp: "2026-06-10T00:00:00Z",
        like_count: "4", comments_count: 2,
      }] }
      : { data: [
        { name: "views", values: [{ value: "10" }] },
        { name: "reach", values: [{ value: 7 }] },
        { name: "total_interactions", values: [{ value: 5 }] },
      ] };
    return {
      getResponseCode() { return 200; },
      getContentText() { return JSON.stringify(payload); },
    };
  };
  const result = callApi(createHarness({ instagramFetch }), { api: "instagram-posts", limit: "30" });
  assert.deepEqual(result.data[0], {
    id: "post-1",
    permalink: "https://example.test/post-1",
    caption: "Caption",
    media_type: "VIDEO",
    media_url: "",
    thumbnail_url: "",
    timestamp: "2026-06-10T00:00:00Z",
    like_count: 4,
    comments_count: 2,
    views: 10,
    reach: 7,
    total_interactions: 5,
    saved: 0,
    shares: 0,
  });
  assert.equal(result.count, 1);
});

test("monthly route preserves exact boundaries, ranking, and collector error codes", () => {
  const row = (date, id, timestamp, views, interactions) => [
    date, id, timestamp, `https://example.test/${id}`, `Caption ${id}`, "VIDEO",
    views, 0, interactions, 0, 0,
  ];
  const spreadsheetRows = [
    snapshotHeaders,
    row("2026-06-01", "a", "2026-06-01T00:00:00Z", 1, 1),
    row("2026-07-01", "a", "2026-06-01T00:00:00Z", 11, 3),
  ];
  const result = callApi(createHarness({ spreadsheetRows }), {
    api: "instagram-monthly-ranking", month: "2026-06", limit: "3",
  });
  assert.equal(result.partial, false);
  assert.deepEqual(result.period, {
    month: "2026-06",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    timezone: "Asia/Tokyo",
    boundarySnapshotDate: "2026-07-01",
  });
  assert.equal(result.data[0].viewsDelta, 10);
  assert.equal(result.data[0].totalInteractionsDelta, 2);

  const missingStore = createHarness();
  missingStore.properties.delete("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  assert.equal(
    callApi(missingStore, { api: "instagram-monthly-ranking", month: "2026-06", limit: "3" }).errorCode,
    "INSTAGRAM_SNAPSHOT_STORE_NOT_CONFIGURED",
  );
  const missingBoundary = callApi(createHarness({ spreadsheetRows: [snapshotHeaders] }), {
    api: "instagram-monthly-ranking", month: "2026-06", limit: "3",
  });
  assert.equal(missingBoundary.errorCode, "INSTAGRAM_COMPLETE_MONTH_BOUNDARY_SNAPSHOTS_REQUIRED");

  const negativeCache = createHarness({ spreadsheetRows: [snapshotHeaders] });
  callApi(negativeCache, { api: "instagram-monthly-ranking", month: "2026-06", limit: "3" });
  callApi(negativeCache, { api: "instagram-monthly-ranking", month: "2026-06", limit: "3" });
  const negativePuts = negativeCache.events.filter((event) => event.type === "cachePut");
  assert.equal(negativePuts.length, 1);
  assert.ok(negativePuts[0].ttl > 0 && negativePuts[0].ttl <= 60);
  assert.equal(negativeCache.events.filter((event) => event.type === "tryLock").length, 1);
  assert.ok(negativeCache.spreadsheetReads <= 1);
});

test("podcast route preserves the portal response schema", () => {
  const podcastRows = [
    ["No", "platform", "title", "date", "url", "embed", "duration", "id"],
    [1, "YouTube", "100 Episode", "2026/06/01", "https://example.test/watch", "", "", "yt-1"],
  ];
  const result = callApi(createHarness({ podcastRows }), { api: "podcast-list" });
  assert.deepEqual(result, {
    data: [{
      id: "yt-1",
      title: "100 Episode",
      date: "2026-06-01",
      url: "https://example.test/watch",
      youtubeId: "yt-1",
    }],
    count: 1,
  });

  const manyRows = [podcastRows[0]];
  for (let index = 0; index < 1000; index += 1) {
    manyRows.push([index, "YouTube", `Episode ${index} ${"長".repeat(200)}`, "2026/06/01",
      `https://example.test/${index}/${"x".repeat(300)}`, "", "", `yt-${index}`]);
  }
  const largeHarness = createHarness({ podcastRows: manyRows });
  const bounded = callApi(largeHarness, { api: "podcast-list" });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.totalCount, 1000);
  assert.equal(bounded.count, bounded.data.length);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") < 80000);
  assert.ok(largeHarness.blobCalls <= 20, `blob sizing calls: ${largeHarness.blobCalls}`);
});
