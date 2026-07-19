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

const snapshotHeaders = [
  "snapshotDate",
  "mediaId",
  "timestamp",
  "permalink",
  "caption",
  "mediaType",
  "views",
  "reach",
  "totalInteractions",
  "saved",
  "shares",
];

function createSheet(initialRows = [], name = "instagram_daily", hooks = {}) {
  const rows = initialRows.map((row) => [...row]);
  return {
    rows,
    getName() { return name; },
    getLastColumn() {
      return rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    },
    getLastRow() {
      hooks.onGetLastRow?.();
      return rows.length;
    },
    appendRow(row) { rows.push([...row]); },
    getDataRange() {
      return { getValues() { return rows.map((row) => [...row]); } };
    },
    getRange(row, column, rowCount, columnCount) {
      assert.equal(column, 1);
      return {
        getValues() {
          return rows.slice(row - 1, row - 1 + rowCount)
            .map((value) => value.slice(0, columnCount));
        },
        setValues(values) {
          hooks.onSetValues?.(values);
          for (let index = 0; index < values.length; index += 1) {
            rows[row - 1 + index] = [...values[index]];
          }
        },
      };
    },
  };
}

function createSnapshotHarness({
  id = "snapshot-spreadsheet",
  sheet,
  triggers = [],
  lockAvailable = true,
  events = [],
} = {}) {
  let lockHeld = false;
  if (sheet === undefined) {
    sheet = createSheet([snapshotHeaders], "instagram_daily", {
      onGetLastRow() { events.push({ type: "lastRow", lockHeld }); },
      onSetValues() { events.push({ type: "setValues", lockHeld }); },
    });
  }
  const properties = new Map();
  if (id) properties.set("CONTENT_SNAPSHOT_SPREADSHEET_ID", id);
  const spreadsheet = {
    getId() { return "created-spreadsheet"; },
    getSheetByName(name) { return name === "instagram_daily" ? sheet : null; },
    insertSheet() { return sheet; },
  };
  let createCalls = 0;
  let openCalls = 0;
  let triggerCreateCalls = 0;
  const createdTriggerSchedules = [];
  const activeTriggers = [...triggers];
  const overrides = {
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
            assert.equal(lockHeld, true);
            lockHeld = false;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) { return properties.get(name) || null; },
          setProperty(name, value) { properties.set(name, value); },
        };
      },
    },
    SpreadsheetApp: {
      create() { createCalls += 1; return spreadsheet; },
      openById() { openCalls += 1; return spreadsheet; },
    },
    ScriptApp: {
      getProjectTriggers() { return [...activeTriggers]; },
      deleteTrigger(trigger) {
        const index = activeTriggers.indexOf(trigger);
        if (index >= 0) activeTriggers.splice(index, 1);
      },
      newTrigger(handler) {
        const schedule = { handler };
        return {
          timeBased() { return this; },
          everyDays(days) { schedule.everyDays = days; return this; },
          atHour(hour) { schedule.atHour = hour; return this; },
          create() {
            triggerCreateCalls += 1;
            createdTriggerSchedules.push({ ...schedule });
            activeTriggers.push({ getHandlerFunction() { return handler; } });
          },
        };
      },
    },
  };
  return {
    overrides,
    properties,
    sheet,
    activeTriggers,
    createdTriggerSchedules,
    events,
    get lockHeld() { return lockHeld; },
    get createCalls() { return createCalls; },
    get openCalls() { return openCalls; },
    get triggerCreateCalls() { return triggerCreateCalls; },
  };
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

test("GAS defines snapshot setup, daily capture, and monthly ranking", () => {
  for (const name of [
    "setupInstagramSnapshotStore",
    "runDailyInstagramSnapshot",
    "getInstagramMonthlyRanking_",
  ]) {
    assert.match(source, new RegExp(`function ${name}\\(`));
  }
});

