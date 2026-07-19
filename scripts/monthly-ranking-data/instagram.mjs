import { validateManifest } from "./schema.mjs";

const BOUNDARY_UNAVAILABLE_ERRORS = new Set([
  "Instagram snapshot store is not configured",
  "Complete month boundary snapshots are required",
]);
const BOUNDARY_UNAVAILABLE_CODES = new Set([
  "INSTAGRAM_SNAPSHOT_STORE_NOT_CONFIGURED",
  "INSTAGRAM_COMPLETE_MONTH_BOUNDARY_SNAPSHOTS_REQUIRED",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCodeUnitsDescending(left, right) {
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}

function requireHttpUrl(value, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`Instagram returned invalid ${name} url`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Instagram returned invalid ${name} url`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Instagram returned invalid ${name} url`);
  }
  return parsed;
}

function requireMetric(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Instagram returned invalid ${name} metric`);
  }
  return value;
}

function parseTimestamp(value) {
  const normalized = typeof value === "string"
    ? value.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2")
    : value;
  const match = typeof normalized === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(normalized)
    : null;
  if (!match || !Number.isFinite(Date.parse(normalized))) throw new Error("Instagram returned invalid timestamp");
  const [, rawYear, rawMonth, rawDay] = match;
  const calendarDate = new Date(0);
  calendarDate.setUTCHours(0, 0, 0, 0);
  calendarDate.setUTCFullYear(Number(rawYear), Number(rawMonth) - 1, Number(rawDay));
  if (calendarDate.getUTCFullYear() !== Number(rawYear)
    || calendarDate.getUTCMonth() !== Number(rawMonth) - 1
    || calendarDate.getUTCDate() !== Number(rawDay)) {
    throw new Error("Instagram returned invalid timestamp");
  }
  return Date.parse(normalized);
}

function jstDate(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant)).reduce((result, part) => ({
    ...result,
    [part.type]: part.value,
  }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizePost(post, mode, seenIds) {
  if (!isObject(post)) throw new Error("Instagram returned invalid payload item");
  if (typeof post.id !== "string" || !post.id.trim() || post.id !== post.id.trim()) {
    throw new Error("Instagram returned invalid content id");
  }
  if (seenIds.has(post.id)) throw new Error(`Instagram returned duplicate content id ${post.id}`);
  seenIds.add(post.id);
  if (typeof post.caption !== "string" || !post.caption.split("\n")[0].trim()) {
    throw new Error(`Instagram returned invalid title for ${post.id}`);
  }
  const instant = parseTimestamp(post.timestamp);
  return {
    id: post.id,
    title: post.caption.split("\n")[0].trim(),
    url: requireHttpUrl(post.permalink, "permalink").href,
    instant,
    publishedAt: jstDate(instant),
    metric: requireMetric(mode === "exact" ? post.viewsDelta : post.views, mode === "exact" ? "viewsDelta" : "views"),
    secondaryMetric: requireMetric(
      mode === "exact" ? post.totalInteractionsDelta : post.total_interactions,
      mode === "exact" ? "totalInteractionsDelta" : "total_interactions",
    ),
  };
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response || typeof response !== "object" || response.ok !== true || typeof response.json !== "function") {
    const status = response && Number.isInteger(response.status) ? response.status : "unknown";
    throw new Error(`ranking API status=${status}`);
  }
  const json = await response.json();
  if (!isObject(json)) throw new Error("Instagram returned invalid payload");
  return json;
}

function responseError(json) {
  if (!Object.hasOwn(json, "error")) return null;
  if (typeof json.error !== "string" || !json.error.trim()) {
    throw new Error("Instagram returned invalid payload error");
  }
  return json.error;
}

function hasKnownBoundaryUnavailableReason(json, error) {
  return BOUNDARY_UNAVAILABLE_ERRORS.has(error)
    || (typeof json.errorCode === "string" && BOUNDARY_UNAVAILABLE_CODES.has(json.errorCode));
}

function expectedBoundaryDate(period) {
  const instant = Date.parse(`${period.endDate}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return new Date(instant).toISOString().slice(0, 10);
}

