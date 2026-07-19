var PUBLIC_CONFIG_ = {
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841470265749902",
  GRAPH_API_VERSION: "v24.0",
  GA4_PROPERTY_HOMEPAGE: "373025643",
  BLOG_ORIGIN: "https://gohome-clinic.com",
};

var PUBLIC_ERROR_CODES_ = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  SNAPSHOT_NOT_CONFIGURED: "SNAPSHOT_NOT_CONFIGURED",
  SNAPSHOT_BOUNDARY_MISSING: "SNAPSHOT_BOUNDARY_MISSING",
};

var INSTAGRAM_SNAPSHOT_SHEET_ = "instagram_daily";
var INSTAGRAM_SNAPSHOT_TEXT_PREFIX_ = "\u200B";
var INSTAGRAM_SNAPSHOT_HEADERS_ = [
  "snapshotDate", "mediaId", "timestamp", "permalink", "caption", "mediaType",
  "views", "reach", "totalInteractions", "saved", "shares",
];

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var result;
  try {
    result = handlePublicApiRequest_(params);
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
    var startDate = String(params.startDate || "");
    var endDate = String(params.endDate || "");
    var blogLimit = parseApiLimit_(params.limit, 100, 100);
    if (!isValidIsoDate_(startDate) || !isValidIsoDate_(endDate) || startDate > endDate) {
      return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, "blog-ranking requires valid startDate and endDate");
    }
    return cachedJson_("blog:" + startDate + ":" + endDate + ":" + blogLimit, 600, function () {
      return getBlogRankingFromGA4_(startDate, endDate, blogLimit);
    });
  }
  if (api === "instagram-posts") {
    var postsLimit = parseApiLimit_(params.limit, 30, 100);
    return cachedJson_("instagram-posts:" + postsLimit, 600, function () {
      return getInstagramPostsWithInsights_(postsLimit);
    });
  }
  if (api === "instagram-monthly-ranking") {
    var month = String(params.month || "");
    var rankingLimit = parseApiLimit_(params.limit, 3, 100);
    if (!isValidYearMonth_(month)) {
      return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, "month must be YYYY-MM");
    }
    return cachedJson_("instagram-monthly:" + month + ":" + rankingLimit, 600, function () {
      return getInstagramMonthlyRanking_(month, rankingLimit);
    });
  }
  if (api === "podcast-list") {
    return cachedJson_("podcast-list", 600, getPodcastList_);
  }
  return publicError_(PUBLIC_ERROR_CODES_.INVALID_REQUEST, "Unknown api");
}

function publicError_(code, message) {
  return { error: message, errorCode: code, data: [] };
}

function cachedJson_(key, ttl, loader) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (ignored) { console.warn("Invalid public API cache entry"); }
  }
  var value = loader();
  cache.put(key, JSON.stringify(value), ttl);
  return value;
}

function parseApiLimit_(value, defaultLimit, maxLimit) {
  var raw = value === undefined || value === null || value === "" ? String(defaultLimit) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error("invalid limit");
  var parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxLimit) throw new Error("invalid limit");
  return parsed;
}

function isValidIsoDate_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  var date = createUtcCalendarDate_(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function isValidYearMonth_(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function createUtcCalendarDate_(year, monthIndex, day) {
  var date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
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

function getInstagramMonthlyRanking_(month, limit) {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!spreadsheetId) {
    return publicError_(PUBLIC_ERROR_CODES_.SNAPSHOT_NOT_CONFIGURED, "Instagram snapshot store is not configured");
  }
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(INSTAGRAM_SNAPSHOT_SHEET_);
  if (!sheet) return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Instagram snapshot data is unavailable");
  var values = sheet.getDataRange().getValues();
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
    var date = String(row[index.snapshotDate]);
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
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Podcast一覧");
    if (!sheet) return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Podcast list is temporarily unavailable");
    var values = sheet.getDataRange().getValues();
    var rows = [];
    for (var i = 1; i < values.length; i += 1) {
      var row = values[i];
      var platform = String(row[1] || "").trim();
      var title = String(row[2] || "").trim();
      if (platform !== "YouTube" || !title || title.indexOf("【music】") !== -1) continue;
      var published = row[3];
      var date = published instanceof Date
        ? Utilities.formatDate(published, "Asia/Tokyo", "yyyy-MM-dd")
        : String(published || "").replace(/\//g, "-");
      rows.push({
        id: String(row[7] || "").trim(),
        title: title,
        date: date,
        url: String(row[4] || "").trim(),
        youtubeId: String(row[7] || "").trim(),
      });
    }
    return { data: rows, count: rows.length };
  } catch (error) {
    console.error("Podcast upstream request failed");
    return publicError_(PUBLIC_ERROR_CODES_.UPSTREAM_UNAVAILABLE, "Podcast list is temporarily unavailable");
  }
}
