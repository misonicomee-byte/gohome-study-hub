var PUBLIC_CONFIG_ = {
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841470265749902",
  GRAPH_API_VERSION: "v24.0",
  GA4_PROPERTY_HOMEPAGE: "373025643",
  BLOG_ORIGIN: "https://gohome-clinic.com",
};

var PUBLIC_ERROR_CODES_ = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  SNAPSHOT_NOT_CONFIGURED: "INSTAGRAM_SNAPSHOT_STORE_NOT_CONFIGURED",
  SNAPSHOT_BOUNDARY_MISSING: "INSTAGRAM_COMPLETE_MONTH_BOUNDARY_SNAPSHOTS_REQUIRED",
};

var PUBLIC_CACHE_MAX_BYTES_ = 90000;
var PUBLIC_CACHE_LOCK_TIMEOUT_MS_ = 5000;
var PUBLIC_NEGATIVE_CACHE_TTL_SECONDS_ = 60;
var PUBLIC_RESPONSE_MAX_BYTES_ = 80000;

var INSTAGRAM_SNAPSHOT_SHEET_ = "instagram_daily";
var INSTAGRAM_SNAPSHOT_TEXT_PREFIX_ = "\u200B";
var INSTAGRAM_SNAPSHOT_HEADERS_ = [
  "snapshotDate", "mediaId", "timestamp", "permalink", "caption", "mediaType",
  "views", "reach", "totalInteractions", "saved", "shares",
];

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var parameterLists = e && e.parameters ? e.parameters : {};
  var result;
  try {
    if (!hasSingleQueryValues_(parameterLists)) {
      result = invalidRequest_("Duplicate query parameters are not allowed");
    } else {
      result = handlePublicApiRequest_(params);
    }
  } catch (error) {
    console.error("Public ranking API request failed");
    result = publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Content ranking is temporarily unavailable");
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handlePublicApiRequest_(params) {
  var api = String(params.api || "");
  if (api === "blog-ranking") {
    if (!hasOnlyQueryParams_(params, ["api", "startDate", "endDate", "limit"])) {
      return invalidRequest_("Invalid blog-ranking parameters");
    }
    var startDate = String(params.startDate || "");
    var endDate = String(params.endDate || "");
    var blogLimit = parseCanonicalLimit_(params.limit, 100, [100]);
    if (blogLimit === null || !isAllowedBlogRange_(startDate, endDate)) {
      return invalidRequest_("blog-ranking requires an allowed startDate and endDate");
    }
    return cachedJson_("blog:" + startDate + ":" + endDate + ":" + blogLimit, 600, function () {
      return getBlogRankingFromGA4_(startDate, endDate, blogLimit);
    });
  }
  if (api === "instagram-posts") {
    if (!hasOnlyQueryParams_(params, ["api", "limit"])) {
      return invalidRequest_("Invalid instagram-posts parameters");
    }
    var postsLimit = parseCanonicalLimit_(params.limit, 30, [30, 50, 100]);
    if (postsLimit === null) return invalidRequest_("Invalid instagram-posts limit");
    return cachedJson_("instagram-posts:" + postsLimit, 600, function () {
      return getInstagramPostsWithInsights_(postsLimit);
    });
  }
  if (api === "instagram-monthly-ranking") {
    if (!hasOnlyQueryParams_(params, ["api", "month", "limit"])) {
      return invalidRequest_("Invalid instagram-monthly-ranking parameters");
    }
    var month = String(params.month || "");
    var rankingLimit = parseCanonicalLimit_(params.limit, 3, [3]);
    if (rankingLimit === null || !isAllowedRankingMonth_(month)) {
      return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, "month must be YYYY-MM");
    }
    return cachedJson_("instagram-monthly:" + month + ":" + rankingLimit, 600, function () {
      return getInstagramMonthlyRanking_(month, rankingLimit);
    });
  }
  if (api === "podcast-list") {
    if (!hasOnlyQueryParams_(params, ["api"])) {
      return invalidRequest_("Invalid podcast-list parameters");
    }
    return cachedJson_("podcast-list", 600, getPodcastList_);
  }
  return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, "Unknown api");
}

