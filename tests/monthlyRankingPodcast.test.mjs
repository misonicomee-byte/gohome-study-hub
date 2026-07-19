import assert from "node:assert/strict";
import test from "node:test";

import { collectPodcastRanking } from "../scripts/monthly-ranking-data/podcast.mjs";

const period = {
  month: "2026-06",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  timezone: "Asia/Tokyo",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function textResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => body };
}

function rssItem({ id, title = `Episode ${id}`, date = "Mon, 01 Jun 2026 00:00:00 GMT", image = true }) {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <link>https://podcasters.spotify.com/pod/show/go-ito/episodes/${id}</link>
    <guid isPermaLink="false">guid-${id}</guid>
    <pubDate>${date}</pubDate>
    ${image ? `<itunes:image href="https://d3t3ozftmdmh3i.cloudfront.net/${id}.jpg"/>` : ""}
  </item>`;
}

function rss(items) {
  return `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
    <itunes:image href="https://d3t3ozftmdmh3i.cloudfront.net/channel.jpg"/>
    ${items.join("\n")}
  </channel></rss>`;
}

function podcastRows(ids = ["a", "b", "c", "d"]) {
  const numbers = { a: 101, b: 102, c: 103, d: 104, missing: 999 };
  return ids.map((id, index) => ({
    id,
    youtubeId: id,
    title: `${numbers[id] ?? 900 + index} YouTube ${id}`,
    date: "2026-01-01",
    url: `https://www.youtube.com/watch?v=${id}`,
  }));
}

function details(ids, published = {}) {
  const numbers = { a: 101, b: 102, c: 103, d: 104, missing: 999 };
  return ids.map((id) => ({
    id,
    snippet: { title: `${numbers[id] ?? 900} YouTube ${id}`, publishedAt: published[id] ?? "2026-01-01T00:00:00Z" },
  }));
}

test("Podcast ranks all listed YouTube episodes by monthly views and uses canonical RSS metadata", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.searchParams.get("api") === "podcast-list") {
      return jsonResponse({ data: podcastRows(), count: 4 });
    }
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [
        ["unrelated", "VIDEO_ON_DEMAND", 999, 999],
        ["a", "VIDEO_ON_DEMAND", 100, 20],
        ["b", "VIDEO_ON_DEMAND", 100, 20],
        ["c", "VIDEO_ON_DEMAND", 100, 21],
      ] });
    }
    if (parsed.hostname === "www.googleapis.com") {
      const ids = parsed.searchParams.get("id").split(",");
      return jsonResponse({ items: details(ids, {
        a: "2026-02-01T00:00:00Z",
        b: "2026-02-02T00:00:00Z",
        c: "2026-01-01T00:00:00Z",
      }) });
    }
    if (parsed.hostname === "anchor.fm") {
      return textResponse(rss([
        rssItem({ id: "a", title: "101 正式タイトル A" }),
        rssItem({ id: "b", title: "102 正式タイトル B", image: false }),
        rssItem({ id: "c", title: "103 正式タイトル C" }),
        rssItem({ id: "d", title: "104 正式タイトル D" }),
      ]));
    }
    throw new Error(`unexpected URL ${parsed}`);
  };

  const result = await collectPodcastRanking({
    accessToken: "test-token",
    channelId: "UCtest",
    gasUrl: "https://example.test/exec?ignored=yes",
    rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss",
    period,
    fetchImpl,
  });

  assert.deepEqual(result.items.map((item) => item.contentId), ["c", "b", "a"]);
  assert.deepEqual(result.items.map((item) => item.title), ["103 正式タイトル C", "102 正式タイトル B", "101 正式タイトル A"]);
  assert.equal(result.items[0].url, "https://podcasters.spotify.com/pod/show/go-ito/episodes/c");
  assert.equal(result.items[0].imageUrl, "https://d3t3ozftmdmh3i.cloudfront.net/c.jpg");
  assert.equal(result.items[1].imageUrl, "https://d3t3ozftmdmh3i.cloudfront.net/channel.jpg");
  assert.equal(result.items[0].metricValue, 100);
  assert.equal(result.items[0].secondaryMetricValue, 21);
  assert.equal(result.items[0].episodeGuid, "guid-c");
  assert.equal(result.rankingMetric, "views");
  assert.equal(result.rankingLabel, "前月（2026-06）増加再生数（YouTube Analytics・太平洋時間）");
  assert.equal(result.reportingTimezone, "America/Los_Angeles");
  assert.deepEqual(Object.fromEntries(requests.find((url) => url.hostname === "youtubeanalytics.googleapis.com").searchParams), {
    ids: "channel==UCtest",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    metrics: "views,engagedViews",
    dimensions: "video,creatorContentType",
    sort: "-views,-engagedViews",
    maxResults: "200",
    startIndex: "1",
  });
  assert.equal(requests.find((url) => url.searchParams.get("api") === "podcast-list").search, "?api=podcast-list");
});

