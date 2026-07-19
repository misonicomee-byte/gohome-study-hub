import assert from "node:assert/strict";
import test from "node:test";
import { collectBlogRanking } from "../scripts/monthly-ranking-data/blog.mjs";
import { collectInstagramRanking } from "../scripts/monthly-ranking-data/instagram.mjs";
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

test("YouTube orders RFC3339 offsets by instant, then equal instants by video id", async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [
        ["a", "SHORTS", 100, 20],
        ["z", "SHORTS", 100, 20],
        ["b", "SHORTS", 100, 20],
      ] });
    }
    return jsonResponse({ items: [
      detail("a", "2026-02-01T09:00:00+09:00"),
      detail("z", "2026-02-01T00:00:00Z"),
      detail("b", "2026-02-01T00:00:01Z"),
    ] });
  };

  const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });

  assert.deepEqual(result.items.map((item) => item.contentId), ["b", "z", "a"]);
});

test("YouTube tie breaks use deterministic code-unit ordering", async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).hostname === "youtubeanalytics.googleapis.com") {
      return jsonResponse({ rows: [
        ["Z", "SHORTS", 100, 20],
        ["a", "SHORTS", 100, 20],
        ["z", "SHORTS", 100, 20],
      ] });
    }
    return jsonResponse({ items: [
      detail("Z", "2026-02-01T00:00:00Z"),
      detail("a", "2026-02-01T00:00:00Z"),
      detail("z", "2026-02-01T00:00:00Z"),
    ] });
  };
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error("locale-dependent comparison used"); };
  try {
    const result = await collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl });
    assert.deepEqual(result.items.map((item) => item.contentId), ["z", "a", "Z"]);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
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

