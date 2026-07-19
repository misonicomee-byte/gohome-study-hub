import assert from "node:assert/strict";
import test from "node:test";
import { collectYouTubeRanking } from "../scripts/monthly-ranking-data/youtube.mjs";

const period = {
  month: "2026-06",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  timezone: "Asia/Tokyo",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function detail(id, publishedAt = "2026-01-01T00:00:00Z") {
  return { id, snippet: { title: id, publishedAt } };
}

function detailsForRequest(url, publishedAtById = new Map()) {
  const ids = new URL(url).searchParams.get("id").split(",");
  return jsonResponse({ items: ids.map((id) => detail(id, publishedAtById.get(id))) });
}

test("YouTube requests the video and creatorContentType dimensions and keeps only Shorts", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [
        ["not-a-short", "VIDEO_ON_DEMAND", 999, 999],
        ["a", "SHORTS", 100, 30],
        ["b", "SHORTS", 120, 20],
        ["c", "SHORTS", 100, 40],
        ["d", "SHORTS", 20, 10],
      ] });
    }
    return detailsForRequest(url);
  };

  const result = await collectYouTubeRanking({
    accessToken: "test-token",
    channelId: "UCtest",
    period,
    fetchImpl,
  });

  assert.deepEqual(result.items.map((item) => item.contentId), ["b", "c", "a"]);
  assert.equal(result.items.length, 3);
  assert.equal(requests.length, 2);
  assert.deepEqual(Object.fromEntries(requests[0].searchParams), {
    ids: "channel==UCtest",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    metrics: "views,engagedViews",
    dimensions: "video,creatorContentType",
    sort: "-views,-engagedViews",
    maxResults: "200",
    startIndex: "1",
  });
  assert.equal(requests[1].searchParams.get("id"), "a,b,c,d");
});

test("YouTube breaks equal monthly metrics by newest publish date then video id", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [
        ["a", "SHORTS", 100, 20],
        ["c", "SHORTS", 100, 20],
        ["b", "SHORTS", 100, 20],
      ] });
    }
    return jsonResponse({ items: [
      detail("a", "2025-01-01T00:00:00Z"),
      detail("b", "2025-02-01T00:00:00Z"),
      detail("c", "2025-02-01T00:00:00Z"),
    ] });
  };

  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });

  assert.deepEqual(result.items.map((item) => item.contentId), ["c", "b", "a"]);
});

test("YouTube fetches every Analytics page before resolving boundary ties", async () => {
  const analyticsStarts = [];
  const metadataBatchSizes = [];
  const firstPage = Array.from({ length: 200 }, (_, index) => [
    `video-${String(index).padStart(3, "0")}`,
    "SHORTS",
    100,
    20,
  ]);
  const publishedAtById = new Map([["page-two-winner", "2026-02-01T00:00:00Z"]]);

  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      const startIndex = Number(parsed.searchParams.get("startIndex"));
      analyticsStarts.push(startIndex);
      return jsonResponse({ rows: startIndex === 1
        ? firstPage
        : [["page-two-winner", "SHORTS", 100, 20]] });
    }
    const ids = parsed.searchParams.get("id").split(",");
    metadataBatchSizes.push(ids.length);
    return jsonResponse({ items: ids.map((id) => detail(id, publishedAtById.get(id))) });
  };

  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });

  assert.deepEqual(analyticsStarts, [1, 201]);
  assert.deepEqual(metadataBatchSizes, [50, 50, 50, 50, 1]);
  assert.deepEqual(result.items.map((item) => item.contentId), [
    "page-two-winner",
    "video-199",
    "video-198",
  ]);
});

test("YouTube batches Data API metadata requests at 50 video ids", async () => {
  const metadataBatchSizes = [];
  const rows = Array.from({ length: 51 }, (_, index) => [
    `video-${String(index).padStart(2, "0")}`,
    "SHORTS",
    51 - index,
    0,
  ]);
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows });
    const ids = parsed.searchParams.get("id").split(",");
    metadataBatchSizes.push(ids.length);
    return jsonResponse({ items: ids.map((id) => detail(id)) });
  };

  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });

  assert.deepEqual(metadataBatchSizes, [50, 1]);
  assert.deepEqual(result.items.map((item) => item.contentId), ["video-00", "video-01", "video-02"]);
});

