import { validateManifest } from "./schema.mjs";

function compareCodeUnitsDescending(left, right) {
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireHttpUrl(value, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`blog returned invalid ${name} url`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`blog returned invalid ${name} url`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`blog returned invalid ${name} url`);
  }
  return parsed;
}

function requireCalendarDate(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) throw new Error("blog returned invalid publication date");
  const [, rawYear, rawMonth, rawDay] = match;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(rawYear), Number(rawMonth) - 1, Number(rawDay));
  if (date.getUTCFullYear() !== Number(rawYear)
    || date.getUTCMonth() !== Number(rawMonth) - 1
    || date.getUTCDate() !== Number(rawDay)) {
    throw new Error("blog returned invalid publication date");
  }
  return date.getTime();
}

function requireMetric(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`blog returned invalid ${name} metric`);
  }
  return value;
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response || typeof response !== "object" || response.ok !== true || typeof response.json !== "function") {
    const status = response && Number.isInteger(response.status) ? response.status : "unknown";
    throw new Error(`ranking API status=${status}`);
  }
  const json = await response.json();
  if (!isObject(json)) throw new Error("blog returned invalid payload");
  if (Object.hasOwn(json, "error")) {
    if (typeof json.error !== "string" || !json.error.trim()) throw new Error("blog returned invalid payload error");
    throw new Error(json.error);
  }
  return json;
}

function requireExactPeriod(value, period) {
  if (!isObject(value)
    || value.startDate !== period.startDate
    || value.endDate !== period.endDate
    || (Object.hasOwn(value, "month") && value.month !== period.month)
    || (Object.hasOwn(value, "timezone") && value.timezone !== period.timezone)) {
    throw new Error("blog response period does not match the requested period");
  }
}

function normalizePosts(data) {
  if (!Array.isArray(data)) throw new Error("blog returned invalid payload data");
  const seenIds = new Set();
  return data.map((post) => {
    if (!isObject(post)) throw new Error("blog returned invalid payload item");
    const parsedUrl = requireHttpUrl(post.url, "article");
    const id = parsedUrl.href;
    if (seenIds.has(id)) throw new Error(`blog returned duplicate content id ${id}`);
    seenIds.add(id);
    if (typeof post.title !== "string" || !post.title.trim()) {
      throw new Error(`blog returned invalid title for ${id}`);
    }
    return {
      id,
      title: post.title.trim(),
      url: id,
      date: post.date,
      publishedInstant: requireCalendarDate(post.date),
      pageViews: requireMetric(post.pageViews, "pageViews"),
      totalUsers: requireMetric(post.totalUsers, "totalUsers"),
    };
  });
}

export async function collectBlogRanking({ gasUrl, period, fetchImpl = fetch }) {
  const url = requireHttpUrl(gasUrl, "API");
  url.search = new URLSearchParams({
    api: "blog-ranking",
    startDate: period.startDate,
    endDate: period.endDate,
    limit: "100",
  });
  const json = await getJson(url, fetchImpl);
  requireExactPeriod(json.period, period);
  const posts = normalizePosts(json.data);
  if (posts.length < 3) throw new Error("blog returned fewer than 3 items");

  const items = posts
    .sort((left, right) => right.pageViews - left.pageViews
      || right.totalUsers - left.totalUsers
      || right.publishedInstant - left.publishedInstant
      || compareCodeUnitsDescending(left.id, right.id))
    .slice(0, 3)
    .map((post, index) => ({
      rank: index + 1,
      contentId: post.id,
      title: post.title,
      url: post.url,
      publishedAt: post.date,
      metricValue: post.pageViews,
      secondaryMetricValue: post.totalUsers,
    }));

  return validateManifest({
    schemaVersion: 1,
    channel: "blog",
    period,
    rankingMetric: "screenPageViews",
    rankingLabel: `${period.month}のページビュー`,
    generatedAt: new Date().toISOString(),
    items,
  });
}