test("YouTube rejects date-prefixed junk and invalid publication timestamps", async (t) => {
  const analyticsBody = { rows: [
    ["a", "SHORTS", 30, 10],
    ["b", "SHORTS", 20, 10],
    ["c", "SHORTS", 10, 5],
  ] };
  const invalidPublishedAt = [
    "2026-01-01",
    "2026-01-01not-a-timestamp",
    "2026-01-01T00:00:00Z trailing",
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+99:00",
  ];

  for (const publishedAt of invalidPublishedAt) {
    await t.test(publishedAt, async () => {
      const fetchImpl = async (url) => new URL(url).hostname === "youtubeanalytics.googleapis.com"
        ? jsonResponse(analyticsBody)
        : jsonResponse({ items: [detail("a", publishedAt), detail("b"), detail("c")] });

      await assert.rejects(
        collectYouTubeRanking({ accessToken: "test", channelId: "UCtest", period, fetchImpl }),
        /invalid details/i,
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

function blogPost(id, pageViews, totalUsers, date = "2026-06-01") {
  return {
    url: `https://gohome-clinic.com/${date.replaceAll("-", "/")}/${id}/`,
    title: `blog ${id}`,
    date,
    pageViews,
    totalUsers,
  };
}

test("blog requests exact month boundaries and sorts all tie breakers deterministically", async () => {
  let requested;
  const fetchImpl = async (url) => {
    requested = new URL(url);
    return jsonResponse({
      period: { startDate: "2026-06-01", endDate: "2026-06-30" },
      data: [
        blogPost("old", 10, 5, "2026-05-01"),
        blogPost("a", 10, 5, "2026-06-20"),
        blogPost("z", 10, 5, "2026-06-20"),
        blogPost("users", 10, 6, "2026-01-01"),
      ],
    });
  };

  const result = await collectBlogRanking({
    gasUrl: "https://example.test/exec?ignored=yes",
    period,
    fetchImpl,
  });

  assert.deepEqual(Object.fromEntries(requested.searchParams), {
    api: "blog-ranking",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    limit: "100",
  });
  assert.deepEqual(result.items.map((item) => item.contentId), [
    blogPost("users", 0, 0, "2026-01-01").url,
    blogPost("z", 0, 0, "2026-06-20").url,
    blogPost("a", 0, 0, "2026-06-20").url,
  ]);
  assert.equal(result.rankingMetric, "screenPageViews");
  assert.equal(result.items.length, 3);
});

test("blog requires an exact response period and three valid unique items", async (t) => {
  const valid = {
    period: { startDate: period.startDate, endDate: period.endDate },
    data: [blogPost("a", 3, 1), blogPost("b", 2, 1), blogPost("c", 1, 1)],
  };
  const invalidBodies = [
    null,
    {},
    { ...valid, period: { startDate: "2026-06-02", endDate: period.endDate } },
    { ...valid, period: { ...valid.period, month: "2026-05" } },
    { ...valid, period: { ...valid.period, timezone: "UTC" } },
    { ...valid, data: valid.data.slice(0, 2) },
    { ...valid, data: [valid.data[0], valid.data[0], valid.data[2]] },
    { ...valid, data: [{ ...valid.data[0], pageViews: "3" }, ...valid.data.slice(1)] },
    { ...valid, data: [{ ...valid.data[0], date: "2026-02-30" }, ...valid.data.slice(1)] },
    { ...valid, data: [{ ...valid.data[0], url: "javascript:alert(1)" }, ...valid.data.slice(1)] },
  ];

  for (const [index, body] of invalidBodies.entries()) {
    await t.test(`invalid payload ${index + 1}`, async () => {
      await assert.rejects(
        collectBlogRanking({ gasUrl: "https://example.test/exec", period, fetchImpl: async () => jsonResponse(body) }),
        /(payload|period|fewer|duplicate|metric|date|url)/i,
      );
    });
  }
});

function instagramPost(id, {
  timestamp = "2026-06-10T00:00:00Z",
  viewsDelta = 10,
  totalInteractionsDelta = 2,
  views = 100,
  totalInteractions = 20,
} = {}) {
  return {
    id,
    caption: `caption ${id}\nmore`,
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp,
    viewsDelta,
    totalInteractionsDelta,
    views,
    total_interactions: totalInteractions,
  };
}

const exactInstagramPeriod = {
  ...period,
  boundarySnapshotDate: "2026-07-01",
};

test("Instagram exact mode validates the month and sorts by delta, instant, then id", async () => {
  let requested;
  const fetchImpl = async (url) => {
    requested = new URL(url);
    return jsonResponse({
      period: exactInstagramPeriod,
      partial: false,
      data: [
        instagramPost("a", { timestamp: "2026-06-20T09:00:00+09:00" }),
        instagramPost("z", { timestamp: "2026-06-20T00:00:00Z" }),
        instagramPost("winner", { viewsDelta: 11, timestamp: "2026-01-01T00:00:00Z" }),
      ],
    });
  };

  const result = await collectInstagramRanking({ gasUrl: "https://example.test/exec", period, fetchImpl });

  assert.deepEqual(Object.fromEntries(requested.searchParams), {
    api: "instagram-monthly-ranking",
    month: "2026-06",
    limit: "3",
  });
  assert.deepEqual(result.items.map((item) => item.contentId), ["winner", "z", "a"]);
  assert.equal(result.rankingMetric, "viewsDelta");
  assert.equal(result.rankingMode, "exactMonthlyDelta");
  assert.match(result.rankingLabel, /views.*増加/i);
});

test("Instagram explicit partial response uses the initial published-month current-views fallback", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.searchParams.get("api") === "instagram-monthly-ranking") {
      return jsonResponse({ partial: true, data: [] });
    }
    return jsonResponse({ data: [
      instagramPost("before", { timestamp: "2026-05-31T14:59:59Z", views: 999 }),
      instagramPost("a", { timestamp: "2026-06-20T09:00:00+09:00", views: 100, totalInteractions: 20 }),
      instagramPost("z", { timestamp: "2026-06-20T00:00:00Z", views: 100, totalInteractions: 20 }),
      instagramPost("winner", { timestamp: "2026-06-01T00:00:00+09:00", views: 101 }),
      instagramPost("after", { timestamp: "2026-06-30T15:00:00Z", views: 999 }),
    ] });
  };

  const result = await collectInstagramRanking({ gasUrl: "https://example.test/exec", period, fetchImpl });

  assert.equal(requests.length, 2);
  assert.deepEqual(Object.fromEntries(requests[1].searchParams), { api: "instagram-posts", limit: "100" });
  assert.deepEqual(result.items.map((item) => item.contentId), ["winner", "z", "a"]);
  assert.equal(result.rankingMetric, "currentViewsOfPostsPublishedInMonth");
  assert.equal(result.rankingMode, "initialPublishedMonthCurrentViews");
  assert.match(result.rankingLabel, /現在views/i);
  assert.match(result.rankingLabel, /初回限定/);
  assert.match(result.rankingLabel, /増加数ではありません/);
});

test("Instagram falls back only for known unavailable boundary errors", async (t) => {
  const knownMessages = [
    "Instagram snapshot store is not configured",
    "Instagram snapshot sheet schema is missing",
    "instagram_daily snapshot sheet is missing",
    "Complete month boundary snapshots are required",
  ];
  for (const message of knownMessages) {
    await t.test(message, async () => {
      let requests = 0;
      const fetchImpl = async () => {
        requests += 1;
        return requests === 1
          ? jsonResponse({ error: message })
          : jsonResponse({ data: [instagramPost("a"), instagramPost("b"), instagramPost("c")] });
      };
      const result = await collectInstagramRanking({ gasUrl: "https://example.test/exec", period, fetchImpl });
      assert.equal(result.rankingMode, "initialPublishedMonthCurrentViews");
      assert.equal(requests, 2);
    });
  }

  for (const failure of [
    { response: jsonResponse({ error: "Meta API authentication failed" }), expected: /authentication/i },
    { response: jsonResponse({}, { ok: false, status: 503 }), expected: /status=503/i },
  ]) {
    await t.test(String(failure.expected), async () => {
      let requests = 0;
      await assert.rejects(
        collectInstagramRanking({
          gasUrl: "https://example.test/exec",
          period,
          fetchImpl: async () => { requests += 1; return failure.response; },
        }),
        failure.expected,
      );
      assert.equal(requests, 1);
    });
  }
});

test("Instagram exact mode fails closed on partial markers, periods, fields, and IDs", async (t) => {
  const valid = {
    period: exactInstagramPeriod,
    partial: false,
    data: [instagramPost("a"), instagramPost("b"), instagramPost("c")],
  };
  const invalidBodies = [
    { ...valid, partial: undefined },
    { ...valid, partial: "false" },
    { ...valid, period: { ...exactInstagramPeriod, month: "2026-05" } },
    { ...valid, data: valid.data.slice(0, 2) },
    { ...valid, data: [valid.data[0], valid.data[0], valid.data[2]] },
    { ...valid, data: [{ ...valid.data[0], viewsDelta: "10" }, ...valid.data.slice(1)] },
    { ...valid, data: [{ ...valid.data[0], timestamp: "2026-02-30T00:00:00Z" }, ...valid.data.slice(1)] },
    { ...valid, data: [{ ...valid.data[0], permalink: "file:///tmp/post" }, ...valid.data.slice(1)] },
  ];
  for (const [index, body] of invalidBodies.entries()) {
    await t.test(`invalid exact payload ${index + 1}`, async () => {
      await assert.rejects(
        collectInstagramRanking({ gasUrl: "https://example.test/exec", period, fetchImpl: async () => jsonResponse(body) }),
        /(partial|period|fewer|duplicate|metric|timestamp|url)/i,
      );
    });
  }
});

test("Instagram fallback fails closed when fewer than three valid in-month posts exist", async () => {
  let requests = 0;
  await assert.rejects(
    collectInstagramRanking({
      gasUrl: "https://example.test/exec",
      period,
      fetchImpl: async () => {
        requests += 1;
        return requests === 1
          ? jsonResponse({ error: "Complete month boundary snapshots are required" })
          : jsonResponse({ data: [
            instagramPost("in-one"),
            instagramPost("in-two"),
            instagramPost("outside", { timestamp: "2026-07-01T00:00:00+09:00" }),
          ] });
      },
    }),
    /fewer than 3.*published/i,
  );
});