test("snapshot setup creates the store once and keeps exactly one daily trigger", () => {
  const harness = createSnapshotHarness({ id: null, sheet: createSheet([]) });
  const context = loadGas(harness.overrides);

  const first = JSON.parse(JSON.stringify(
    vm.runInContext("setupInstagramSnapshotStore()", context),
  ));
  const second = JSON.parse(JSON.stringify(
    vm.runInContext("setupInstagramSnapshotStore()", context),
  ));

  assert.deepEqual(first, {
    spreadsheetId: "created-spreadsheet",
    sheet: "instagram_daily",
  });
  assert.deepEqual(second, first);
  assert.deepEqual(harness.sheet.rows, [snapshotHeaders]);
  assert.equal(harness.properties.get("CONTENT_SNAPSHOT_SPREADSHEET_ID"), "created-spreadsheet");
  assert.equal(harness.createCalls, 1);
  assert.equal(harness.triggerCreateCalls, 1);
  assert.deepEqual(harness.createdTriggerSchedules, [
    { handler: "runDailyInstagramSnapshot", everyDays: 1, atHour: 6 },
  ]);
  assert.equal(
    harness.activeTriggers.filter((trigger) =>
      trigger.getHandlerFunction() === "runDailyInstagramSnapshot").length,
    1,
  );
  assert.deepEqual(
    harness.events.filter((event) => event.type === "tryLock" || event.type === "releaseLock"),
    [
      { type: "tryLock", timeout: 30000, lockHeld: false },
      { type: "releaseLock", lockHeld: true },
      { type: "tryLock", timeout: 30000, lockHeld: false },
      { type: "releaseLock", lockHeld: true },
    ],
  );
  assert.equal(harness.lockHeld, false);
});

test("snapshot setup replaces duplicate daily triggers without touching other handlers", () => {
  const daily = () => ({ getHandlerFunction() { return "runDailyInstagramSnapshot"; } });
  const other = { getHandlerFunction() { return "otherHandler"; } };
  const harness = createSnapshotHarness({ triggers: [daily(), other, daily()] });
  const context = loadGas(harness.overrides);

  vm.runInContext("setupInstagramSnapshotStore()", context);

  assert.equal(harness.triggerCreateCalls, 0);
  assert.equal(harness.activeTriggers.includes(other), true);
  assert.equal(harness.activeTriggers.length, 2);
  assert.equal(
    harness.activeTriggers.filter((trigger) =>
      trigger.getHandlerFunction() === "runDailyInstagramSnapshot").length,
    1,
  );
  assert.equal(harness.lockHeld, false);
});

test("snapshot setup uses a bounded lock and releases it when setup fails", () => {
  const events = [];
  const sheet = createSheet([snapshotHeaders], "instagram_daily", {
    onGetLastRow() { throw new Error("sheet unavailable"); },
  });
  const harness = createSnapshotHarness({ sheet, events });
  const context = loadGas(harness.overrides);

  assert.throws(
    () => vm.runInContext("setupInstagramSnapshotStore()", context),
    /sheet unavailable/,
  );
  assert.deepEqual(events, [
    { type: "tryLock", timeout: 30000, lockHeld: false },
    { type: "releaseLock", lockHeld: true },
  ]);
  assert.equal(harness.lockHeld, false);
});

test("daily capture appends numeric safe snapshot rows", () => {
  const harness = createSnapshotHarness();
  const context = loadGas(harness.overrides);
  context.__posts = {
    data: [
      {
        id: "post-1",
        timestamp: "2026-07-19T01:02:03Z",
        permalink: "https://example.test/post-1",
        caption: "caption",
        media_type: "VIDEO",
        views: "42",
        reach: 12,
        total_interactions: Number.POSITIVE_INFINITY,
        saved: -1,
        shares: true,
      },
    ],
  };
  context.__fetchPosts = function () {
    harness.events.push({ type: "fetch", lockHeld: harness.lockHeld });
    return context.__posts;
  };
  vm.runInContext(
    "getInstagramPostsWithInsights = function () { return __fetchPosts(); }",
    context,
  );

  const result = vm.runInContext("runDailyInstagramSnapshot()", context);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { snapshotDate: "2026-07-19", rowsAppended: 1 });
  assert.deepEqual(harness.sheet.rows[1], [
    "2026-07-19",
    "post-1",
    "2026-07-19T01:02:03Z",
    "https://example.test/post-1",
    "caption",
    "VIDEO",
    42,
    12,
    0,
    0,
    0,
  ]);
  for (const metric of harness.sheet.rows[1].slice(6)) {
    assert.equal(typeof metric, "number");
    assert.ok(Number.isFinite(metric) && metric >= 0);
  }
  const fetchIndex = harness.events.findIndex((event) => event.type === "fetch");
  const lockedLastRowIndex = harness.events.findIndex((event) =>
    event.type === "lastRow" && event.lockHeld === true);
  assert.ok(fetchIndex >= 0 && lockedLastRowIndex > fetchIndex);
  assert.equal(harness.events[fetchIndex].lockHeld, false);
  assert.equal(
    harness.events.find((event) => event.type === "setValues")?.lockHeld,
    true,
  );
  assert.equal(harness.lockHeld, false);
});

