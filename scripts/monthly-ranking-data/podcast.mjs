import { validateManifest } from "./schema.mjs";
import {
  collectYouTubeAnalyticsItems,
  collectYouTubeSnippets,
  requireCompletedYouTubeReportingPeriod,
  YOUTUBE_REPORTING_TIMEZONE,
} from "./youtube.mjs";

export const PODCAST_RSS_URL = "https://anchor.fm/s/10da34b80/podcast/rss";
const RSS_IMAGE_HOST = "d3t3ozftmdmh3i.cloudfront.net";
const RSS_LIMIT_BYTES = 5 * 1024 * 1024;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCodeUnitsDescending(left, right) {
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}

function publicHttpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Podcast returned invalid ${name}`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error(`Podcast returned invalid ${name}`);
  }
  return url;
}

async function requestJson(url, fetchImpl, label) {
  const response = await fetchImpl(url);
  if (!response?.ok || typeof response.json !== "function") {
    throw new Error(`${label} status=${Number.isInteger(response?.status) ? response.status : "unknown"}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (!isObject(body)) throw new Error(`${label} returned invalid payload`);
  return body;
}

function normalizeTitle(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function episodeNumber(title) {
  return /^(\d{1,4})(?!\d)/u.exec(normalizeTitle(title))?.[1] ?? null;
}

async function fetchPodcastList(gasUrl, fetchImpl) {
  const url = publicHttpsUrl(gasUrl, "GAS URL");
  url.search = new URLSearchParams({ api: "podcast-list" });
  const body = await requestJson(url, fetchImpl, "Podcast list API");
  if (body.truncated === true) throw new Error("Podcast list is truncated");
  if (!Array.isArray(body.data) || !Number.isInteger(body.count) || body.count !== body.data.length) {
    throw new Error("Podcast list returned invalid payload");
  }
  if (body.data.length < 3) throw new Error("Podcast list returned fewer than 3 episodes");
  const seen = new Set();
  return body.data.map((row) => {
    if (!isObject(row)) throw new Error("Podcast list returned invalid episode");
    const id = typeof row.youtubeId === "string" ? row.youtubeId.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)
      || (row.id !== undefined && String(row.id).trim() !== id)
      || seen.has(id)
      || !normalizeTitle(row.title)) {
      throw new Error("Podcast list returned invalid episode");
    }
    seen.add(id);
    return { id, title: normalizeTitle(row.title) };
  });
}

function decodeXml(value) {
  const unwrapped = value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/u, "$1");
  return unwrapped.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/giu, (match, numeric, named) => {
    if (numeric) {
      const codePoint = Number.parseInt(numeric.slice(0, 1).toLowerCase() === "x" ? numeric.slice(1) : numeric, numeric[0].toLowerCase() === "x" ? 16 : 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
  });
}

function tagValue(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(block);
  return match ? decodeXml(match[1]) : null;
}

function imageHref(block) {
  const match = /<itunes:image\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/iu.exec(block);
  return match ? decodeXml(match[1]) : null;
}

function canonicalSpotifyUrl(value) {
  const url = publicHttpsUrl(value, "RSS Spotify link");
  if (url.hostname !== "podcasters.spotify.com"
    || !url.pathname.startsWith("/pod/show/go-ito/episodes/")
    || url.pathname.length <= "/pod/show/go-ito/episodes/".length
    || url.search) {
    throw new Error("Podcast RSS Spotify link is not canonical");
  }
  return url.href;
}

function canonicalImageUrl(value) {
  const url = publicHttpsUrl(value, "RSS image");
  if (url.hostname !== RSS_IMAGE_HOST || url.pathname.length <= 1 || url.search) {
    throw new Error("Podcast RSS image is not canonical");
  }
  return url.href;
}

function parseRss(xml) {
  if (typeof xml !== "string" || !xml.startsWith("<?xml") || /<!DOCTYPE/iu.test(xml)
    || Buffer.byteLength(xml, "utf8") > RSS_LIMIT_BYTES) {
    throw new Error("Podcast RSS returned invalid XML");
  }
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)].map((match) => match[1]);
  if (blocks.length < 3) throw new Error("Podcast RSS returned fewer than 3 episodes");
  const channelOnly = xml.replace(/<item\b[^>]*>[\s\S]*?<\/item>/giu, "");
  const channelImage = imageHref(channelOnly);
  const episodes = blocks.map((block) => {
    const title = normalizeTitle(tagValue(block, "title"));
    const guid = normalizeTitle(tagValue(block, "guid"));
    const link = tagValue(block, "link");
    const rawPublishedAt = tagValue(block, "pubDate");
    const publishedInstant = Date.parse(rawPublishedAt ?? "");
    if (!title || !guid || !Number.isFinite(publishedInstant)) throw new Error("Podcast RSS returned invalid episode metadata");
    return {
      title,
      guid,
      url: canonicalSpotifyUrl(link),
      imageUrl: canonicalImageUrl(imageHref(block) ?? channelImage),
      publishedInstant,
    };
  });
  const seenGuid = new Set();
  const seenUrl = new Set();
  for (const episode of episodes) {
    if (seenGuid.has(episode.guid)) throw new Error("Podcast RSS returned duplicate guid");
    if (seenUrl.has(episode.url)) throw new Error("Podcast RSS returned duplicate Spotify URL");
    seenGuid.add(episode.guid);
    seenUrl.add(episode.url);
  }
  return episodes;
}

