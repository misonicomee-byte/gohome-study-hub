import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../gas/content-analytics/Code.js", import.meta.url),
  "utf8",
);

function loadGas(overrides = {}) {
  const context = vm.createContext({
    console: { error() {}, log() {} },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty() { return "test-token"; } };
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(content) {
        return {
          content,
          setMimeType() { return this; },
        };
      },
    },
    Utilities: {
      formatDate(date) { return date.toISOString().slice(0, 10); },
    },
    AnalyticsData: {
      Properties: { runReport() { return { rows: [] }; } },
    },
    UrlFetchApp: {
      fetch() {
        return { getContentText() { return JSON.stringify({ data: [] }); } };
      },
    },
    ...overrides,
  });
  vm.runInContext(source, context, { filename: "Code.js" });
  return context;
}

function callJsonApi(context, params) {
  context.__testParams = params;
  const response = vm.runInContext("handleApiRequest_(__testParams)", context);
  return JSON.parse(response.content);
}

test("blog API uses an explicit GA4 date range and preserves aggregation", () => {
  const requests = [];
  const context = loadGas({
    AnalyticsData: {
      Properties: {
        runReport(request, property) {
          requests.push({ request, property });
          return {
            rows: [
              {
                dimensionValues: [
                  { value: "/2026/06/05/example/?source=a" },
                  { value: "記事タイトル｜ごうホームクリニック" },
                ],
                metricValues: [{ value: "8" }, { value: "3" }],
              },
              {
                dimensionValues: [
                  { value: "/2026/06/05/example/?source=b" },
                  { value: "記事タイトル｜ごうホームクリニック" },
                ],
                metricValues: [{ value: "5" }, { value: "2" }],
              },
            ],
          };
        },
      },
    },
  });

  const result = callJsonApi(context, {
    api: "blog-ranking",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    limit: "100",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].request.dateRanges)), [
    { startDate: "2026-06-01", endDate: "2026-06-30" },
  ]);
  assert.deepEqual(result.period, {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
  });
  assert.equal(result.data[0].pageViews, 13);
  assert.equal(result.data[0].totalUsers, 5);
  assert.equal(result.data[0].date, "2026-06-05");
});

test("blog API rejects invalid or reversed calendar dates safely", () => {
  let reportCalls = 0;
  const context = loadGas({
    AnalyticsData: {
      Properties: {
        runReport() {
          reportCalls += 1;
          return { rows: [] };
        },
      },
    },
  });

  for (const [startDate, endDate] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-13-01", "2026-12-31"],
    ["2026-06-30", "2026-06-01"],
    ["2026/06/01", "2026-06-30"],
  ]) {
    const result = callJsonApi(context, {
      api: "blog-ranking",
      startDate,
      endDate,
      limit: "100",
    });
    assert.match(result.error, /valid startDate and endDate/);
  }
  assert.equal(reportCalls, 0);
});

test("content API limits must be bounded positive integers", () => {
  const context = loadGas();

  for (const api of ["blog-ranking", "instagram-posts"]) {
    for (const limit of ["0", "-1", "1.5", "101", "abc"]) {
      const result = callJsonApi(context, {
        api,
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        limit,
      });
      assert.match(result.error, /limit must be a positive integer/);
    }
  }
});

test("Instagram insights request and expose numeric views", () => {
  const endpoints = [];
  const context = loadGas();
  context.__testInstagramApi = function (endpoint) {
    endpoints.push(endpoint);
    if (endpoint.includes("/media?")) {
      return {
        data: [{
          id: "post-1",
          permalink: "https://example.test/post-1",
          caption: "caption",
          media_type: "VIDEO",
          timestamp: "2026-06-01T00:00:00Z",
        }],
      };
    }
    return {
      data: [
        { name: "views", values: [{ value: "42" }] },
        { name: "reach", values: [{ value: 21 }] },
      ],
    };
  };
  vm.runInContext("callInstagramApi = __testInstagramApi", context);

  const result = callJsonApi(context, {
    api: "instagram-posts",
    limit: "100",
  });

  assert.equal(
    endpoints[1],
    "post-1/insights?metric=views,reach,saved,shares,total_interactions",
  );
  assert.equal(result.data[0].views, 42);
  assert.equal(result.data[0].reach, 21);
});

test("Instagram insights keep safe zeros for API errors and malformed metrics", () => {
  const context = loadGas();
  context.__testInstagramApi = function (endpoint) {
    if (endpoint.includes("/media?")) {
      return {
        data: [
          { id: "post-error" },
          { id: "post-missing" },
          { id: "post-malformed" },
          { id: "post-valid" },
        ],
      };
    }
    if (endpoint.startsWith("post-error/")) return { error: { message: "unavailable" } };
    if (endpoint.startsWith("post-missing/")) return { data: null };
    if (endpoint.startsWith("post-malformed/")) {
      return {
        data: [
          null,
          { name: "views" },
          { name: "views", values: [{ value: -1 }] },
          { name: "reach", values: [{ value: "not-a-number" }] },
          { name: "saved", values: [{ value: Infinity }] },
          { name: "shares", values: { value: 1 } },
          { name: "shares", values: [{ value: true }] },
          { name: "shares", values: [null] },
          { name: "total_interactions", values: [{}] },
          { name: "total_interactions", values: null },
        ],
      };
    }
    return {
      data: [
        { name: "views", values: [{ value: "42" }] },
        { name: "reach", values: [{ value: 21 }] },
        { name: "saved", values: [{ value: "3" }] },
        { name: "shares", values: [{ value: 0 }] },
        { name: "total_interactions", values: [{ value: "8" }] },
      ],
    };
  };
  vm.runInContext("callInstagramApi = __testInstagramApi", context);

  const result = callJsonApi(context, { api: "instagram-posts", limit: "100" });

  const metrics = result.data ? result.data.map(function (post) {
    return {
      views: post.views,
      reach: post.reach,
      saved: post.saved,
      shares: post.shares,
      total_interactions: post.total_interactions,
    };
  }) : result;
  assert.deepEqual(JSON.parse(JSON.stringify(metrics)), [
    { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 },
    { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 },
    { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 },
    { views: 42, reach: 21, saved: 3, shares: 0, total_interactions: 8 },
  ]);
});

test("source exposes the exact blog function signature", () => {
  assert.match(
    source,
    /function getBlogRankingFromGA4_\(startDate, endDate, limit\)/,
  );
});