test("daily capture safely stores and exactly restores formula-like snapshot text", () => {
  const dangerous = ["=formula", "+formula", "-formula", "@formula"];
  const harness = createSnapshotHarness();
  const context = loadGas(harness.overrides);
  context.__posts = {
    data: dangerous.map((prefix, index) => ({
      id: `${prefix}-id`,
      timestamp: `${prefix}-timestamp`,
      permalink: `${prefix}-https://example.test/${index}`,
      caption: `${prefix}-caption`,
      media_type: `${prefix}-type`,
      views: index,
      total_interactions: index,
    })),
  };
  vm.runInContext(
    "getInstagramPostsWithInsights = function () { return __posts; }",
    context,
  );

  vm.runInContext("runDailyInstagramSnapshot()", context);

  for (const row of harness.sheet.rows.slice(1)) {
    for (const text of row.slice(1, 6)) {
      assert.doesNotMatch(text, /^[=+\-@]/);
    }
  }

  const startRows = harness.sheet.rows.slice(1).map((row) => [
    "2026-06-01",
    ...row.slice(1, 6),
    0,
    0,
    0,
    0,
    0,
  ]);
  const boundaryRows = harness.sheet.rows.slice(1).map((row, index) => [
    "2026-07-01",
    ...row.slice(1, 6),
    index + 1,
    0,
    index + 1,
    0,
    0,
  ]);
  harness.sheet.rows.splice(1, harness.sheet.rows.length - 1, ...startRows, ...boundaryRows);

  const result = callJsonApi(context, {
    api: "instagram-monthly-ranking",
    month: "2026-06",
    limit: "100",
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.data.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      permalink: item.permalink,
      caption: item.caption,
      media_type: item.media_type,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    dangerous.map((prefix, index) => ({
      id: `${prefix}-id`,
      timestamp: `${prefix}-timestamp`,
      permalink: `${prefix}-https://example.test/${index}`,
      caption: `${prefix}-caption`,
      media_type: `${prefix}-type`,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("daily append releases its bounded lock when the sheet write fails", () => {
  const events = [];
  let lockHeld = false;
  const sheet = createSheet([snapshotHeaders], "instagram_daily", {
    onGetLastRow() { events.push({ type: "lastRow", lockHeld }); },
    onSetValues() { throw new Error("write failed"); },
  });
  const harness = createSnapshotHarness({ sheet, events });
  Object.defineProperty(harness.overrides.LockService, "getScriptLock", {
    value() {
      return {
        tryLock(timeout) {
          events.push({ type: "tryLock", timeout, lockHeld });
          lockHeld = true;
          return true;
        },
        releaseLock() {
          events.push({ type: "releaseLock", lockHeld });
          lockHeld = false;
        },
      };
    },
  });
  const context = loadGas(harness.overrides);
  vm.runInContext(
    "getInstagramPostsWithInsights = function () { return { data: [{ id: 'post-1' }] }; }",
    context,
  );

  assert.throws(
    () => vm.runInContext("runDailyInstagramSnapshot()", context),
    /write failed/,
  );
  assert.deepEqual(events.slice(-3), [
    { type: "tryLock", timeout: 30000, lockHeld: false },
    { type: "lastRow", lockHeld: true },
    { type: "releaseLock", lockHeld: true },
  ]);
  assert.equal(lockHeld, false);
});

test("daily capture fails before calling Instagram for missing store, sheet, schema, or API errors", () => {
  const cases = [
    {
      name: "store",
      harness: createSnapshotHarness({ id: null }),
      expected: /setupInstagramSnapshotStore/,
    },
    {
      name: "sheet",
      harness: createSnapshotHarness({ sheet: null }),
      expected: /instagram_daily.*missing/i,
    },
    {
      name: "schema",
      harness: createSnapshotHarness({ sheet: createSheet([["wrong"]]) }),
      expected: /schema/i,
    },
  ];

  for (const { name, harness, expected } of cases) {
    const context = loadGas(harness.overrides);
    context.__calls = 0;
    vm.runInContext(
      "getInstagramPostsWithInsights = function () { __calls += 1; return { data: [] }; }",
      context,
    );
    assert.throws(
      () => vm.runInContext("runDailyInstagramSnapshot()", context),
      expected,
      name,
    );
    assert.equal(context.__calls, 0);
  }

  const harness = createSnapshotHarness();
  const context = loadGas(harness.overrides);
  context.__posts = { error: "Graph unavailable" };
  vm.runInContext(
    "getInstagramPostsWithInsights = function () { return __posts; }",
    context,
  );
  assert.throws(
    () => vm.runInContext("runDailyInstagramSnapshot()", context),
    /Graph unavailable/,
  );
  assert.equal(harness.sheet.rows.length, 1);
});

test("monthly ranking rejects invalid calendar months and limits before reading the sheet", () => {
  const harness = createSnapshotHarness();
  const context = loadGas(harness.overrides);

  for (const month of ["", "2026-00", "2026-13", "0000-01", "2026-1", "2026/01"]) {
    const result = callJsonApi(context, {
      api: "instagram-monthly-ranking",
      month,
      limit: "3",
    });
    assert.match(result.error, /month must be YYYY-MM/);
  }
  for (const limit of ["0", "-1", "1.5", "101", "abc"]) {
    const result = callJsonApi(context, {
      api: "instagram-monthly-ranking",
      month: "2026-06",
      limit,
    });
    assert.match(result.error, /limit must be a positive integer/);
  }
  assert.equal(harness.openCalls, 0);
});

test("snapshot schema rejects duplicate required headers but accepts a unique extra column", () => {
  const context = loadGas();
  context.__headers = [...snapshotHeaders, "editorNote"];
  assert.doesNotThrow(() =>
    vm.runInContext("validateInstagramSnapshotSchema_(__headers)", context));

  for (const duplicate of snapshotHeaders) {
    context.__headers = [...snapshotHeaders, "editorNote", duplicate];
    assert.throws(
      () => vm.runInContext("validateInstagramSnapshotSchema_(__headers)", context),
      /schema/i,
      duplicate,
    );
  }
});

test("setup and daily capture validate required-header duplicates beyond the base columns", () => {
  for (const operation of ["setupInstagramSnapshotStore", "runDailyInstagramSnapshot"]) {
    const sheet = createSheet([[...snapshotHeaders, "editorNote", "caption"]]);
    const harness = createSnapshotHarness({ sheet });
    const context = loadGas(harness.overrides);
    context.__calls = 0;
    vm.runInContext(
      "getInstagramPostsWithInsights = function () { __calls += 1; return { data: [] }; }",
      context,
    );

    assert.throws(
      () => vm.runInContext(`${operation}()`, context),
      /schema/i,
      operation,
    );
    assert.equal(context.__calls, 0);
  }
});

test("monthly ranking calculates Gregorian boundaries for years 0001 through 0099", () => {
  for (const expected of [
    {
      month: "0001-01",
      boundary: "0001-02-01",
      end: "0001-01-31",
    },
    {
      month: "0099-12",
      boundary: "0100-01-01",
      end: "0099-12-31",
    },
  ]) {
    const sheet = createSheet([
      snapshotHeaders,
      [`${expected.month}-01`, "post", "", "", "", "VIDEO", 0, 0, 0, 0, 0],
      [expected.boundary, "post", "", "", "", "VIDEO", 1, 0, 1, 0, 0],
    ]);
    const context = loadGas(createSnapshotHarness({ sheet }).overrides);
    const result = callJsonApi(context, {
      api: "instagram-monthly-ranking",
      month: expected.month,
      limit: "3",
    });

    assert.equal(result.error, undefined, expected.month);
    assert.equal(result.period.boundarySnapshotDate, expected.boundary);
    assert.equal(result.period.endDate, expected.end);
  }
});

test("monthly ranking requires the sheet schema and both exact boundary dates", () => {
  for (const { rows, expected } of [
    { rows: [["wrong"]], expected: /schema/i },
    { rows: [snapshotHeaders], expected: /boundary snapshots/i },
    {
      rows: [
        snapshotHeaders,
        ["2026-05-31", "post", "2026-01-01T00:00:00Z", "", "", "VIDEO", 0, 0, 0, 0, 0],
        ["2026-06-02", "post", "2026-01-01T00:00:00Z", "", "", "VIDEO", 10, 0, 0, 0, 0],
        ["2026-06-30", "post", "2026-01-01T00:00:00Z", "", "", "VIDEO", 20, 0, 0, 0, 0],
        ["2026-07-02", "post", "2026-01-01T00:00:00Z", "", "", "VIDEO", 30, 0, 0, 0, 0],
      ],
      expected: /boundary snapshots/i,
    },
  ]) {
    const context = loadGas(createSnapshotHarness({ sheet: createSheet(rows) }).overrides);
    const result = callJsonApi(context, {
      api: "instagram-monthly-ranking",
      month: "2026-06",
      limit: "3",
    });
    assert.match(result.error, expected);
  }

  const context = loadGas(createSnapshotHarness({ sheet: null }).overrides);
  const result = callJsonApi(context, {
    api: "instagram-monthly-ranking",
    month: "2026-06",
    limit: "3",
  });
  assert.match(result.error, /instagram_daily.*missing/i);
});

test("monthly ranking uses latest duplicate rows, safe deltas, exact instants, and deterministic ids", () => {
  const row = (date, id, timestamp, views, interactions) => [
    date,
    id,
    timestamp,
    `https://example.test/${id}`,
    `caption ${id}`,
    "VIDEO",
    views,
    0,
    interactions,
    0,
    0,
  ];
  const sheet = createSheet([
    snapshotHeaders,
    row("2026-06-01", "duplicate", "2026-06-15T00:00:00Z", 10, 1),
    row("2026-06-01", "duplicate", "2026-06-15T00:00:00Z", 100, 20),
    row("2026-07-01", "duplicate", "2026-06-15T00:00:00Z", 130, 25),
    row("2026-07-01", "duplicate", "2026-06-15T00:00:00Z", 160, 30),
    row("2026-06-01", "a", "2026-01-01T00:00:00Z", 0, 0),
    row("2026-07-01", "a", "2026-06-20T09:00:00+09:00", 60, 10),
    row("2026-06-01", "z", "2026-01-01T00:00:00Z", 0, 0),
    row("2026-07-01", "z", "2026-06-20T00:00:00Z", 60, 10),
    row("2026-06-01", "malformed", "2026-01-01T00:00:00Z", "bad", -1),
    row("2026-07-01", "malformed", "2026-06-10T00:00:00Z", "50", false),
    row("2026-06-01", "decrease", "2026-01-01T00:00:00Z", 100, 8),
    row("2026-07-01", "decrease", "2026-06-01T00:00:00Z", 90, 3),
    row("2026-06-01", "start-only", "2026-01-01T00:00:00Z", 999, 999),
    row("2026-07-01", "end-only", "2026-06-30T00:00:00Z", 999, 999),
  ]);
  const context = loadGas(createSnapshotHarness({ sheet }).overrides);
  vm.runInContext(
    "String.prototype.localeCompare = function () { throw new Error('locale compare used'); }",
    context,
  );

  const result = callJsonApi(context, {
    api: "instagram-monthly-ranking",
    month: "2026-06",
    limit: "100",
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.data.map((item) => item.id), [
    "z",
    "a",
    "duplicate",
    "malformed",
    "decrease",
  ]);
  assert.equal(result.data.filter((item) => item.id === "duplicate").length, 1);
  assert.deepEqual(
    result.data.map((item) => [item.viewsDelta, item.totalInteractionsDelta]),
    [[60, 10], [60, 10], [60, 10], [50, 0], [0, 0]],
  );
  assert.deepEqual(result.period, {
    month: "2026-06",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    timezone: "Asia/Tokyo",
    boundarySnapshotDate: "2026-07-01",
  });
  assert.equal(result.partial, false);
});