async function fetchRss(rssUrl, fetchImpl) {
  if (rssUrl !== PODCAST_RSS_URL) throw new Error("Podcast RSS URL is not approved");
  const response = await fetchImpl(rssUrl, { method: "GET", redirect: "error" });
  if (!response?.ok || typeof response.text !== "function") {
    throw new Error(`Podcast RSS status=${Number.isInteger(response?.status) ? response.status : "unknown"}`);
  }
  if (response.url && response.url !== rssUrl) throw new Error("Podcast RSS redirected unexpectedly");
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RSS_LIMIT_BYTES) {
    throw new Error("Podcast RSS response is too large");
  }
  let xml;
  try {
    xml = await response.text();
  } catch {
    throw new Error("Podcast RSS response could not be read");
  }
  return parseRss(xml);
}

function rssIndexes(episodes) {
  const exact = new Map();
  const numbered = new Map();
  for (const episode of episodes) {
    const normalized = normalizeTitle(episode.title);
    if (exact.has(normalized)) exact.set(normalized, null);
    else exact.set(normalized, episode);
    const number = episodeNumber(normalized);
    if (number) numbered.set(number, numbered.has(number) ? null : episode);
  }
  return { exact, numbered };
}

function matchRssEpisode(title, indexes, id) {
  const normalized = normalizeTitle(title);
  const exact = indexes.exact.get(normalized);
  if (exact) return exact;
  const number = episodeNumber(normalized);
  const numbered = number ? indexes.numbered.get(number) : null;
  if (numbered) return numbered;
  throw new Error(`Podcast RSS metadata is missing or ambiguous for ${id}`);
}

export async function collectPodcastRanking({
  accessToken,
  channelId,
  gasUrl,
  rssUrl = PODCAST_RSS_URL,
  period,
  now = new Date(),
  fetchImpl = fetch,
}) {
  requireCompletedYouTubeReportingPeriod(period, now);
  const [listed, analyticsItems, rssEpisodes] = await Promise.all([
    fetchPodcastList(gasUrl, fetchImpl),
    collectYouTubeAnalyticsItems({ accessToken, channelId, period, now, fetchImpl }),
    fetchRss(rssUrl, fetchImpl),
  ]);
  const metrics = new Map(analyticsItems.map((item) => [item.id, item]));
  const candidates = listed.map((episode) => ({
    id: episode.id,
    title: episode.title,
    creatorContentType: metrics.get(episode.id)?.creatorContentType ?? "VIDEO_ON_DEMAND",
    views: metrics.get(episode.id)?.views ?? 0,
    engagedViews: metrics.get(episode.id)?.engagedViews ?? 0,
  }));
  const snippets = await collectYouTubeSnippets({ accessToken, analyticsItems: candidates, fetchImpl });
  const ranked = candidates
    .map((item) => ({ ...item, snippet: snippets.get(item.id) }))
    .sort((left, right) => right.views - left.views
      || right.engagedViews - left.engagedViews
      || Date.parse(right.snippet.publishedAt) - Date.parse(left.snippet.publishedAt)
      || compareCodeUnitsDescending(left.id, right.id))
    .slice(0, 3);
  if (ranked.length < 3) throw new Error("Podcast returned fewer than 3 episodes");
  const indexes = rssIndexes(rssEpisodes);
  const usedGuids = new Set();
  const items = ranked.map((item, index) => {
    const rssEpisode = matchRssEpisode(item.title, indexes, item.id);
    const snippetEpisode = matchRssEpisode(item.snippet.title, indexes, item.id);
    if (rssEpisode.guid !== snippetEpisode.guid) {
      throw new Error(`Podcast identity mismatch for YouTube video ${item.id}`);
    }
    if (usedGuids.has(rssEpisode.guid)) throw new Error(`Podcast duplicate RSS episode assignment for ${item.id}`);
    usedGuids.add(rssEpisode.guid);
    return {
      rank: index + 1,
      contentId: item.id,
      title: rssEpisode.title,
      url: rssEpisode.url,
      imageUrl: rssEpisode.imageUrl,
      episodeGuid: rssEpisode.guid,
      publishedAt: item.snippet.publishedAt.slice(0, 10),
      metricValue: item.views,
      secondaryMetricValue: item.engagedViews,
    };
  });
  return validateManifest({
    schemaVersion: 1,
    channel: "podcast",
    period,
    reportingTimezone: YOUTUBE_REPORTING_TIMEZONE,
    rankingMetric: "views",
    rankingLabel: `前月（${period.month}）増加再生数（YouTube Analytics・太平洋時間）`,
    generatedAt: now.toISOString(),
    items,
  });
}