function requireExactPeriod(value, period) {
  if (!isObject(value)
    || value.month !== period.month
    || value.startDate !== period.startDate
    || value.endDate !== period.endDate
    || value.timezone !== period.timezone
    || value.boundarySnapshotDate !== expectedBoundaryDate(period)) {
    throw new Error("Instagram response period does not match the requested period");
  }
}

function sortedTopThree(data, mode) {
  if (!Array.isArray(data)) throw new Error("Instagram returned invalid payload data");
  const seenIds = new Set();
  const posts = data.map((post) => normalizePost(post, mode, seenIds));
  if (posts.length < 3) throw new Error("Instagram returned fewer than 3 items");
  return posts
    .sort((left, right) => right.metric - left.metric
      || right.secondaryMetric - left.secondaryMetric
      || right.instant - left.instant
      || compareCodeUnitsDescending(left.id, right.id))
    .slice(0, 3);
}

function manifestItems(posts) {
  return posts.map((post, index) => ({
    rank: index + 1,
    contentId: post.id,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt,
    metricValue: post.metric,
    secondaryMetricValue: post.secondaryMetric,
  }));
}

async function collectFallback({ url, period, fetchImpl }) {
  url.search = new URLSearchParams({ api: "instagram-posts", limit: "100" });
  const json = await requestJson(url, fetchImpl);
  const error = responseError(json);
  if (error) throw new Error(error);
  if (!Array.isArray(json.data)) throw new Error("Instagram returned invalid payload data");

  const seenIds = new Set();
  const allPosts = json.data.map((post) => normalizePost(post, "fallback", seenIds));
  const startInstant = Date.parse(`${period.startDate}T00:00:00+09:00`);
  const endInstant = Date.parse(`${expectedBoundaryDate(period)}T00:00:00+09:00`);
  const inMonth = allPosts.filter((post) => post.instant >= startInstant && post.instant < endInstant);
  if (inMonth.length < 3) {
    throw new Error("Instagram returned fewer than 3 posts published within the requested month");
  }
  const topThree = inMonth
    .sort((left, right) => right.metric - left.metric
      || right.secondaryMetric - left.secondaryMetric
      || right.instant - left.instant
      || compareCodeUnitsDescending(left.id, right.id))
    .slice(0, 3);

  return validateManifest({
    schemaVersion: 1,
    channel: "instagram",
    period,
    rankingMetric: "currentViewsOfPostsPublishedInMonth",
    rankingLabel: `${period.month}公開投稿の現在views TOP3（初回限定・月内増加数ではありません）`,
    rankingMode: "initialPublishedMonthCurrentViews",
    generatedAt: new Date().toISOString(),
    items: manifestItems(topThree),
  });
}

export async function collectInstagramRanking({ gasUrl, period, fetchImpl = fetch }) {
  const url = requireHttpUrl(gasUrl, "API");
  url.search = new URLSearchParams({
    api: "instagram-monthly-ranking",
    month: period.month,
    limit: "3",
  });
  const json = await requestJson(url, fetchImpl);
  const error = responseError(json);
  if (error) {
    if (!hasKnownBoundaryUnavailableReason(json, error)) throw new Error(error);
    return collectFallback({ url, period, fetchImpl });
  }
  if (json.partial === true) {
    if (hasKnownBoundaryUnavailableReason(json, null)) {
      return collectFallback({ url, period, fetchImpl });
    }
    throw new Error("Instagram exact response is partial without a known boundary-unavailable reason");
  }
  if (json.partial !== false) throw new Error("Instagram exact response partial must be false");
  requireExactPeriod(json.period, period);
  const posts = sortedTopThree(json.data, "exact");

  return validateManifest({
    schemaVersion: 1,
    channel: "instagram",
    period,
    rankingMetric: "viewsDelta",
    rankingLabel: `${period.month}のviews増加数`,
    rankingMode: "exactMonthlyDelta",
    generatedAt: new Date().toISOString(),
    items: manifestItems(posts),
  });
}