function publicError_(code, message) {
  return { error: message, errorCode: code, data: [] };
}

function invalidRequest_(message) {
  return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, message);
}

function cachedJson_(key, ttl, loader) {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
  } catch (ignored) {
    console.warn("Public API cache is unavailable");
  }

  var hit = readCachedJson_(cache, key);
  if (hit !== null) return hit;

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(PUBLIC_CACHE_LOCK_TIMEOUT_MS_);
  } catch (ignored) {
    console.warn("Public API cache lock is unavailable");
  }
  if (!locked) {
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Content ranking is temporarily unavailable");
  }

  try {
    hit = readCachedJson_(cache, key);
    if (hit !== null) return hit;

    var value = loader();
    if (isPublicCacheable_(value)) {
      var cacheTtl = value && value.error
        ? Math.min(ttl, PUBLIC_NEGATIVE_CACHE_TTL_SECONDS_)
        : ttl;
      writeCachedJson_(cache, key, value, cacheTtl);
    }
    return value;
  } finally {
    try {
      lock.releaseLock();
    } catch (ignored) {
      console.warn("Public API cache lock release failed");
    }
  }
}

function isPublicCacheable_(value) {
  if (!value || !value.error) return true;
  return value.errorCode === PUBLIC_ERROR_CODES_.SNAPSHOT_NOT_CONFIGURED ||
    value.errorCode === PUBLIC_ERROR_CODES_.SNAPSHOT_BOUNDARY_MISSING;
}

function readCachedJson_(cache, key) {
  if (!cache) return null;
  try {
    var hit = cache.get(key);
    if (!hit) return null;
    return JSON.parse(hit);
  } catch (ignored) {
    console.warn("Public API cache read failed");
    return null;
  }
}

function writeCachedJson_(cache, key, value, ttl) {
  if (!cache) return;
  try {
    var serialized = JSON.stringify(value);
    if (Utilities.newBlob(serialized).getBytes().length >= PUBLIC_CACHE_MAX_BYTES_) return;
    cache.put(key, serialized, ttl);
  } catch (ignored) {
    console.warn("Public API cache write failed");
  }
}

function parseCanonicalLimit_(value, defaultLimit, allowedLimits) {
  var raw = value === undefined || value === null || value === "" ? String(defaultLimit) : String(value);
  if (!/^\d+$/.test(raw)) return null;
  var parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || allowedLimits.indexOf(parsed) === -1) return null;
  return parsed;
}

function hasOnlyQueryParams_(params, allowedNames) {
  return Object.keys(params).every(function (name) {
    return allowedNames.indexOf(name) !== -1;
  });
}

function hasSingleQueryValues_(parameterLists) {
  return Object.keys(parameterLists).every(function (name) {
    return Array.isArray(parameterLists[name]) && parameterLists[name].length === 1;
  });
}

