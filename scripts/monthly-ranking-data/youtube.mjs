import { validateManifest } from "./schema.mjs";

const ANALYTICS_PAGE_SIZE = 200;
const DATA_API_BATCH_SIZE = 50;
export const YOUTUBE_REPORTING_TIMEZONE = "America/Los_Angeles";
const MIN_REPORTING_LAG_DAYS = 3;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function responseError(api, status) {
  return new Error(`${api} status=${status}`);
}

function requireFiniteMetric(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`YouTube returned a non-negative finite ${name} metric`);
  }
  return value;
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRfc3339Timestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;

  const [, year, month, day, hour, minute, second, timezone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [numericYear, numericMonth, numericDay, numericHour, numericMinute, numericSecond] = parts;
  const timezoneOffset = timezone === "Z"
    ? 0
    : (Number(timezone.slice(1, 3)) * 60) + Number(timezone.slice(4, 6));

  if (numericMonth < 1 || numericMonth > 12
    || numericHour > 23 || numericMinute > 59 || numericSecond > 59
    || timezoneOffset > (23 * 60) + 59) return false;

  const calendarDate = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  return calendarDate.getUTCFullYear() === numericYear
    && calendarDate.getUTCMonth() === numericMonth - 1
    && calendarDate.getUTCDate() === numericDay;
}

function requireSnippet(id, snippet) {
  if (!snippet || typeof snippet !== "object" || Array.isArray(snippet)
    || typeof snippet.title !== "string" || !snippet.title.trim()
    || typeof snippet.publishedAt !== "string" || !isRfc3339Timestamp(snippet.publishedAt)) {
    throw new Error(`YouTube returned invalid details for video ${id}`);
  }
  return snippet;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reportingDate(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("YouTube now must be a valid Date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: YOUTUBE_REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function requireCompletedYouTubeReportingPeriod(period, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period?.endDate ?? "");
  if (!match) throw new Error("YouTube period.endDate must be a calendar date");
  const endUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(endUtc);
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) {
    throw new Error("YouTube period.endDate must be a calendar date");
  }
  // Wait three complete reporting days after the requested end date.
  const available = new Date(endUtc + (MIN_REPORTING_LAG_DAYS + 1) * DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
  if (reportingDate(now) < available) {
    throw new Error(`YouTube reporting period is not completed with the required ${MIN_REPORTING_LAG_DAYS}-day reporting lag`);
  }
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

async function collectAnalyticsItems({ channelId, period, fetchImpl, headers, now }) {
  requireCompletedYouTubeReportingPeriod(period, now);
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
    if (analyticsBody?.query !== undefined
      && (!isObject(analyticsBody.query)
        || analyticsBody.query.startDate !== period.startDate
        || analyticsBody.query.endDate !== period.endDate)) {
      throw new Error("YouTube Analytics returned a mismatched date range");
    }
    const rows = isObject(analyticsBody) && analyticsBody.rows === undefined ? [] : analyticsBody?.rows;
    if (!isObject(analyticsBody) || !Array.isArray(rows)
      || rows.length > ANALYTICS_PAGE_SIZE) {
      throw new Error("YouTube returned invalid Analytics payload");
    }
    for (const row of rows) {
      analyticsItems.push(requireAnalyticsRow(row, seenIds));
    }

    if (rows.length < ANALYTICS_PAGE_SIZE) break;
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

function authorizationHeaders(accessToken) {
  if (typeof accessToken !== "string" || !accessToken.trim()) throw new Error("YouTube access token is required");
  return { Authorization: `Bearer ${accessToken.trim()}` };
}

export async function collectYouTubeAnalyticsItems({ accessToken, channelId, period, now = new Date(), fetchImpl = fetch }) {
  return collectAnalyticsItems({
    channelId,
    period,
    fetchImpl,
    headers: authorizationHeaders(accessToken),
    now,
  });
}

export async function collectYouTubeSnippets({ accessToken, analyticsItems, fetchImpl = fetch }) {
  if (!Array.isArray(analyticsItems)) throw new Error("YouTube analyticsItems must be an array");
  return collectSnippets({
    analyticsItems,
    fetchImpl,
    headers: authorizationHeaders(accessToken),
  });
}

export async function collectYouTubeRanking({ accessToken, channelId, period, now = new Date(), fetchImpl = fetch }) {
  const allAnalyticsItems = await collectYouTubeAnalyticsItems({ accessToken, channelId, period, now, fetchImpl });
  const analyticsItems = allAnalyticsItems.filter(({ creatorContentType }) => creatorContentType === "SHORTS");
  if (analyticsItems.length < 3) throw new Error("YouTube returned fewer than 3 Shorts");

  const snippetsById = await collectYouTubeSnippets({ accessToken, analyticsItems, fetchImpl });
  const items = analyticsItems
    .map((item) => ({ ...item, snippet: snippetsById.get(item.id) }))
    .sort((a, b) => b.views - a.views
      || b.engagedViews - a.engagedViews
      || Date.parse(b.snippet.publishedAt) - Date.parse(a.snippet.publishedAt)
      || compareCodeUnits(b.id, a.id))
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
    reportingTimezone: YOUTUBE_REPORTING_TIMEZONE,
    rankingMetric: "views",
    rankingLabel: `${period.month}の再生回数（YouTube Analytics・太平洋時間）`,
    generatedAt: now.toISOString(),
    items,
  });
}