test("Podcast treats listed episodes absent from Analytics as zero views", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("api") === "podcast-list") return jsonResponse({ data: podcastRows(["a", "b", "c"]), count: 3 });
    if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows: [] });
    if (parsed.hostname === "www.googleapis.com") return jsonResponse({ items: details(parsed.searchParams.get("id").split(",")) });
    return textResponse(rss([
      rssItem({ id: "a", title: "101 YouTube a" }),
      rssItem({ id: "b", title: "102 YouTube b" }),
      rssItem({ id: "c", title: "103 YouTube c" }),
    ]));
  };
  const result = await collectPodcastRanking({
    accessToken: "test", channelId: "UCtest", gasUrl: "https://example.test/exec",
    rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss", period, fetchImpl,
  });
  assert.deepEqual(result.items.map(({ metricValue }) => metricValue), [0, 0, 0]);
});

test("Podcast fails closed for truncated lists, fewer than three episodes, or unmatched top RSS metadata", async (t) => {
  for (const fixture of [
    { payload: { data: podcastRows(), count: 3, totalCount: 4, truncated: true }, expected: /truncated/i },
    { payload: { data: podcastRows(["a", "b"]), count: 2 }, expected: /fewer than 3/i },
    { payload: { data: podcastRows(["a", "b", "missing"]), count: 3 }, expected: /RSS metadata.*missing/i },
  ]) {
    await t.test(String(fixture.expected), async () => {
      const fetchImpl = async (url) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("api") === "podcast-list") return jsonResponse(fixture.payload);
        if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows: [] });
        if (parsed.hostname === "www.googleapis.com") return jsonResponse({ items: details(parsed.searchParams.get("id").split(",")) });
        return textResponse(rss([
          rssItem({ id: "a", title: "101 YouTube a" }),
          rssItem({ id: "b", title: "102 YouTube b" }),
          rssItem({ id: "c", title: "103 YouTube c" }),
        ]));
      };
      await assert.rejects(
        collectPodcastRanking({
          accessToken: "test", channelId: "UCtest", gasUrl: "https://example.test/exec",
          rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss", period, fetchImpl,
        }),
        fixture.expected,
      );
    });
  }
});

test("Podcast rejects unsafe canonical RSS links and images", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("api") === "podcast-list") return jsonResponse({ data: podcastRows(["a", "b", "c"]), count: 3 });
    if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows: [] });
    if (parsed.hostname === "www.googleapis.com") return jsonResponse({ items: details(parsed.searchParams.get("id").split(",")) });
    return textResponse(rss([
      rssItem({ id: "a", title: "101 YouTube a" }).replace("https://podcasters.spotify.com", "https://evil.example"),
      rssItem({ id: "b", title: "102 YouTube b" }), rssItem({ id: "c", title: "103 YouTube c" }),
    ]));
  };
  await assert.rejects(
    collectPodcastRanking({
      accessToken: "test", channelId: "UCtest", gasUrl: "https://example.test/exec",
      rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss", period, fetchImpl,
    }),
    /Spotify|RSS/i,
  );
});

