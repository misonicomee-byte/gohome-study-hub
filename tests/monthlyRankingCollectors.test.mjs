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

test("YouTube ranks all historical Shorts by exact monthly metrics", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.hostname === "youtubeanalytics.googleapis.com" && parsed.pathname === "/v2/reports") {
      return jsonResponse({ rows: [
        ["a", 100, 30],
        ["b", 120, 20],
        ["c", 100, 40],
        ["d", 20, 10],
      ] });
    }
    return jsonResponse({ items: ["a", "b", "c", "d"].map((id) => ({
      id,
      snippet: { title: id, publishedAt: "2026-01-01T00:00:00Z" },
    })) });
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
    dimensions: "video",
    filters: "creatorContentType==SHORTS",
    sort: "-views,-engagedViews",
    maxResults: "50",
  });
});

test("YouTube breaks equal monthly metrics by newest publish date then video id", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [["a", 100, 20], ["c", 100, 20], ["b", 100, 20]] });
    }
    return jsonResponse({ items: [
      { id: "a", snippet: { title: "a", publishedAt: "2025-01-01T00:00:00Z" } },
      { id: "b", snippet: { title: "b", publishedAt: "2025-02-01T00:00:00Z" } },
      { id: "c", snippet: { title: "c", publishedAt: "2025-02-01T00:00:00Z" } },
    ] });
  };

  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });

  assert.deepEqual(result.items.map((item) => item.contentId), ["c", "b", "a"]);
});

test("YouTube fails closed when API responses cannot produce three valid items", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [["a", "not-a-number", 10], ["b", 20, 10], ["c", 10, 5]] });
    }
    return jsonResponse({ items: [
      { id: "a", snippet: { title: "a", publishedAt: "2026-01-01T00:00:00Z" } },
      { id: "b", snippet: { title: "b", publishedAt: "2026-01-01T00:00:00Z" } },
      { id: "c", snippet: { title: "c", publishedAt: "2026-01-01T00:00:00Z" } },
    ] });
  };

  await assert.rejects(
    collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
    /finite.*metrics/i,
  );
});

test("YouTube reports API status without exposing the access token", async () => {
  const accessToken = "secret-access-token";
  const fetchImpl = async () => jsonResponse({}, { ok: false, status: 429 });

  await assert.rejects(
    collectYouTubeRanking({ accessToken, channelId: "UCtest", period, fetchImpl }),
    (error) => error.message.includes("status=429") && !error.message.includes(accessToken),
  );
});
