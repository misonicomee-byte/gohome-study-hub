import { validateManifest } from "./schema.mjs";

const ANALYTICS_PAGE_SIZE = 200;
const DATA_API_BATCH_SIZE = 50;

function responseError(api, status) {
  return new Error(`${api} status=${status}`);
}

function requireFiniteMetric(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`YouTube returned a non-negative finite ${name} metric`);
  }
  return value;
}

function requireSnippet(id, snippet) {
  if (!snippet || typeof snippet !== "object" || Array.isArray(snippet)
    || typeof snippet.title !== "string" || !snippet.title.trim()
    || typeof snippet.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(snippet.publishedAt)) {
    throw new Error(`YouTube returned invalid details for video ${id}`);
  }
  return snippet;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireAnalyticsRow(row, seenIds) {
  if (!Array.isArray(row) || row.length !== 4) {
    throw new Error("YouTube returned invalid Analytics rows");
  }
  const [id, creatorContentType, views, engagedViews] = row;
  if (typeof id !== "string" || !id.trim() || id !== id.trim()
    || typeof creatorContentType !== "string" || !creatorContentType.trim()) {
    throw new Error("YouTube returned invalid Analytics rows");
  }
  if (seenIds.has(id)) throw new Error(`YouTube returned duplicate Analytics video id ${id}`);
  seenIds.add(id);
  return {
    id,
    creatorContentType,
    views: requireFiniteMetric(views, "views"),
    engagedViews: requireFiniteMetric(engagedViews, "engagedViews"),
  };
}

async function collectAnalyticsItems({ channelId, period, fetchImpl, headers }) {
  const analyticsItems = [];
  const seenIds = new Set();
  let startIndex = 1;

  while (true) {
    const query = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    query.search = new URLSearchParams({
      ids: `channel==${channelId}`,
      startDate: period.startDate,
      endDate: period.endDate,
      metrics: "views,engagedViews",
      dimensions: "video,creatorContentType",
      sort: "-views,-engagedViews",
      maxResults: String(ANALYTICS_PAGE_SIZE),
      startIndex: String(startIndex),
    });

    const analyticsResponse = await fetchImpl(query, { headers });
    if (!analyticsResponse.ok) throw responseError("YouTube Analytics", analyticsResponse.status);
    const analyticsBody = await analyticsResponse.json();
    if (!isObject(analyticsBody) || !Array.isArray(analyticsBody.rows)
      || analyticsBody.rows.length > ANALYTICS_PAGE_SIZE) {
      throw new Error("YouTube returned invalid Analytics payload");
    }
    for (const row of analyticsBody.rows) {
      analyticsItems.push(requireAnalyticsRow(row, seenIds));
    }

    if (analyticsBody.rows.length < ANALYTICS_PAGE_SIZE) break;
    startIndex += ANALYTICS_PAGE_SIZE;
  }

  return analyticsItems;
}

async function collectSnippets({ analyticsItems, fetchImpl, headers }) {
  const snippetsById = new Map();

  for (let offset = 0; offset < analyticsItems.length; offset += DATA_API_BATCH_SIZE) {
    const batch = analyticsItems.slice(offset, offset + DATA_API_BATCH_SIZE);
    const batchIds = batch.map(({ id }) => id);
    const expectedIds = new Set(batchIds);
    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.search = new URLSearchParams({ part: "snippet", id: batchIds.join(",") });
    const detailsResponse = await fetchImpl(detailsUrl, { headers });
    if (!detailsResponse.ok) throw responseError("YouTube Data", detailsResponse.status);
    const detailsBody = await detailsResponse.json();
    if (!isObject(detailsBody) || !Array.isArray(detailsBody.items)) {
      throw new Error("YouTube returned invalid video metadata payload");
    }

    for (const item of detailsBody.items) {
      if (!isObject(item) || typeof item.id !== "string" || !expectedIds.has(item.id)) {
        throw new Error("YouTube returned invalid video metadata");
      }
      if (snippetsById.has(item.id)) {
        throw new Error(`YouTube returned duplicate video metadata for ${item.id}`);
      }
      snippetsById.set(item.id, requireSnippet(item.id, item.snippet));
    }
  }

  for (const { id } of analyticsItems) {
    if (!snippetsById.has(id)) throw new Error(`YouTube returned missing video metadata for ${id}`);
  }
  return snippetsById;
}

export async function collectYouTubeRanking({ accessToken, channelId, period, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const allAnalyticsItems = await collectAnalyticsItems({
    channelId,
    period,
    fetchImpl,
    headers,
  });
  const analyticsItems = allAnalyticsItems.filter(({ creatorContentType }) => creatorContentType === "SHORTS");
  if (analyticsItems.length < 3) throw new Error("YouTube returned fewer than 3 Shorts");

  const snippetsById = await collectSnippets({ analyticsItems, fetchImpl, headers });
  const items = analyticsItems
    .map((item) => ({ ...item, snippet: snippetsById.get(item.id) }))
    .sort((a, b) => b.views - a.views
      || b.engagedViews - a.engagedViews
      || b.snippet.publishedAt.localeCompare(a.snippet.publishedAt)
      || b.id.localeCompare(a.id))
    .slice(0, 3)
    .map((item, index) => ({
      rank: index + 1,
      contentId: item.id,
      title: item.snippet.title,
      url: `https://www.youtube.com/shorts/${item.id}`,
      publishedAt: item.snippet.publishedAt.slice(0, 10),
      metricValue: item.views,
      secondaryMetricValue: item.engagedViews,
    }));

  return validateManifest({
    schemaVersion: 1,
    channel: "youtube",
    period,
    rankingMetric: "views",
    rankingLabel: `${period.month}の再生回数`,
    generatedAt: new Date().toISOString(),
    items,
  });
}