function isValidIsoDate_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 1) return false;
  var date = createUtcCalendarDate_(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isValidYearMonth_(value) {
  var match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return !!match && Number(match[1]) >= 1;
}

function createUtcCalendarDate_(year, monthIndex, day) {
  var date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function currentJstDate_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
}

function dateStringUtc_(date) {
  return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
}

function isCompleteCalendarMonth_(startDate, endDate) {
  if (startDate.slice(8) !== "01") return false;
  var parts = startDate.split("-").map(Number);
  var expectedEnd = dateStringUtc_(createUtcCalendarDate_(parts[0], parts[1], 0));
  return endDate === expectedEnd;
}

function rollingStartDate_(endDate) {
  var parts = endDate.split("-").map(Number);
  var start = createUtcCalendarDate_(parts[0], parts[1] - 1, parts[2]);
  start.setUTCDate(start.getUTCDate() - 179);
  return dateStringUtc_(start);
}

function isAllowedBlogRange_(startDate, endDate) {
  if (!isValidIsoDate_(startDate) || !isValidIsoDate_(endDate) || startDate > endDate) return false;
  var currentDate = currentJstDate_();
  if (startDate.slice(0, 4) < "2020" || endDate > currentDate) return false;
  if (isCompleteCalendarMonth_(startDate, endDate)) return true;
  return endDate === currentDate && startDate === rollingStartDate_(currentDate);
}

function isAllowedRankingMonth_(month) {
  return isValidYearMonth_(month) && month >= "2020-01" && month < currentJstDate_().slice(0, 7);
}

function callInstagramApi_(endpoint) {
  var token = PropertiesService.getScriptProperties().getProperty("META_PAGE_ACCESS_TOKEN");
  if (!token) return null;
  var url = "https://graph.facebook.com/" + PUBLIC_CONFIG_.GRAPH_API_VERSION + "/" + endpoint;
  try {
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return null;
    var data = JSON.parse(response.getContentText());
    return data && !data.error ? data : null;
  } catch (error) {
    console.error("Instagram upstream request failed");
    return null;
  }
}

function getInstagramPostsWithInsights_(limit) {
  var fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  var payload = callInstagramApi_(PUBLIC_CONFIG_.INSTAGRAM_BUSINESS_ACCOUNT_ID +
    "/media?fields=" + encodeURIComponent(fields) + "&limit=" + limit);
  if (!payload || !Array.isArray(payload.data)) {
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Instagram posts are temporarily unavailable");
  }
  var rows = payload.data.map(function (post) {
    var insights = getPostInsights_(post.id);
    return {
      id: String(post.id || ""),
      permalink: String(post.permalink || ""),
      caption: String(post.caption || "").substring(0, 200),
      media_type: String(post.media_type || ""),
      media_url: String(post.media_url || ""),
      thumbnail_url: String(post.thumbnail_url || post.media_url || ""),
      timestamp: String(post.timestamp || ""),
      like_count: safeSnapshotMetric_(post.like_count),
      comments_count: safeSnapshotMetric_(post.comments_count),
      views: insights.views,
      reach: insights.reach,
      total_interactions: insights.total_interactions,
      saved: insights.saved,
      shares: insights.shares,
    };
  });
  return { data: rows, count: rows.length };
}

function getPostInsights_(mediaId) {
  var result = { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 };
  var payload = callInstagramApi_(encodeURIComponent(String(mediaId)) +
    "/insights?metric=views,reach,saved,shares,total_interactions");
  if (!payload || !Array.isArray(payload.data)) return result;
  payload.data.forEach(function (metric) {
    if (!metric || !Object.prototype.hasOwnProperty.call(result, metric.name) ||
        !Array.isArray(metric.values) || !metric.values.length) return;
    var value = metric.values[0];
    result[metric.name] = safeSnapshotMetric_(value && typeof value === "object" ? value.value : 0);
  });
  return result;
}

function validateInstagramSnapshotSchema_(headers) {
  if (!Array.isArray(headers) || headers.length < INSTAGRAM_SNAPSHOT_HEADERS_.length) {
    throw new Error("invalid snapshot schema");
  }
  var seen = Object.create(null);
  INSTAGRAM_SNAPSHOT_HEADERS_.forEach(function (name, index) {
    if (String(headers[index]) !== name || seen[name]) throw new Error("invalid snapshot schema");
    seen[name] = true;
  });
  headers.slice(INSTAGRAM_SNAPSHOT_HEADERS_.length).forEach(function (header) {
    if (seen[String(header)]) throw new Error("invalid snapshot schema");
  });
}

function safeSnapshotMetric_(value) {
  var numeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizeInstagramSnapshotText_(value) {
  var text = String(value === undefined || value === null ? "" : value);
  var rawPrefix = "'" + INSTAGRAM_SNAPSHOT_TEXT_PREFIX_;
  if (text.indexOf(rawPrefix) === 0) return text.slice(rawPrefix.length);
  if (text.indexOf(INSTAGRAM_SNAPSHOT_TEXT_PREFIX_) === 0) return text.slice(INSTAGRAM_SNAPSHOT_TEXT_PREFIX_.length);
  return text;
}

function readSheetValues_(spreadsheetId, range) {
  var response = Sheets.Spreadsheets.Values.get(spreadsheetId, range, {
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  return response && Array.isArray(response.values) ? response.values : [];
}

function normalizeSheetDate_(value, timeZone) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return "";
    var epoch = Date.UTC(1899, 11, 30);
    var date = new Date(epoch + Math.floor(value) * 86400000);
    return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
  }
  return String(value === undefined || value === null ? "" : value).replace(/\//g, "-");
}

function getInstagramMonthlyRanking_(month, limit) {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!spreadsheetId) {
    return publicError_(PUBLIC_ERROR_CODES_.SNAPSHOT_NOT_CONFIGURED, "Instagram snapshot store is not configured");
  }
  var values = readSheetValues_(spreadsheetId, INSTAGRAM_SNAPSHOT_SHEET_ + "!A:K");
  if (!values.length) return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Instagram snapshot data is unavailable");
  var headers = values.shift();
  validateInstagramSnapshotSchema_(headers);
  var index = {};
  headers.forEach(function (name, i) { index[String(name)] = i; });

  var parts = month.split("-").map(Number);
  var startDate = month + "-01";
  var boundaryDate = Utilities.formatDate(createUtcCalendarDate_(parts[0], parts[1], 1), "UTC", "yyyy-MM-dd");
  var endDate = Utilities.formatDate(createUtcCalendarDate_(parts[0], parts[1], 0), "UTC", "yyyy-MM-dd");
  var byDate = Object.create(null);
  values.forEach(function (row) {
    var date = normalizeSheetDate_(row[index.snapshotDate], "Asia/Tokyo");
    if (date !== startDate && date !== boundaryDate) return;
    var id = normalizeInstagramSnapshotText_(row[index.mediaId]);
    if (!id) return;
    if (!byDate[date]) byDate[date] = Object.create(null);
    byDate[date][id] = row;
  });
  if (!byDate[startDate] || !byDate[boundaryDate]) {
    return publicError_(PUBLIC_ERROR_CODES_.SNAPSHOT_BOUNDARY_MISSING, "Complete month boundary snapshots are required");
  }
  var rows = Object.keys(byDate[boundaryDate]).filter(function (id) {
    return Object.prototype.hasOwnProperty.call(byDate[startDate], id);
  }).map(function (id) {
    var first = byDate[startDate][id];
    var last = byDate[boundaryDate][id];
    return {
      id: id,
      timestamp: normalizeInstagramSnapshotText_(last[index.timestamp]),
      permalink: normalizeInstagramSnapshotText_(last[index.permalink]),
      caption: normalizeInstagramSnapshotText_(last[index.caption]),
      media_type: normalizeInstagramSnapshotText_(last[index.mediaType]),
      viewsDelta: Math.max(0, safeSnapshotMetric_(last[index.views]) - safeSnapshotMetric_(first[index.views])),
      totalInteractionsDelta: Math.max(0, safeSnapshotMetric_(last[index.totalInteractions]) - safeSnapshotMetric_(first[index.totalInteractions])),
    };
  });
  rows.sort(function (a, b) {
    var metric = b.viewsDelta - a.viewsDelta || b.totalInteractionsDelta - a.totalInteractionsDelta;
    if (metric) return metric;
    var aTime = Number.isFinite(Date.parse(a.timestamp)) ? Date.parse(a.timestamp) : Number.NEGATIVE_INFINITY;
    var bTime = Number.isFinite(Date.parse(b.timestamp)) ? Date.parse(b.timestamp) : Number.NEGATIVE_INFINITY;
    return bTime - aTime || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
  return {
    data: rows.slice(0, limit),
    period: { month: month, startDate: startDate, endDate: endDate, timezone: "Asia/Tokyo", boundarySnapshotDate: boundaryDate },
    partial: false,
  };
}

function getBlogRankingFromGA4_(startDate, endDate, limit) {
  try {
    var report = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: {
        matchType: "PARTIAL_REGEXP", value: "^/20\\d{2}/\\d{2}/\\d{2}/",
      } } },
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 500,
    }, "properties/" + PUBLIC_CONFIG_.GA4_PROPERTY_HOMEPAGE);
    var byPath = Object.create(null);
    (report.rows || []).forEach(function (row) {
      var pagePath = String(row.dimensionValues[0].value || "").split("?")[0];
      if (!/^\/20\d{2}\/\d{2}\/\d{2}\//.test(pagePath)) return;
      var title = String(row.dimensionValues[1].value || "");
      if (!byPath[pagePath]) byPath[pagePath] = { title: title, pageViews: 0, totalUsers: 0 };
      byPath[pagePath].pageViews += safeSnapshotMetric_(row.metricValues[0].value);
      byPath[pagePath].totalUsers += safeSnapshotMetric_(row.metricValues[1].value);
      if (title && !byPath[pagePath].title) byPath[pagePath].title = title;
    });
    var rows = Object.keys(byPath).map(function (pagePath) {
      var item = byPath[pagePath];
      var dateParts = pagePath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\//);
      return {
        url: PUBLIC_CONFIG_.BLOG_ORIGIN + pagePath,
        title: item.title.replace(/[\|｜][^|｜]+$/, "").trim(),
        date: dateParts ? dateParts[1] + "-" + dateParts[2] + "-" + dateParts[3] : null,
        pageViews: item.pageViews,
        totalUsers: item.totalUsers,
      };
    });
    rows.sort(function (a, b) { return b.pageViews - a.pageViews || b.totalUsers - a.totalUsers || a.url.localeCompare(b.url); });
    return { data: rows.slice(0, limit), count: rows.length, period: { startDate: startDate, endDate: endDate } };
  } catch (error) {
    console.error("GA4 upstream request failed");
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Blog ranking is temporarily unavailable");
  }
}

function getPodcastList_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("PODCAST_SPREADSHEET_ID");
  if (!spreadsheetId) {
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Podcast list is temporarily unavailable");
  }
  try {
    var values = readSheetValues_(spreadsheetId, "'Podcast一覧'!A:H");
    var rows = [];
    for (var i = 1; i < values.length; i += 1) {
      var row = values[i];
      var platform = String(row[1] || "").trim();
      var title = String(row[2] || "").trim();
      if (platform !== "YouTube" || !title || title.indexOf("【music】") !== -1) continue;
      var published = row[3];
      var date = normalizeSheetDate_(published, "Asia/Tokyo");
      rows.push({
        id: String(row[7] || "").trim(),
        title: title,
        date: date,
        url: String(row[4] || "").trim(),
        youtubeId: String(row[7] || "").trim(),
      });
    }
    return boundedPodcastResponse_(rows);
  } catch (error) {
    console.error("Podcast upstream request failed");
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Podcast list is temporarily unavailable");
  }
}

function boundedPodcastResponse_(rows) {
  var totalCount = rows.length;
  var full = { data: rows, count: totalCount };
  if (Utilities.newBlob(JSON.stringify(full)).getBytes().length < PUBLIC_RESPONSE_MAX_BYTES_) {
    return full;
  }

  var low = 0;
  var high = totalCount - 1;
  var best = 0;
  while (low <= high) {
    var count = Math.floor((low + high) / 2);
    var candidate = {
      data: rows.slice(0, count),
      count: count,
      totalCount: totalCount,
      truncated: true,
    };
    if (Utilities.newBlob(JSON.stringify(candidate)).getBytes().length < PUBLIC_RESPONSE_MAX_BYTES_) {
      best = count;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return {
    data: rows.slice(0, best),
    count: best,
    totalCount: totalCount,
    truncated: true,
  };
}
