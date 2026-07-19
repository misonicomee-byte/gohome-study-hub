import { validateManifest } from "./schema.mjs";

function responseError(api, status) {
  return new Error(`${api} status=${status}`);
}

function requireFiniteMetric(value, name) {
  const metric = Number(value);
  if (!Number.isFinite(metric)) throw new Error(`YouTube returned non-finite ${name} metrics`);
  return metric;
}

function requireSnippet(id, snippet) {
  if (!snippet || typeof snippet !== "object"
    || typeof snippet.title !== "string" || !snippet.title.trim()
    || typeof snippet.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(snippet.publishedAt)) {
    throw new Error(`YouTube returned invalid details for video ${id}`);
  }
  return snippet;
}

export async function collectYouTubeRanking({ accessToken, channelId, period, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const query = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  query.search = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: period.startDate,
    endDate: period.endDate,
    metrics: "views,engagedViews",
    dimensions: "video",
    filters: "creatorContentType==SHORTS",
    sort: "-views,-engagedViews",
    maxResults: "50",
  });

  const analyticsResponse = await fetchImpl(query, { headers });
  if (!analyticsResponse.ok) throw responseError("YouTube Analytics", analyticsResponse.status);
  const analyticsBody = await analyticsResponse.json();
  const rows = analyticsBody?.rows;
  if (!Array.isArray(rows) || rows.length < 3) {
    throw new Error("YouTube returned fewer than 3 Shorts");
  }

  const analyticsItems = rows.map((row) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !row[0]) {
      throw new Error("YouTube returned invalid Analytics rows");
    }
    return {
      id: row[0],
      views: requireFiniteMetric(row[1], "views"),
      engagedViews: requireFiniteMetric(row[2], "engagedViews"),
    };
  });

  const ids = analyticsItems.map(({ id }) => id);
  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.search = new URLSearchParams({ part: "snippet", id: ids.join(",") });
  const detailsResponse = await fetchImpl(detailsUrl, { headers });
  if (!detailsResponse.ok) throw responseError("YouTube Data", detailsResponse.status);
  const detailsBody = await detailsResponse.json();
  if (!Array.isArray(detailsBody?.items)) throw new Error("YouTube returned invalid video details");
  const snippetsById = new Map(detailsBody.items.map((item) => [item?.id, item?.snippet]));

  const items = analyticsItems
    .map((item) => ({ ...item, snippet: requireSnippet(item.id, snippetsById.get(item.id)) }))
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
