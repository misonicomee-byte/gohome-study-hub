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

function canonicalArticle(value) {
  const parsed = requireHttpUrl(value, "article");
  if (parsed.protocol !== "https:"
    || !["gohome-clinic.com", "www.gohome-clinic.com"].includes(parsed.hostname)
    || parsed.port) {
    throw new Error("blog returned invalid article url");
  }

  const dateMatch = /^\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(parsed.pathname);
  if (!dateMatch) throw new Error("blog returned invalid article url path");
  const publishedAt = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const publishedInstant = requireCalendarDate(publishedAt);
  const pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  return {
    id: `https://gohome-clinic.com${pathname}`,
    publishedAt,
    publishedInstant,
  };
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
  const postsById = new Map();
  for (const post of data) {
    if (!isObject(post)) throw new Error("blog returned invalid payload item");
    const article = canonicalArticle(post.url);
    const date = post.date;
    const publishedInstant = requireCalendarDate(date);
    if (date !== article.publishedAt || publishedInstant !== article.publishedInstant) {
      throw new Error(`blog returned publication date conflicting with article url ${article.id}`);
    }
    if (typeof post.title !== "string") throw new Error(`blog returned invalid title for ${article.id}`);
    const title = post.title.trim();
    const pageViews = requireMetric(post.pageViews, "pageViews");
    const totalUsers = requireMetric(post.totalUsers, "totalUsers");
    const existing = postsById.get(article.id);
    if (!existing) {
      postsById.set(article.id, {
        id: article.id,
        title,
        url: article.id,
        date,
        publishedInstant,
        pageViews,
        totalUsers,
      });
      continue;
    }
    if (existing.date !== date) {
      throw new Error(`blog returned conflicting publication dates for ${article.id}`);
    }
    if (existing.title && title && existing.title !== title) {
      throw new Error(`blog returned conflicting titles for ${article.id}`);
    }
    if (!existing.title && title) existing.title = title;
    existing.pageViews += pageViews;
    // GA4 user counts are not additive sets. Summing is the only consistent
    // behavior available when duplicate canonical rows lack user identifiers.
    existing.totalUsers += totalUsers;
  }

  const posts = [...postsById.values()];
  for (const post of posts) {
    if (!post.title) throw new Error(`blog returned invalid title for ${post.id}`);
  }
  return posts;
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