test("YouTube rejects duplicate Analytics video ids without paginating forever", async () => {
  let analyticsRequests = 0;
  const repeatedPage = Array.from({ length: 200 }, (_, index) => [
    `video-${index}`,
    "SHORTS",
    200 - index,
    0,
  ]);
  const fetchImpl = async (url) => {
    if (new URL(url).hostname === "youtubeanalytics.googleapis.com") {
      analyticsRequests += 1;
      return jsonResponse({ rows: repeatedPage });
    }
    throw new Error("metadata must not be requested");
  };

  await assert.rejects(
    collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
    /duplicate.*video/i,
  );
  assert.equal(analyticsRequests, 2);
});

test("YouTube rejects metrics unless they are actual non-negative finite numbers", async (t) => {
  for (const metric of [null, "", "10", true, false, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await t.test(`metric=${String(metric)}`, async () => {
      const fetchImpl = async () => jsonResponse({ rows: [
        ["a", "SHORTS", metric, 10],
        ["b", "SHORTS", 20, 10],
        ["c", "SHORTS", 10, 5],
      ] });

      await assert.rejects(
        collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
        /non-negative finite.*metric/i,
      );
    });
  }
});

test("YouTube rejects malformed Analytics payloads and rows", async (t) => {
  const malformedBodies = [
    null,
    [],
    {},
    { rows: null },
    { rows: {} },
    { rows: [["", "SHORTS", 10, 5], ["b", "SHORTS", 9, 4], ["c", "SHORTS", 8, 3]] },
    { rows: [["a", null, 10, 5], ["b", "SHORTS", 9, 4], ["c", "SHORTS", 8, 3]] },
    { rows: [["a", "SHORTS", 10], ["b", "SHORTS", 9, 4], ["c", "SHORTS", 8, 3]] },
  ];

  for (const [index, body] of malformedBodies.entries()) {
    await t.test(`payload ${index + 1}`, async () => {
      await assert.rejects(
        collectYouTubeRanking({
          accessToken: "test",
          channelId: "UCtest",
          period,
          fetchImpl: async () => jsonResponse(body),
        }),
        /invalid Analytics/i,
      );
    });
  }
});

test("YouTube fails closed on missing or duplicate video metadata", async (t) => {
  const analyticsBody = { rows: [
    ["a", "SHORTS", 30, 10],
    ["b", "SHORTS", 20, 10],
    ["c", "SHORTS", 10, 5],
  ] };
  const metadataBodies = [
    { items: [detail("a"), detail("b")] },
    { items: [detail("a"), detail("b"), detail("b"), detail("c")] },
  ];

  for (const [index, metadataBody] of metadataBodies.entries()) {
    await t.test(index === 0 ? "missing metadata" : "duplicate metadata", async () => {
      const fetchImpl = async (url) => new URL(url).hostname === "youtubeanalytics.googleapis.com"
        ? jsonResponse(analyticsBody)
        : jsonResponse(metadataBody);

      await assert.rejects(
        collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
        /(missing|duplicate).*metadata/i,
      );
    });
  }
});

test("YouTube rejects malformed Data API payloads", async (t) => {
  const analyticsBody = { rows: [
    ["a", "SHORTS", 30, 10],
    ["b", "SHORTS", 20, 10],
    ["c", "SHORTS", 10, 5],
  ] };
  for (const metadataBody of [null, [], {}, { items: null }]) {
    await t.test(`payload=${JSON.stringify(metadataBody)}`, async () => {
      const fetchImpl = async (url) => new URL(url).hostname === "youtubeanalytics.googleapis.com"
        ? jsonResponse(analyticsBody)
        : jsonResponse(metadataBody);

      await assert.rejects(
        collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
        /invalid video metadata/i,
      );
    });
  }
});

test("YouTube reports API status without exposing the access token", async () => {
  const accessToken = "secret-access-token";
  const fetchImpl = async () => jsonResponse({}, { ok: false, status: 429 });

  await assert.rejects(
    collectYouTubeRanking({ accessToken, channelId: "UCtest", period, fetchImpl }),
    (error) => error.message.includes("status=429") && !error.message.includes(accessToken),
  );
});