test("Podcast rejects an unfinished reporting period before contacting GAS, YouTube, or RSS", async () => {
  let requests = 0;
  await assert.rejects(collectPodcastRanking({
    accessToken: "test",
    channelId: "UCtest",
    gasUrl: "https://example.test/exec",
    rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss",
    period,
    now: new Date("2026-07-03T12:00:00Z"),
    fetchImpl: async () => { requests += 1; return jsonResponse({}); },
  }), /reporting lag/i);
  assert.equal(requests, 0);
});

test("Podcast requires GAS and YouTube titles to identify the same unique RSS episode", async (t) => {
  for (const [label, mutateRows, mutateDetails, expected] of [
    ["GAS and YouTube mismatch", (rows) => rows, (items) => items.map((item) => item.id === "b"
      ? { ...item, snippet: { ...item.snippet, title: "101 Wrong episode" } }
      : item), /identity mismatch/i],
    ["duplicate RSS assignment", (rows) => rows.map((row) => row.youtubeId === "b"
      ? { ...row, title: "101 Duplicate episode" }
      : row), (items) => items.map((item) => item.id === "b"
      ? { ...item, snippet: { ...item.snippet, title: "101 Duplicate episode" } }
      : item), /duplicate.*RSS episode/i],
  ]) {
    await t.test(label, async () => {
      const fetchImpl = async (url) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("api") === "podcast-list") {
          const rows = mutateRows(podcastRows(["a", "b", "c"]));
          return jsonResponse({ data: rows, count: rows.length });
        }
        if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows: [] });
        if (parsed.hostname === "www.googleapis.com") {
          return jsonResponse({ items: mutateDetails(details(parsed.searchParams.get("id").split(","))) });
        }
        return textResponse(rss([
          rssItem({ id: "a", title: "101 YouTube a" }),
          rssItem({ id: "b", title: "102 YouTube b" }),
          rssItem({ id: "c", title: "103 YouTube c" }),
        ]));
      };
      await assert.rejects(collectPodcastRanking({
        accessToken: "test", channelId: "UCtest", gasUrl: "https://example.test/exec",
        rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss", period, fetchImpl,
      }), expected);
    });
  }
});

test("Podcast rejects duplicate YouTube IDs, RSS GUIDs, and canonical Spotify episode URLs", async (t) => {
  for (const [label, rows, items, expected] of [
    ["YouTube ID", [...podcastRows(["a", "b"]), podcastRows(["a"])[0]], [
      rssItem({ id: "a", title: "101 YouTube a" }), rssItem({ id: "b", title: "102 YouTube b" }), rssItem({ id: "c", title: "103 YouTube c" }),
    ], /invalid episode/i],
    ["RSS GUID", podcastRows(["a", "b", "c"]), [
      rssItem({ id: "a", title: "101 YouTube a" }), rssItem({ id: "a", title: "102 YouTube b" }).replace("/episodes/a", "/episodes/b"), rssItem({ id: "c", title: "103 YouTube c" }),
    ], /duplicate guid/i],
    ["Spotify URL", podcastRows(["a", "b", "c"]), [
      rssItem({ id: "a", title: "101 YouTube a" }), rssItem({ id: "b", title: "102 YouTube b" }).replace("/episodes/b", "/episodes/a"), rssItem({ id: "c", title: "103 YouTube c" }),
    ], /duplicate.*Spotify/i],
  ]) {
    await t.test(label, async () => {
      const fetchImpl = async (url) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("api") === "podcast-list") return jsonResponse({ data: rows, count: rows.length });
        if (parsed.hostname === "youtubeanalytics.googleapis.com") return jsonResponse({ rows: [] });
        if (parsed.hostname === "www.googleapis.com") return jsonResponse({ items: details(parsed.searchParams.get("id").split(",")) });
        return textResponse(rss(items));
      };
      await assert.rejects(collectPodcastRanking({
        accessToken: "test", channelId: "UCtest", gasUrl: "https://example.test/exec",
        rssUrl: "https://anchor.fm/s/10da34b80/podcast/rss", period, fetchImpl,
      }), expected);
    });
  }
});
