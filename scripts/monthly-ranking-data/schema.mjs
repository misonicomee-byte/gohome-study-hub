import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CHANNELS = ["youtube", "blog", "instagram", "podcast"];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCalendarDate(value) {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match || !isCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  return Number.isFinite(Date.parse(value));
}

function isValidUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isCanonicalPodcastUrl(value, kind) {
  if (!isValidUrl(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  if (kind === "episode") {
    return url.hostname === "podcasters.spotify.com"
      && url.pathname.startsWith("/pod/show/go-ito/episodes/")
      && url.pathname.length > "/pod/show/go-ito/episodes/".length;
  }
  return url.hostname === "d3t3ozftmdmh3i.cloudfront.net" && url.pathname.length > 1;
}

export function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifest must be an object");
  }
  if (value?.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!CHANNELS.includes(value.channel)) throw new Error("invalid channel");
  if (!value.period || typeof value.period !== "object" || Array.isArray(value.period)) {
    throw new Error("period must be an object");
  }
  const { month, startDate, endDate, timezone } = value.period;
  if (typeof month !== "string" || !MONTH.test(month)) throw new Error("period.month must be YYYY-MM");
  const expectedStartDate = `${month}-01`;
  const [, monthNumber] = month.split("-");
  const expectedEndDate = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(monthNumber), 0))
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
  if (!isCalendarDate(startDate) || !startDate.startsWith(`${month}-`) || startDate !== expectedStartDate) {
    throw new Error("period.startDate must be the first calendar day of period.month");
  }
  if (!isCalendarDate(endDate) || !endDate.startsWith(`${month}-`) || endDate !== expectedEndDate) {
    throw new Error("period.endDate must be the last calendar day of period.month");
  }
  if (startDate > endDate) throw new Error("period.startDate must not be after period.endDate");
  if (timezone !== "Asia/Tokyo") throw new Error("timezone must be Asia/Tokyo");
  if (["youtube", "podcast"].includes(value.channel)
    && value.reportingTimezone !== "America/Los_Angeles") {
    throw new Error("reportingTimezone must be America/Los_Angeles for YouTube Analytics metrics");
  }
  if (["blog", "instagram"].includes(value.channel)
    && value.reportingTimezone !== undefined
    && value.reportingTimezone !== "Asia/Tokyo") {
    throw new Error("reportingTimezone must be Asia/Tokyo for blog and Instagram metrics");
  }
  if (!isNonEmptyString(value.rankingMetric)) throw new Error("rankingMetric must be a non-empty string");
  if (!isNonEmptyString(value.rankingLabel)) throw new Error("rankingLabel must be a non-empty string");
  if (value.channel === "podcast") {
    if (value.rankingMetric !== "views") throw new Error("Podcast rankingMetric must be views");
    if (value.rankingLabel !== `前月（${month}）増加再生数（YouTube Analytics・太平洋時間）`) {
      throw new Error("invalid Podcast rankingLabel");
    }
    if (value.rankingMode !== undefined) throw new Error("Podcast rankingMode is not supported");
  }
  if (!isIsoTimestamp(value.generatedAt)) throw new Error("generatedAt must be a parseable ISO timestamp");
  if (!Array.isArray(value.items) || value.items.length !== 3) {
    throw new Error("manifest must contain exactly 3 items");
  }
  if (!value.items.every((item, index) => item
    && typeof item === "object"
    && item.rank === index + 1)) {
    throw new Error("items must have ranks 1,2,3");
  }
  const contentIds = new Set();
  const podcastGuids = new Set();
  const podcastUrls = new Set();
  for (const item of value.items) {
    if (!isNonEmptyString(item.contentId)
      || !isNonEmptyString(item.title)
      || !isValidUrl(item.url)
      || !isCalendarDate(item.publishedAt)
      || !Number.isFinite(item.metricValue)
      || !Number.isFinite(item.secondaryMetricValue)) {
      throw new Error(`invalid rank ${item.rank}`);
    }
    if (contentIds.has(item.contentId)) throw new Error(`duplicate contentId ${item.contentId}`);
    contentIds.add(item.contentId);
    if (value.channel === "podcast" && !isCanonicalPodcastUrl(item.url, "episode")) {
      throw new Error(`invalid Podcast Spotify URL for rank ${item.rank}`);
    }
    if (value.channel === "podcast" && !isCanonicalPodcastUrl(item.imageUrl, "image")) {
      throw new Error(`invalid Podcast image URL for rank ${item.rank}`);
    }
    if (value.channel === "podcast") {
      if (!isNonEmptyString(item.episodeGuid)) throw new Error(`invalid Podcast episodeGuid for rank ${item.rank}`);
      if (podcastGuids.has(item.episodeGuid)) throw new Error(`duplicate Podcast episodeGuid ${item.episodeGuid}`);
      if (podcastUrls.has(item.url)) throw new Error(`duplicate Podcast Spotify URL ${item.url}`);
      podcastGuids.add(item.episodeGuid);
      podcastUrls.add(item.url);
    }
  }
  return value;
}

export async function writeManifest(path, value) {
  validateManifest(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
