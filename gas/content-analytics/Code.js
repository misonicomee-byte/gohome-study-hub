/**
 * Instagram Ad Strategy Dashboard - GAS Web App
 * Instagram広告のキャンペーン効果を分析し、採用戦略を支援するダッシュボード
 */

// ===== CONFIG =====
const CONFIG = {
  // Instagram API
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841470265749902",
  FACEBOOK_PAGE_ID: "111003450282670",
  ACCESS_TOKEN:
    PropertiesService.getScriptProperties().getProperty("META_PAGE_ACCESS_TOKEN"),
  API_VERSION: "v24.0",
  BASE_URL: "https://graph.facebook.com",

  // GA4
  GA4_PROPERTY_HOMEPAGE: "373025643",
  GA4_PROPERTY_RECRUIT: "475345386",
  CTA_PAGE_PATH: "/recruit/recruit_meeting/",

  // Meta Ads
  AD_ACCOUNT_ID: "act_1420246729447851",
  // User Access Token with ads_read permission (for Marketing API)
  ADS_ACCESS_TOKEN:
    PropertiesService.getScriptProperties().getProperty("META_ADS_ACCESS_TOKEN"),
  // UTM campaign name → Meta Ads campaign name mapping
  // Key: utm_campaign value (appears in GA4), Value: Meta Ads campaign name
  CAMPAIGN_NAME_MAP: {
    "nurse_1": "訪問診療の看護師",
  },
  // Daily budget fallback (used when Marketing API token not available)
  DAILY_BUDGET_JPY: 2000,

  // Cache Spreadsheet (set after creating)
  CACHE_SPREADSHEET_ID: "",

  // Cache TTL (hours)
  CACHE_TTL_HOURS: 24,

  // ChatWork
  CHATWORK_API_TOKEN: PropertiesService.getScriptProperties().getProperty('CHATWORK_API_TOKEN'),
  CHATWORK_ROOM_ID: "396889730",
};

// ===== WEB APP ENTRY POINT =====
function doGet(e) {
  // JSON API endpoint (for external sites like study.gohome-clinic.com)
  if (e && e.parameter && e.parameter.api) {
    return handleApiRequest_(e.parameter);
  }

  const template = HtmlService.createTemplateFromFile("index");
  return template
    .evaluate()
    .setTitle("Instagram広告戦略ダッシュボード | ごうホームクリニック")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * 外部サイト（study.gohome-clinic.com など）からの JSON データ取得用
 * 使い方: ?api=instagram-posts&limit=30
 */
function handleApiRequest_(params) {
  let result;
  try {
    switch (params.api) {
      case "instagram-posts": {
        const limit = parseApiLimit_(params.limit, 30, 100);
        result = getInstagramPostsWithInsights(limit);
        break;
      }
      case "instagram-summary": {
        // 簡易サマリー：投稿数、平均like、平均reach
        const limit = parseApiLimit_(params.limit, 30, 100);
        const posts = getInstagramPostsWithInsights(limit);
        if (posts.error) {
          result = posts;
        } else {
          const arr = posts.data || [];
          const sum = function (key) { return arr.reduce(function (a, p) { return a + (p[key] || 0); }, 0); };
          result = {
            count: arr.length,
            total_likes: sum("like_count"),
            total_comments: sum("comments_count"),
            total_saved: sum("saved"),
            total_reach: sum("reach"),
            avg_likes: arr.length ? Math.round(sum("like_count") / arr.length) : 0,
            avg_reach: arr.length ? Math.round(sum("reach") / arr.length) : 0,
            latest_timestamp: arr.length ? arr[0].timestamp : null,
          };
        }
        break;
      }
      case "podcast-list": {
        // 共有スプレッドシート Podcast一覧シートを返す（YouTubeのみ、【music】除外）
        result = getPodcastList_();
        break;
      }
      case "blog-ranking": {
        // gohome-clinic.com 本院サイトの blog 記事一覧（PV/UU・公開日付き）
        // 戻り値: [{ url, title, pageViews, totalUsers, date }]
        const startDate = String(params.startDate || "");
        const endDate = String(params.endDate || "");
        const limit = parseApiLimit_(params.limit, 100, 100);
        if (!isValidIsoDate_(startDate) || !isValidIsoDate_(endDate) || startDate > endDate) {
          throw new Error("blog-ranking requires valid startDate and endDate");
        }
        result = getBlogRankingFromGA4_(startDate, endDate, limit);
        break;
      }
      case "instagram-monthly-ranking": {
        const month = String(params.month || "");
        if (!isValidYearMonth_(month)) {
          throw new Error("month must be YYYY-MM");
        }
        const limit = parseApiLimit_(params.limit, 3, 100);
        result = getInstagramMonthlyRanking_(month, limit);
        break;
      }
      default:
        result = { error: "Unknown api: " + params.api };
    }
  } catch (err) {
    result = { error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseApiLimit_(value, defaultLimit, maxLimit) {
  var raw = value === undefined || value === null || value === ""
    ? String(defaultLimit)
    : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error("limit must be a positive integer up to " + maxLimit);
  }
  var limit = Number(raw);
  if (limit < 1 || limit > maxLimit) {
    throw new Error("limit must be a positive integer up to " + maxLimit);
  }
  return limit;
}

function isValidIsoDate_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  var daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (isLeapYear) daysByMonth[1] = 29;
  return day <= daysByMonth[month - 1];
}

function isValidYearMonth_(value) {
  var match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) >= 1 && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===== META MARKETING API (Ad Spend) =====
function getAdsToken() {
  // Priority: Script Properties (auto-refreshed) > Config hardcoded > Page token
  var stored = PropertiesService.getScriptProperties().getProperty("ADS_LONG_LIVED_TOKEN");
  return stored || CONFIG.ADS_ACCESS_TOKEN || CONFIG.ACCESS_TOKEN;
}

function callMetaApi(endpoint) {
  var separator = endpoint.indexOf("?") === -1 ? "?" : "&";
  var token = getAdsToken();
  var url = CONFIG.BASE_URL + "/" + CONFIG.API_VERSION + "/" + endpoint + separator + "access_token=" + token;

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());

    if (data.error) {
      console.error("Meta API Error:", data.error);
      return { error: data.error.message };
    }
    return data;
  } catch (error) {
    console.error("Meta API Fetch Error:", error);
    return { error: error.toString() };
  }
}

function getAdAccountId() {
  // Find ad accounts linked to the page/user
  var data = callMetaApi("me/adaccounts?fields=id,name,account_status,currency,timezone_name");
  if (data.error) {
    // Try via page
    data = callMetaApi(CONFIG.FACEBOOK_PAGE_ID + "/page_backed_instagram_accounts");
    if (data.error) return { error: data.error };
  }
  return data;
}

function getAdCampaignSpend(adAccountId, startDate, endDate) {
  if (!adAccountId) return { error: "Ad Account ID not configured", data: [] };

  var timeRange = encodeURIComponent('{"since":"' + startDate + '","until":"' + endDate + '"}');
  var endpoint = adAccountId + "/insights?" +
    "fields=campaign_name,spend,impressions,clicks,cpc,cpm,actions,unique_actions,cost_per_action_type" +
    "&level=campaign" +
    "&time_range=" + timeRange +
    "&time_increment=1";

  console.log("Meta Ads API query: startDate=" + startDate + ", endDate=" + endDate);

  var allRows = [];
  var data = callMetaApi(endpoint);

  if (data.error) return { error: data.error, data: [], queryDates: { start: startDate, end: endDate } };

  // Handle pagination
  while (data) {
    if (data.data) {
      allRows = allRows.concat(data.data);
    }
    if (data.paging && data.paging.next) {
      try {
        var response = UrlFetchApp.fetch(data.paging.next, { muteHttpExceptions: true });
        data = JSON.parse(response.getContentText());
      } catch (e) {
        break;
      }
    } else {
      break;
    }
  }

  var rows = allRows.map(function (row) {
    var actions = {};
    (row.actions || []).forEach(function (a) {
      actions[a.action_type] = parseInt(a.value) || 0;
    });

    var uniqueActions = {};
    (row.unique_actions || []).forEach(function (a) {
      uniqueActions[a.action_type] = parseInt(a.value) || 0;
    });

    var costPerAction = {};
    (row.cost_per_action_type || []).forEach(function (c) {
      costPerAction[c.action_type] = parseFloat(c.value) || 0;
    });

    return {
      campaign_name: row.campaign_name || "",
      date: row.date_start || "",
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      clicks: parseInt(row.clicks) || 0,
      cpc: parseFloat(row.cpc) || 0,
      cpm: parseFloat(row.cpm) || 0,
      link_clicks: actions.link_click || 0,
      unique_link_clicks: uniqueActions.link_click || 0,
      landing_page_views: actions.landing_page_view || 0,
      actions: actions,
      unique_actions: uniqueActions,
      cost_per_action: costPerAction,
    };
  });

  // Filter rows to requested date range (safety net)
  var filteredRows = rows.filter(function (row) {
    return row.date >= startDate && row.date <= endDate;
  });

  console.log("Meta Ads: " + allRows.length + " raw rows, " + filteredRows.length + " after date filter (" + startDate + " ~ " + endDate + ")");

  return { data: filteredRows, queryDates: { start: startDate, end: endDate }, rawRowCount: allRows.length };
}

function getAdCampaignSpendSummary(adAccountId, startDate, endDate) {
  if (!adAccountId) return { error: "Ad Account ID not configured", data: [] };

  var timeRange = encodeURIComponent('{"since":"' + startDate + '","until":"' + endDate + '"}');
  var endpoint = adAccountId + "/insights?" +
    "fields=campaign_name,spend,impressions,clicks,cpc,cpm,actions,cost_per_action_type" +
    "&level=campaign" +
    "&time_range=" + timeRange;

  var data = callMetaApi(endpoint);

  if (data.error) return { error: data.error, data: [] };

  return {
    data: (data.data || []).map(function (row) {
      var actions = {};
      (row.actions || []).forEach(function (a) {
        actions[a.action_type] = parseInt(a.value) || 0;
      });

      return {
        campaign_name: row.campaign_name || "",
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        link_clicks: actions.link_click || 0,
        landing_page_views: actions.landing_page_view || 0,
      };
    }),
  };
}

// ===== INSTAGRAM API =====
function callInstagramApi(endpoint) {
  const url = `${CONFIG.BASE_URL}/${CONFIG.API_VERSION}/${endpoint}&access_token=${CONFIG.ACCESS_TOKEN}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());

    if (data.error) {
      console.error("Instagram API Error:", data.error);
      return { error: data.error.message };
    }
    return data;
  } catch (error) {
    console.error("Instagram Fetch Error:", error);
    return { error: error.toString() };
  }
}

function getInstagramPosts(limit) {
  limit = limit || 50;
  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const data = callInstagramApi(
    `${CONFIG.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media?fields=${fields}&limit=${limit}`
  );

  if (data.error) return data;

  const posts = data.data || [];
  return { data: posts, count: posts.length };
}

function getPostInsights(mediaId) {
  const data = callInstagramApi(
    `${mediaId}/insights?metric=views,reach,saved,shares,total_interactions`
  );

  const result = { views: 0, reach: 0, saved: 0, shares: 0, total_interactions: 0 };
  if (!data || data.error || !Array.isArray(data.data)) return result;

  data.data.forEach(function (metric) {
    if (!metric || !Object.prototype.hasOwnProperty.call(result, metric.name) ||
        !Array.isArray(metric.values) || !metric.values.length) return;

    var value = metric.values[0];
    var raw = value && typeof value === "object" ? value.value : undefined;
    var numeric = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")
      ? Number(raw)
      : NaN;
    if (Number.isFinite(numeric) && numeric >= 0) {
      result[metric.name] = numeric;
    }
  });
  return result;
}

function getInstagramPostsWithInsights(limit) {
  const postsResult = getInstagramPosts(limit);
  if (postsResult.error) return postsResult;

  const postsWithInsights = postsResult.data.map(function (post) {
    const insights = getPostInsights(post.id);
    return {
      id: post.id,
      permalink: post.permalink,
      caption: (post.caption || "").substring(0, 200),
      media_type: post.media_type,
      media_url: post.media_url || "",
      thumbnail_url: post.thumbnail_url || post.media_url || "",
      timestamp: post.timestamp,
      like_count: post.like_count || 0,
      comments_count: post.comments_count || 0,
      views: insights.views,
      reach: insights.reach,
      total_interactions: insights.total_interactions,
      saved: insights.saved,
      shares: insights.shares,
    };
  });

  return { data: postsWithInsights, count: postsWithInsights.length };
}

// ===== INSTAGRAM DAILY SNAPSHOTS =====
var INSTAGRAM_SNAPSHOT_SHEET_ = "instagram_daily";
var INSTAGRAM_SNAPSHOT_LOCK_TIMEOUT_MS_ = 30000;
var INSTAGRAM_SNAPSHOT_TEXT_PREFIX_ = "\u200B";
var INSTAGRAM_SNAPSHOT_HEADERS_ = [
  "snapshotDate",
  "mediaId",
  "timestamp",
  "permalink",
  "caption",
  "mediaType",
  "views",
  "reach",
  "totalInteractions",
  "saved",
  "shares",
];

function validateInstagramSnapshotSchema_(headers) {
  if (!Array.isArray(headers) || headers.length < INSTAGRAM_SNAPSHOT_HEADERS_.length) {
    throw new Error("Instagram snapshot sheet schema is invalid");
  }
  for (var i = 0; i < INSTAGRAM_SNAPSHOT_HEADERS_.length; i += 1) {
    if (String(headers[i]) !== INSTAGRAM_SNAPSHOT_HEADERS_[i]) {
      throw new Error("Instagram snapshot sheet schema is invalid");
    }
  }

  var required = Object.create(null);
  var seen = Object.create(null);
  INSTAGRAM_SNAPSHOT_HEADERS_.forEach(function (name) {
    required[name] = true;
  });
  headers.forEach(function (header) {
    var name = String(header);
    if (!required[name]) return;
    if (seen[name]) throw new Error("Instagram snapshot sheet schema is invalid");
    seen[name] = true;
  });
}

function getInstagramSnapshotSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(INSTAGRAM_SNAPSHOT_SHEET_);
  if (!sheet) throw new Error("instagram_daily snapshot sheet is missing");
  return sheet;
}

function getInstagramSnapshotHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
}

function safeSnapshotMetric_(value) {
  var numeric = typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")
    ? Number(value)
    : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function encodeInstagramSnapshotText_(value) {
  var text = String(value === undefined || value === null ? "" : value);
  if (/^[=+\-@']/.test(text) || text.indexOf(INSTAGRAM_SNAPSHOT_TEXT_PREFIX_) === 0) {
    return "'" + INSTAGRAM_SNAPSHOT_TEXT_PREFIX_ + text;
  }
  return text;
}

function normalizeInstagramSnapshotText_(value) {
  var text = String(value === undefined || value === null ? "" : value);
  var rawPrefix = "'" + INSTAGRAM_SNAPSHOT_TEXT_PREFIX_;
  if (text.indexOf(rawPrefix) === 0) return text.slice(rawPrefix.length);
  if (text.indexOf(INSTAGRAM_SNAPSHOT_TEXT_PREFIX_) === 0) {
    return text.slice(INSTAGRAM_SNAPSHOT_TEXT_PREFIX_.length);
  }
  return text;
}

function createUtcCalendarDate_(year, monthIndex, day) {
  var date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function setupInstagramSnapshotStore() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(INSTAGRAM_SNAPSHOT_LOCK_TIMEOUT_MS_)) {
    throw new Error("Could not acquire Instagram snapshot setup lock");
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
    var spreadsheet = id
      ? SpreadsheetApp.openById(id)
      : SpreadsheetApp.create("Instagram content snapshots");

    if (!id) {
      id = spreadsheet.getId();
      props.setProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID", id);
    }

    var sheet = spreadsheet.getSheetByName(INSTAGRAM_SNAPSHOT_SHEET_) ||
      spreadsheet.insertSheet(INSTAGRAM_SNAPSHOT_SHEET_);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(INSTAGRAM_SNAPSHOT_HEADERS_);
    } else {
      validateInstagramSnapshotSchema_(getInstagramSnapshotHeaders_(sheet));
    }

    var dailyTriggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === "runDailyInstagramSnapshot";
    });
    dailyTriggers.slice(1).forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
    if (dailyTriggers.length === 0) {
      ScriptApp.newTrigger("runDailyInstagramSnapshot")
        .timeBased()
        .everyDays(1)
        .atHour(6)
        .create();
    }

    return { spreadsheetId: id, sheet: sheet.getName() };
  } finally {
    lock.releaseLock();
  }
}

function runDailyInstagramSnapshot() {
  var id = PropertiesService.getScriptProperties()
    .getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!id) throw new Error("Run setupInstagramSnapshotStore first");

  var sheet = getInstagramSnapshotSheet_(SpreadsheetApp.openById(id));
  if (sheet.getLastRow() === 0) {
    throw new Error("Instagram snapshot sheet schema is missing");
  }
  validateInstagramSnapshotSchema_(getInstagramSnapshotHeaders_(sheet));

  var posts = getInstagramPostsWithInsights(100);
  if (!posts || posts.error) {
    throw new Error(posts && posts.error ? posts.error : "Instagram snapshot API failed");
  }
  if (!Array.isArray(posts.data)) {
    throw new Error("Instagram snapshot API returned invalid data");
  }

  var snapshotDate = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  var rows = posts.data.map(function (post) {
    if (!post || post.id === undefined || post.id === null || String(post.id) === "") {
      throw new Error("Instagram snapshot post is missing a media id");
    }
    return [
      snapshotDate,
      encodeInstagramSnapshotText_(post.id),
      encodeInstagramSnapshotText_(post.timestamp || ""),
      encodeInstagramSnapshotText_(post.permalink || ""),
      encodeInstagramSnapshotText_(post.caption || ""),
      encodeInstagramSnapshotText_(post.media_type || ""),
      safeSnapshotMetric_(post.views),
      safeSnapshotMetric_(post.reach),
      safeSnapshotMetric_(post.total_interactions),
      safeSnapshotMetric_(post.saved),
      safeSnapshotMetric_(post.shares),
    ];
  });

  if (rows.length) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(INSTAGRAM_SNAPSHOT_LOCK_TIMEOUT_MS_)) {
      throw new Error("Could not acquire Instagram snapshot append lock");
    }
    try {
      id = PropertiesService.getScriptProperties()
        .getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
      if (!id) throw new Error("Run setupInstagramSnapshotStore first");

      sheet = getInstagramSnapshotSheet_(SpreadsheetApp.openById(id));
      var lastRow = sheet.getLastRow();
      if (lastRow === 0) {
        throw new Error("Instagram snapshot sheet schema is missing");
      }
      validateInstagramSnapshotSchema_(getInstagramSnapshotHeaders_(sheet));
      sheet.getRange(
        lastRow + 1,
        1,
        rows.length,
        INSTAGRAM_SNAPSHOT_HEADERS_.length
      ).setValues(rows);
    } finally {
      lock.releaseLock();
    }
  }
  return { snapshotDate: snapshotDate, rowsAppended: rows.length };
}

function getInstagramMonthlyRanking_(month, limit) {
  if (!isValidYearMonth_(month)) throw new Error("month must be YYYY-MM");
  limit = parseApiLimit_(limit, 3, 100);

  var id = PropertiesService.getScriptProperties()
    .getProperty("CONTENT_SNAPSHOT_SPREADSHEET_ID");
  if (!id) throw new Error("Instagram snapshot store is not configured");

  var sheet = getInstagramSnapshotSheet_(SpreadsheetApp.openById(id));
  var values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error("Instagram snapshot sheet schema is missing");
  var headers = values.shift();
  validateInstagramSnapshotSchema_(headers);

  var index = {};
  headers.forEach(function (name, headerIndex) {
    index[String(name)] = headerIndex;
  });

  var parts = month.split("-").map(Number);
  var startDate = month + "-01";
  var boundarySnapshotDate = Utilities.formatDate(
    createUtcCalendarDate_(parts[0], parts[1], 1),
    "UTC",
    "yyyy-MM-dd"
  );
  var endDate = Utilities.formatDate(
    createUtcCalendarDate_(parts[0], parts[1], 0),
    "UTC",
    "yyyy-MM-dd"
  );
  var byDate = Object.create(null);

  values.forEach(function (row) {
    var date = String(row[index.snapshotDate]);
    if (date !== startDate && date !== boundarySnapshotDate) return;
    var mediaId = normalizeInstagramSnapshotText_(row[index.mediaId]);
    if (!mediaId) return;
    if (!byDate[date]) byDate[date] = Object.create(null);
    // Append-only rows are chronological, so assignment makes the latest capture win.
    byDate[date][mediaId] = row;
  });

  if (!byDate[startDate] || !byDate[boundarySnapshotDate]) {
    throw new Error("Complete month boundary snapshots are required");
  }

  var rows = Object.keys(byDate[boundarySnapshotDate])
    .filter(function (mediaId) {
      return Object.prototype.hasOwnProperty.call(byDate[startDate], mediaId);
    })
    .map(function (mediaId) {
      var first = byDate[startDate][mediaId];
      var last = byDate[boundarySnapshotDate][mediaId];
      return {
        id: mediaId,
        timestamp: normalizeInstagramSnapshotText_(last[index.timestamp]),
        permalink: normalizeInstagramSnapshotText_(last[index.permalink]),
        caption: normalizeInstagramSnapshotText_(last[index.caption]),
        media_type: normalizeInstagramSnapshotText_(last[index.mediaType]),
        viewsDelta: Math.max(
          0,
          safeSnapshotMetric_(last[index.views]) - safeSnapshotMetric_(first[index.views])
        ),
        totalInteractionsDelta: Math.max(
          0,
          safeSnapshotMetric_(last[index.totalInteractions]) -
            safeSnapshotMetric_(first[index.totalInteractions])
        ),
      };
    });

  rows.sort(function (a, b) {
    var metricDifference = b.viewsDelta - a.viewsDelta ||
      b.totalInteractionsDelta - a.totalInteractionsDelta;
    if (metricDifference) return metricDifference;

    var aTime = Date.parse(a.timestamp);
    var bTime = Date.parse(b.timestamp);
    aTime = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
    bTime = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
    if (bTime !== aTime) return bTime - aTime;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  return {
    data: rows.slice(0, limit),
    period: {
      month: month,
      startDate: startDate,
      endDate: endDate,
      timezone: "Asia/Tokyo",
      boundarySnapshotDate: boundarySnapshotDate,
    },
    partial: false,
  };
}

// ===== GA4 API =====
function getGA4CampaignData(propertyId, startDate, endDate) {
  try {
    const report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [
          { name: "sessionCampaignName" },
          { name: "sessionSource" },
          { name: "sessionMedium" },
          { name: "date" },
        ],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "bounceRate" },
          { name: "screenPageViews" },
          { name: "userEngagementDuration" },
        ],
        dimensionFilter: {
          orGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: {
                    matchType: "CONTAINS",
                    value: "instagram",
                    caseSensitive: false,
                  },
                },
              },
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: {
                    matchType: "CONTAINS",
                    value: "ig",
                    caseSensitive: false,
                  },
                },
              },
              {
                filter: {
                  fieldName: "sessionMedium",
                  stringFilter: {
                    matchType: "EXACT",
                    value: "paid",
                    caseSensitive: false,
                  },
                },
              },
            ],
          },
        },
        orderBys: [{ dimension: { dimensionName: "date" }, desc: true }],
        limit: 10000,
      },
      "properties/" + propertyId
    );

    return parseGA4Report(report, [
      "campaignName",
      "source",
      "medium",
      "date",
    ]);
  } catch (e) {
    console.error("GA4 Campaign Data Error:", e);
    return { error: e.message, rows: [] };
  }
}

function getGA4AllTrafficByChannel(propertyId, startDate, endDate) {
  try {
    const report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [
          { name: "sessionDefaultChannelGroup" },
          { name: "sessionCampaignName" },
        ],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "bounceRate" },
          { name: "screenPageViews" },
          { name: "userEngagementDuration" },
        ],
        orderBys: [
          { metric: { metricName: "sessions" }, desc: true },
        ],
        limit: 100,
      },
      "properties/" + propertyId
    );

    return parseGA4Report(report, ["channelGroup", "campaignName"]);
  } catch (e) {
    console.error("GA4 All Traffic Error:", e);
    return { error: e.message, rows: [] };
  }
}

function getGA4CTAPageViews(propertyId, startDate, endDate) {
  // NOTE: Recruiting site property - Instagram source filter NOT applied
  // because sessions arrive via homepage referral, not directly from Instagram
  try {
    const report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [
          { name: "sessionCampaignName" },
          { name: "pagePath" },
        ],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: {
              matchType: "CONTAINS",
              value: CONFIG.CTA_PAGE_PATH,
            },
          },
        },
        orderBys: [
          { metric: { metricName: "screenPageViews" }, desc: true },
        ],
        limit: 100,
      },
      "properties/" + propertyId
    );

    return parseGA4Report(report, ["campaignName", "pagePath"]);
  } catch (e) {
    console.error("GA4 CTA Page Views Error:", e);
    return { error: e.message, rows: [] };
  }
}

function getGA4FormSubmissions(propertyId, startDate, endDate) {
  // Use recruiting site property for form events
  // NOTE: Instagram source filter NOT applied because sessions arrive
  // via homepage referral, not directly from Instagram (cross-property)
  var propId = propertyId || CONFIG.GA4_PROPERTY_RECRUIT;

  try {
    var report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [{ name: "sessionCampaignName" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: ["thankscv", "telcv", "form_start"],
            },
          },
        },
        limit: 100,
      },
      "properties/" + propId
    );

    return parseGA4Report(report, ["campaignName", "eventName"]);
  } catch (e) {
    console.error("GA4 Form Submissions Error:", e);
    return { error: e.message, rows: [] };
  }
}

function getGA4FormSubmissionsFirstTouch(propertyId, startDate, endDate) {
  var propId = propertyId || CONFIG.GA4_PROPERTY_RECRUIT;

  try {
    var report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [{ name: "firstUserCampaignName" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: ["thankscv", "telcv", "form_start"],
            },
          },
        },
        limit: 100,
      },
      "properties/" + propId
    );

    return parseGA4Report(report, ["campaignName", "eventName"]);
  } catch (e) {
    console.error("GA4 Form Submissions (First Touch) Error:", e);
    return { error: e.message, rows: [] };
  }
}

/**
 * Podcast一覧スプレッドシートから YouTube エピソード一覧を取得
 * - 共有スプレッドシート: 1mPg_kiLfHtGBwnvE9DERfdZB_4cRYRuIGcySoTQQuVY
 * - シート: Podcast一覧
 * - フィルタ: プラットフォーム=YouTube、タイトルに【music】を含まない
 *
 * 戻り値: { data: [{ id, title, date, url, youtubeId }], count }
 */
function getPodcastList_() {
  var SPREADSHEET_ID = "1mPg_kiLfHtGBwnvE9DERfdZB_4cRYRuIGcySoTQQuVY";
  var SHEET_NAME = "Podcast一覧";
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return { error: "Sheet not found: " + SHEET_NAME, data: [] };

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { data: [], count: 0 };

    // ヘッダー: No. | プラットフォーム | タイトル | 公開日 | URL | 埋め込みコード | 再生時間 | ID
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var platform = String(r[1] || "").trim();
      var title = String(r[2] || "").trim();
      if (platform !== "YouTube") continue;
      if (!title) continue;
      if (title.indexOf("【music】") !== -1) continue;

      var date = r[3];
      var dateStr = "";
      if (date instanceof Date) {
        dateStr = Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd");
      } else {
        dateStr = String(date || "").replace(/\//g, "-");
      }

      rows.push({
        id: String(r[7] || "").trim(),
        title: title,
        date: dateStr,
        url: String(r[4] || "").trim(),
        youtubeId: String(r[7] || "").trim(),
      });
    }

    return { data: rows, count: rows.length };
  } catch (e) {
    console.error("getPodcastList_ Error:", e);
    return { error: e.message, data: [] };
  }
}

/**
 * gohome-clinic.com 本院サイトの blog 記事一覧を取得（study.gohome-clinic.com 広報ポータル用）
 *
 * pagePath が /YYYY/MM/DD/ で始まる記事のみを対象とし、PV/UU・公開日付き配列を返す。
 * 公開日は URL の日付プレフィックスから抽出。
 */
function getBlogRankingFromGA4_(startDate, endDate, limit) {
  limit = limit || 30;

  try {
    var report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: {
              matchType: "PARTIAL_REGEXP",
              value: "^/20\\d{2}/\\d{2}/\\d{2}/",
            },
          },
        },
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 500,
      },
      "properties/" + CONFIG.GA4_PROPERTY_HOMEPAGE
    );

    if (!report.rows || report.rows.length === 0) {
      return { data: [], period: { startDate: startDate, endDate: endDate } };
    }

    // pagePath ベースで集約（pageTitleが微妙に違う事があるため）
    var byPath = {};
    report.rows.forEach(function (row) {
      var p = row.dimensionValues[0].value || "";
      var t = row.dimensionValues[1].value || "";
      var pv = parseInt(row.metricValues[0].value, 10) || 0;
      var users = parseInt(row.metricValues[1].value, 10) || 0;
      var key = p.split("?")[0]; // クエリ除去
      if (!byPath[key]) {
        byPath[key] = { pagePath: key, title: t, pageViews: 0, totalUsers: 0 };
      }
      byPath[key].pageViews += pv;
      byPath[key].totalUsers += users;
      if (t && !byPath[key].title) byPath[key].title = t;
    });

    var rows = Object.keys(byPath).map(function (k) {
      var r = byPath[k];
      // URLから日付抽出 /YYYY/MM/DD/ → YYYY-MM-DD
      var m = r.pagePath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\//);
      var date = m ? m[1] + "-" + m[2] + "-" + m[3] : null;
      // タイトルの末尾「｜ごうホームクリニック」等を除去
      var title = (r.title || "").replace(/[\|｜][^|｜]+$/, "").trim();
      return {
        url: "https://gohome-clinic.com" + r.pagePath,
        title: title,
        date: date,
        pageViews: r.pageViews,
        totalUsers: r.totalUsers,
      };
    });

    // PV降順
    rows.sort(function (a, b) {
      return b.pageViews - a.pageViews;
    });

    return {
      data: rows.slice(0, limit),
      count: rows.length,
      period: { startDate: startDate, endDate: endDate },
    };
  } catch (e) {
    console.error("Blog Ranking GA4 Error:", e);
    return { error: e.message, data: [] };
  }
}

function getGA4TrafficTrend(propertyId, startDate, endDate) {
  try {
    const report = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: startDate, endDate: endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        dimensionFilter: {
          orGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: {
                    matchType: "CONTAINS",
                    value: "instagram",
                    caseSensitive: false,
                  },
                },
              },
              {
                filter: {
                  fieldName: "sessionMedium",
                  stringFilter: {
                    matchType: "EXACT",
                    value: "paid",
                    caseSensitive: false,
                  },
                },
              },
            ],
          },
        },
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 365,
      },
      "properties/" + propertyId
    );

    return parseGA4Report(report, ["date"]);
  } catch (e) {
    console.error("GA4 Traffic Trend Error:", e);
    return { error: e.message, rows: [] };
  }
}

function parseGA4Report(report, dimensionNames) {
  if (!report.rows || report.rows.length === 0) {
    return { rows: [], rowCount: 0 };
  }

  const rows = report.rows.map(function (row) {
    const result = {};
    row.dimensionValues.forEach(function (dim, i) {
      result[dimensionNames[i]] = dim.value;
    });
    row.metricValues.forEach(function (metric, i) {
      const metricName = report.metricHeaders[i].name;
      result[metricName] = parseFloat(metric.value) || 0;
    });
    return result;
  });

  return { rows: rows, rowCount: rows.length };
}

// ===== GA4 MULTI-PROPERTY MERGE =====
function mergeGA4Results(result1, result2) {
  var rows1 = (result1 && result1.rows) || [];
  var rows2 = (result2 && result2.rows) || [];
  var merged = rows1.concat(rows2);
  return { rows: merged, rowCount: merged.length };
}

// ===== CAMPAIGN-POST MAPPING =====
function parseCampaignName(campaignName) {
  if (!campaignName || campaignName === "(not set)") {
    return { category: "unknown", date: null, postId: null };
  }

  // Pattern: ig_category_YYYYMMDD_postIDxxxx
  const match = campaignName.match(/ig[_-](\w+)[_-](\d{8})(?:[_-]postID(\d+))?/i);
  if (match) {
    return {
      category: match[1],
      date: match[2].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      postId: match[3] || null,
    };
  }

  return { category: campaignName, date: null, postId: null };
}

function autoMatchCampaignToPost(campaignName, ga4Rows, posts) {
  // Find the earliest date for this campaign in GA4 data
  const campaignRows = ga4Rows.filter(function (r) {
    return r.campaignName === campaignName;
  });

  if (campaignRows.length === 0 || posts.length === 0) return [];

  const dates = campaignRows.map(function (r) {
    return r.date;
  });
  dates.sort();
  const earliestDate = dates[0];

  if (!earliestDate) return [];

  // Parse YYYYMMDD to Date
  const campaignStart = new Date(
    earliestDate.substring(0, 4),
    parseInt(earliestDate.substring(4, 6)) - 1,
    parseInt(earliestDate.substring(6, 8))
  );

  // Find posts within 7 days before the campaign start
  const candidates = posts.filter(function (post) {
    const postDate = new Date(post.timestamp);
    const diffDays = (campaignStart - postDate) / 86400000;
    return diffDays >= -1 && diffDays <= 7;
  });

  return candidates;
}

// ===== CACHE (SPREADSHEET) =====
function getCacheSheet(sheetName) {
  if (!CONFIG.CACHE_SPREADSHEET_ID) return null;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.CACHE_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    return sheet;
  } catch (e) {
    console.error("Cache sheet error:", e);
    return null;
  }
}

function getConfigValue(key) {
  const sheet = getCacheSheet("config");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfigValue(key, value) {
  const sheet = getCacheSheet("config");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function isCacheValid(cacheKey) {
  const lastFetch = getConfigValue(cacheKey);
  if (!lastFetch) return false;

  const lastFetchDate = new Date(lastFetch);
  const now = new Date();
  const diffHours = (now - lastFetchDate) / (1000 * 60 * 60);
  return diffHours < CONFIG.CACHE_TTL_HOURS;
}

function writeCacheData(sheetName, headers, rows) {
  const sheet = getCacheSheet(sheetName);
  if (!sheet) return;

  sheet.clearContents();
  sheet.appendRow(headers);
  rows.forEach(function (row) {
    sheet.appendRow(
      headers.map(function (h) {
        return row[h] !== undefined ? row[h] : "";
      })
    );
  });
}

function readCacheData(sheetName) {
  const sheet = getCacheSheet(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach(function (h, idx) {
      row[h] = data[i][idx];
    });
    rows.push(row);
  }
  return rows;
}

// ===== CAMPAIGN-POST MAPPING PERSISTENCE =====
function saveCampaignPostMapping(campaignName, postId, permalink, mappedBy) {
  const sheet = getCacheSheet("campaign_post_mapping");
  if (!sheet) return;

  // Check if mapping already exists
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === campaignName && data[i][1] === postId) {
      return; // Already mapped
    }
  }

  if (data.length === 0) {
    sheet.appendRow([
      "campaign_name",
      "post_id",
      "permalink",
      "mapped_by",
      "mapped_at",
    ]);
  }

  sheet.appendRow([
    campaignName,
    postId,
    permalink,
    mappedBy || "manual",
    new Date().toISOString(),
  ]);
}

function getCampaignPostMappings() {
  return readCacheData("campaign_post_mapping");
}

function removeCampaignPostMapping(campaignName, postId) {
  const sheet = getCacheSheet("campaign_post_mapping");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === campaignName && data[i][1] === postId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ===== MAIN DATA AGGREGATION =====
function getAllDashboardData(forceRefresh, customStartDate, customEndDate) {
  console.log("getAllDashboardData called: forceRefresh=" + forceRefresh + ", customStartDate=" + customStartDate + ", customEndDate=" + customEndDate);
  const now = new Date();
  const endDate = customEndDate || Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");

  var startDate;
  var startDateObj;
  if (customStartDate) {
    startDate = customStartDate;
    startDateObj = new Date(customStartDate);
  } else {
    startDateObj = new Date(now);
    startDateObj.setDate(startDateObj.getDate() - 90);
    startDate = Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");
  }

  // Past 30 days for summary (or full custom range if shorter than 30 days)
  var endDateObj = new Date(endDate);
  var startDateParsed = new Date(startDate);
  var daysDiff = Math.round((endDateObj - startDateParsed) / 86400000);
  var thirtyDaysAgo = new Date(endDateObj);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - Math.min(30, daysDiff));
  const startDate30 = Utilities.formatDate(thirtyDaysAgo, "Asia/Tokyo", "yyyy-MM-dd");

  const result = {
    period: { startDate: startDate, endDate: endDate },
    period30: { startDate: startDate30, endDate: endDate },
    campaigns: { rows: [] },
    allTraffic: { rows: [] },
    ctaPageViews: { rows: [] },
    formSubmissions: { rows: [] },
    formSubmissionsFirstTouch: { rows: [] },
    trafficTrend: { rows: [] },
    instagramPosts: { data: [] },
    adSpend: { data: [] },
    mappings: [],
    summary: {},
    errors: [],
  };

  // GA4 Campaign Data (from both homepage and recruit properties)
  // Ad traffic lands on recruit site, organic IG traffic on homepage
  var homepageCampaigns = { rows: [] };
  var recruitCampaigns = { rows: [] };
  try {
    homepageCampaigns = getGA4CampaignData(CONFIG.GA4_PROPERTY_HOMEPAGE, startDate, endDate);
  } catch (e) {
    result.errors.push("GA4 Campaign (Homepage): " + e.message);
  }
  try {
    recruitCampaigns = getGA4CampaignData(CONFIG.GA4_PROPERTY_RECRUIT, startDate, endDate);
  } catch (e) {
    result.errors.push("GA4 Campaign (Recruit): " + e.message);
  }
  result.campaigns = mergeGA4Results(homepageCampaigns, recruitCampaigns);

  // GA4 All Traffic (from both properties to detect Paid Social)
  var homepageTraffic = { rows: [] };
  var recruitTraffic = { rows: [] };
  try {
    homepageTraffic = getGA4AllTrafficByChannel(CONFIG.GA4_PROPERTY_HOMEPAGE, startDate30, endDate);
  } catch (e) {
    result.errors.push("GA4 All Traffic (Homepage): " + e.message);
  }
  try {
    recruitTraffic = getGA4AllTrafficByChannel(CONFIG.GA4_PROPERTY_RECRUIT, startDate30, endDate);
  } catch (e) {
    result.errors.push("GA4 All Traffic (Recruit): " + e.message);
  }
  result.allTraffic = mergeGA4Results(homepageTraffic, recruitTraffic);

  // GA4 CTA Page Views (recruiting site has the CTA page)
  try {
    result.ctaPageViews = getGA4CTAPageViews(
      CONFIG.GA4_PROPERTY_RECRUIT,
      startDate,
      endDate
    );
  } catch (e) {
    result.errors.push("GA4 CTA: " + e.message);
  }

  // GA4 Form Submissions (from recruiting site property)
  try {
    result.formSubmissions = getGA4FormSubmissions(
      CONFIG.GA4_PROPERTY_RECRUIT,
      startDate,
      endDate
    );
  } catch (e) {
    result.errors.push("GA4 Form: " + e.message);
  }

  // GA4 Form Submissions - First Touch (initial visit campaign)
  try {
    result.formSubmissionsFirstTouch = getGA4FormSubmissionsFirstTouch(
      CONFIG.GA4_PROPERTY_RECRUIT,
      startDate,
      endDate
    );
  } catch (e) {
    result.errors.push("GA4 Form (First Touch): " + e.message);
  }

  // GA4 Traffic Trend (from both properties)
  var homepageTrend = { rows: [] };
  var recruitTrend = { rows: [] };
  try {
    homepageTrend = getGA4TrafficTrend(CONFIG.GA4_PROPERTY_HOMEPAGE, startDate, endDate);
  } catch (e) {
    result.errors.push("GA4 Trend (Homepage): " + e.message);
  }
  try {
    recruitTrend = getGA4TrafficTrend(CONFIG.GA4_PROPERTY_RECRUIT, startDate, endDate);
  } catch (e) {
    result.errors.push("GA4 Trend (Recruit): " + e.message);
  }
  result.trafficTrend = mergeGA4Results(homepageTrend, recruitTrend);

  // Instagram Posts
  try {
    result.instagramPosts = getInstagramPostsWithInsights(30);
  } catch (e) {
    result.errors.push("Instagram: " + e.message);
  }

  // Meta Ads Spend Data (try API first, fallback to daily budget estimate)
  if (CONFIG.AD_ACCOUNT_ID) {
    try {
      result.adSpend = getAdCampaignSpend(CONFIG.AD_ACCOUNT_ID, startDate, endDate);
    } catch (e) {
      result.errors.push("Ad Spend API: " + e.message);
    }
  }

  // Fallback: estimate from daily budget if API returned no data or error
  var adSpendData = (result.adSpend && result.adSpend.data) || [];
  if (adSpendData.length === 0 && CONFIG.DAILY_BUDGET_JPY > 0) {
    var daysDiff = Math.round((now - startDateObj) / 86400000);
    result.adSpend = {
      data: [{
        campaign_name: "(daily budget estimate)",
        spend: CONFIG.DAILY_BUDGET_JPY * daysDiff,
        impressions: 0,
        clicks: 0,
        cpc: 0,
        landing_page_views: 0,
      }],
      estimated: true,
      dailyBudget: CONFIG.DAILY_BUDGET_JPY,
      days: daysDiff,
    };
  }

  // Campaign-Post Mappings
  try {
    result.mappings = getCampaignPostMappings();
  } catch (e) {
    result.errors.push("Mappings: " + e.message);
  }

  // Build monthly campaign data
  result.monthlyCampaigns = buildMonthlyCampaignData(result);

  // Build summary
  result.summary = buildSummary(result);

  return result;
}

function buildMonthlyCampaignData(data) {
  var campaignRows = (data.campaigns && data.campaigns.rows) || [];
  var adSpendRows = (data.adSpend && data.adSpend.data) || [];
  var ctaRows = (data.ctaPageViews && data.ctaPageViews.rows) || [];
  var formRows = (data.formSubmissions && data.formSubmissions.rows) || [];
  var nameMap = CONFIG.CAMPAIGN_NAME_MAP || {};

  function toMonth(dateStr) {
    if (!dateStr || dateStr.length < 6) return null;
    return dateStr.substring(0, 4) + "-" + dateStr.substring(4, 6);
  }

  function toMonthFromDash(dateStr) {
    if (!dateStr || dateStr.length < 7) return null;
    return dateStr.substring(0, 7);
  }

  var monthSet = {};

  var gaData = {};
  campaignRows.forEach(function(row) {
    var name = row.campaignName || "(not set)";
    var month = toMonth(row.date);
    if (!month) return;
    monthSet[month] = true;

    if (!gaData[name]) gaData[name] = {};
    if (!gaData[name][month]) {
      gaData[name][month] = { sessions: 0, totalUsers: 0, newUsers: 0, bounceRateSum: 0, bounceRateCount: 0, pageViews: 0, engagementDuration: 0 };
    }
    var m = gaData[name][month];
    m.sessions += row.sessions || 0;
    m.totalUsers += row.totalUsers || 0;
    m.newUsers += row.newUsers || 0;
    m.bounceRateSum += (row.bounceRate || 0) * (row.sessions || 0);
    m.bounceRateCount += row.sessions || 0;
    m.pageViews += row.screenPageViews || 0;
    m.engagementDuration += row.userEngagementDuration || 0;
  });

  var adData = {};
  adSpendRows.forEach(function(row) {
    var name = row.campaign_name || "(not set)";
    var month = toMonthFromDash(row.date);
    if (!month) return;
    monthSet[month] = true;

    if (!adData[name]) adData[name] = {};
    if (!adData[name][month]) {
      adData[name][month] = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0 };
    }
    var m = adData[name][month];
    m.spend += row.spend || 0;
    m.impressions += row.impressions || 0;
    m.clicks += row.clicks || 0;
    m.linkClicks += row.link_clicks || 0;
  });

  var ctaByCampaign = {};
  ctaRows.forEach(function(row) {
    var name = row.campaignName || "(not set)";
    ctaByCampaign[name] = (ctaByCampaign[name] || 0) + (row.screenPageViews || 0);
  });

  var formByCampaign = {};
  formRows.forEach(function(row) {
    var name = row.campaignName || "(not set)";
    if (!formByCampaign[name]) formByCampaign[name] = { thankscv: 0, form_start: 0, telcv: 0 };
    var eventName = row.eventName || "";
    var count = row.totalUsers || row.eventCount || 0;
    if (eventName === "thankscv") formByCampaign[name].thankscv += count;
    else if (eventName === "form_start") formByCampaign[name].form_start += count;
    else if (eventName === "telcv") formByCampaign[name].telcv += count;
  });

  var months = Object.keys(monthSet).sort();

  var reverseMap = {};
  Object.keys(nameMap).forEach(function(utmName) {
    reverseMap[nameMap[utmName]] = utmName;
  });

  var campaignNames = Object.keys(gaData).filter(function(n) { return n !== "(not set)"; });

  var campaigns = campaignNames.map(function(name) {
    var monthly = {};
    var total = { sessions: 0, totalUsers: 0, bounceRateSum: 0, bounceRateCount: 0, pageViews: 0, spend: 0, impressions: 0, linkClicks: 0, cv: 0 };

    var metaAdsName = nameMap[name] || name;

    months.forEach(function(month) {
      var ga = (gaData[name] && gaData[name][month]) || { sessions: 0, totalUsers: 0, bounceRateSum: 0, bounceRateCount: 0, pageViews: 0 };
      var ad = (adData[metaAdsName] && adData[metaAdsName][month]) || (adData[name] && adData[name][month]) || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0 };

      var bounceRate = ga.bounceRateCount > 0 ? Math.round(ga.bounceRateSum / ga.bounceRateCount * 1000) / 10 : null;
      var ctr = ad.impressions > 0 ? Math.round(ad.linkClicks / ad.impressions * 10000) / 100 : null;

      monthly[month] = {
        sessions: ga.sessions,
        totalUsers: ga.totalUsers,
        bounceRate: bounceRate,
        pageViews: ga.pageViews,
        spend: Math.round(ad.spend),
        impressions: ad.impressions,
        linkClicks: ad.linkClicks,
        ctr: ctr,
      };

      total.sessions += ga.sessions;
      total.totalUsers += ga.totalUsers;
      total.bounceRateSum += ga.bounceRateSum;
      total.bounceRateCount += ga.bounceRateCount;
      total.pageViews += ga.pageViews;
      total.spend += ad.spend;
      total.impressions += ad.impressions;
      total.linkClicks += ad.linkClicks;
    });

    var forms = formByCampaign[name] || { thankscv: 0, form_start: 0, telcv: 0 };
    var totalCV = forms.thankscv + forms.telcv;
    total.cv = totalCV;
    total.formSubmissions = forms.thankscv;
    total.telConversions = forms.telcv;
    total.formStarts = forms.form_start;
    total.ctaPageViews = ctaByCampaign[name] || 0;
    total.bounceRate = total.bounceRateCount > 0 ? Math.round(total.bounceRateSum / total.bounceRateCount * 1000) / 10 : null;
    total.ctr = total.impressions > 0 ? Math.round(total.linkClicks / total.impressions * 10000) / 100 : null;
    total.spend = Math.round(total.spend);
    total.cpa = totalCV > 0 ? Math.round(total.spend / totalCV) : null;

    return {
      name: name,
      monthly: monthly,
      total: total,
    };
  });

  return {
    months: months,
    campaigns: campaigns,
  };
}

function buildSummary(data) {
  const campaignRows = data.campaigns.rows || [];
  const ctaRows = data.ctaPageViews.rows || [];
  const formRows = data.formSubmissions.rows || [];

  // Paid vs Organic tracking
  var paidTotals = { sessions: 0, totalUsers: 0, ctaPageViews: 0, formStarts: 0, formSubmissions: 0, telConversions: 0, totalConversions: 0 };
  var organicTotals = { sessions: 0, totalUsers: 0, ctaPageViews: 0, formStarts: 0, formSubmissions: 0, telConversions: 0, totalConversions: 0 };

  // Aggregate by campaign name
  const campaignMap = {};

  campaignRows.forEach(function (row) {
    const name = row.campaignName || "(not set)";
    if (!campaignMap[name]) {
      campaignMap[name] = {
        name: name,
        source: row.source || "",
        medium: row.medium || "",
        sessions: 0,
        totalUsers: 0,
        newUsers: 0,
        bounceRateSum: 0,
        bounceRateCount: 0,
        pageViews: 0,
        engagementDuration: 0,
        ctaPageViews: 0,
        formSubmissions: 0,
        formStarts: 0,
        telConversions: 0,
      };
    }
    const c = campaignMap[name];
    c.sessions += row.sessions || 0;
    c.totalUsers += row.totalUsers || 0;
    c.newUsers += row.newUsers || 0;
    c.bounceRateSum += (row.bounceRate || 0) * (row.sessions || 0);
    c.bounceRateCount += row.sessions || 0;
    c.pageViews += row.screenPageViews || 0;
    c.engagementDuration += row.userEngagementDuration || 0;

    // Split by medium
    var isPaid = (row.medium || "").toLowerCase() === "paid";
    var target = isPaid ? paidTotals : organicTotals;
    target.sessions += row.sessions || 0;
    target.totalUsers += row.totalUsers || 0;
  });

  // Raw totals from recruiting site (all sources, before campaign matching)
  // These capture ALL form events regardless of UTM attribution
  var rawFormTotals = { ctaPageViews: 0, formStarts: 0, formSubmissions: 0, telConversions: 0, totalConversions: 0 };

  // Add CTA page views
  // NOTE: CTA/Form data is from recruiting site (cross-property) - no paid/organic split available
  // Skip "(not set)" for IG attribution: cross-property sessions lose UTM params,
  // so "(not set)" on recruit site does NOT mean the user came from Instagram
  ctaRows.forEach(function (row) {
    const name = row.campaignName || "(not set)";
    rawFormTotals.ctaPageViews += row.screenPageViews || 0;
    if (name !== "(not set)" && campaignMap[name]) {
      campaignMap[name].ctaPageViews += row.screenPageViews || 0;
    }
  });

  // Add form events (thankscv, form_start, telcv)
  formRows.forEach(function (row) {
    const name = row.campaignName || "(not set)";
    var eventName = row.eventName || "";
    var count = row.totalUsers || row.eventCount || 0;

    if (eventName === "thankscv") rawFormTotals.formSubmissions += count;
    else if (eventName === "form_start") rawFormTotals.formStarts += count;
    else if (eventName === "telcv") rawFormTotals.telConversions += count;

    // Skip "(not set)" for IG attribution (same reason as CTA above)
    if (name !== "(not set)" && campaignMap[name]) {
      if (eventName === "thankscv") {
        campaignMap[name].formSubmissions += count;
      } else if (eventName === "form_start") {
        campaignMap[name].formStarts += count;
      } else if (eventName === "telcv") {
        campaignMap[name].telConversions += count;
      }
    }
  });

  rawFormTotals.totalConversions = rawFormTotals.formSubmissions + rawFormTotals.telConversions;

  // First Touch attribution: count CVs by the campaign that FIRST brought the user
  // Only count named ad campaigns (exclude "(not set)" which matches organic/direct traffic)
  var firstTouchRows = (data.formSubmissionsFirstTouch && data.formSubmissionsFirstTouch.rows) || [];
  var firstTouchTotals = { formStarts: 0, formSubmissions: 0, telConversions: 0, totalConversions: 0 };
  firstTouchRows.forEach(function (row) {
    var name = row.campaignName || "(not set)";
    var eventName = row.eventName || "";
    var count = row.totalUsers || row.eventCount || 0;

    // Skip "(not set)" - it matches organic/direct traffic, not actual ad campaigns
    if (name === "(not set)") return;

    // Check if this first-touch campaign is an IG/paid campaign
    if (campaignMap[name]) {
      if (eventName === "thankscv") firstTouchTotals.formSubmissions += count;
      else if (eventName === "form_start") firstTouchTotals.formStarts += count;
      else if (eventName === "telcv") firstTouchTotals.telConversions += count;
    }
  });
  firstTouchTotals.totalConversions = firstTouchTotals.formSubmissions + firstTouchTotals.telConversions;

  // Calculate derived metrics
  const campaigns = Object.values(campaignMap).map(function (c) {
    const avgBounceRate =
      c.bounceRateCount > 0 ? (c.bounceRateSum / c.bounceRateCount) * 100 : 0;
    const avgDurationSec =
      c.sessions > 0 ? c.engagementDuration / c.sessions : 0;
    const cvRate =
      c.sessions > 0 ? (c.formSubmissions / c.sessions) * 100 : 0;
    const ctaRate =
      c.sessions > 0 ? (c.ctaPageViews / c.sessions) * 100 : 0;

    // Total conversions = form + tel
    var totalConversions = c.formSubmissions + c.telConversions;
    var totalCvRate = c.sessions > 0 ? (totalConversions / c.sessions) * 100 : 0;

    // Effectiveness score
    const score = c.sessions * 1 + c.ctaPageViews * 3 + c.formSubmissions * 10 + c.telConversions * 10;

    return {
      name: c.name,
      source: c.source,
      medium: c.medium,
      sessions: c.sessions,
      totalUsers: c.totalUsers,
      newUsers: c.newUsers,
      bounceRate: Math.round(avgBounceRate * 10) / 10,
      pageViews: c.pageViews,
      avgDurationSec: Math.round(avgDurationSec),
      ctaPageViews: c.ctaPageViews,
      formStarts: c.formStarts,
      formSubmissions: c.formSubmissions,
      telConversions: c.telConversions,
      totalConversions: totalConversions,
      cvRate: Math.round(cvRate * 100) / 100,
      totalCvRate: Math.round(totalCvRate * 100) / 100,
      ctaRate: Math.round(ctaRate * 100) / 100,
      score: score,
    };
  });

  // Sort by score desc
  campaigns.sort(function (a, b) {
    return b.score - a.score;
  });

  // Totals
  const totals = campaigns.reduce(
    function (acc, c) {
      acc.sessions += c.sessions;
      acc.totalUsers += c.totalUsers;
      acc.ctaPageViews += c.ctaPageViews;
      acc.formStarts += c.formStarts;
      acc.formSubmissions += c.formSubmissions;
      acc.telConversions += c.telConversions;
      acc.totalConversions += c.totalConversions;
      return acc;
    },
    { sessions: 0, totalUsers: 0, ctaPageViews: 0, formStarts: 0, formSubmissions: 0, telConversions: 0, totalConversions: 0 }
  );

  // Also include Organic Social data from allTraffic
  const allTrafficRows = data.allTraffic.rows || [];
  const organicSocial = allTrafficRows.filter(function (r) {
    return r.channelGroup === "Organic Social";
  });
  const paidSocial = allTrafficRows.filter(function (r) {
    return r.channelGroup === "Paid Social";
  });
  const utmConfigured = paidSocial.length > 0;

  // Ad Spend & CPA calculation
  var adSpendRows = (data.adSpend && data.adSpend.data) || [];
  var hasMetaDeliveredAdTraffic = data.adSpend && data.adSpend.estimated === true
    ? false
    : adSpendRows.some(function (row) {
      return (row.spend || 0) > 0 ||
        (row.impressions || 0) > 0 ||
        (row.clicks || 0) > 0 ||
        (row.link_clicks || 0) > 0 ||
        (row.landing_page_views || 0) > 0;
    });
  var shouldShowUtmWarning = !utmConfigured && hasMetaDeliveredAdTraffic;
  var totalSpend = 0;
  var adSpendByCampaign = {};

  var totalAdImpressions = 0;
  var totalAdClicks = 0;
  var totalAdLinkClicks = 0;
  var totalAdUniqueLinkClicks = 0;
  var totalAdLPViews = 0;

  adSpendRows.forEach(function (row) {
    totalSpend += row.spend || 0;
    totalAdImpressions += row.impressions || 0;
    totalAdClicks += row.clicks || 0;
    totalAdLinkClicks += row.link_clicks || 0;
    totalAdUniqueLinkClicks += row.unique_link_clicks || 0;
    totalAdLPViews += row.landing_page_views || 0;
    var name = row.campaign_name || "(not set)";
    if (!adSpendByCampaign[name]) {
      adSpendByCampaign[name] = { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, unique_link_clicks: 0, landing_page_views: 0 };
    }
    adSpendByCampaign[name].spend += row.spend || 0;
    adSpendByCampaign[name].impressions += row.impressions || 0;
    adSpendByCampaign[name].clicks += row.clicks || 0;
    adSpendByCampaign[name].link_clicks += row.link_clicks || 0;
    adSpendByCampaign[name].unique_link_clicks += row.unique_link_clicks || 0;
    adSpendByCampaign[name].landing_page_views += row.landing_page_views || 0;
  });

  // Build reverse map: Meta Ads name → UTM name
  var nameMap = CONFIG.CAMPAIGN_NAME_MAP || {};
  var reverseMap = {};
  Object.keys(nameMap).forEach(function (utmName) {
    reverseMap[nameMap[utmName]] = utmName;
  });

  // Attach spend data to campaigns (match by direct name or via mapping)
  campaigns.forEach(function (c) {
    var metaAdsName = nameMap[c.name] || c.name;
    var spendData = adSpendByCampaign[c.name] || adSpendByCampaign[metaAdsName];
    if (spendData) {
      c.spend = spendData.spend;
      c.adImpressions = spendData.impressions;
      c.adClicks = spendData.clicks;
      c.adLinkClicks = spendData.link_clicks || 0;
      c.adLPViews = spendData.landing_page_views;
      c.ctr = spendData.impressions > 0 ? Math.round((spendData.link_clicks || spendData.clicks) / spendData.impressions * 10000) / 100 : 0;
      c.cpa = c.totalConversions > 0 ? Math.round(spendData.spend / c.totalConversions) : null;
      c.costPerClick = spendData.clicks > 0 ? Math.round(spendData.spend / spendData.clicks) : null;
    } else {
      c.spend = 0;
      c.adImpressions = 0;
      c.adClicks = 0;
      c.adLinkClicks = 0;
      c.ctr = 0;
      c.cpa = null;
      c.costPerClick = null;
    }
  });

  var cvForCPA = rawFormTotals.totalConversions || totals.totalConversions;
  var totalCPA = cvForCPA > 0 ? Math.round(totalSpend / cvForCPA) : null;
  var firstTouchCPA = firstTouchTotals.totalConversions > 0 ? Math.round(totalSpend / firstTouchTotals.totalConversions) : null;

  return {
    campaigns: campaigns,
    totals: totals,
    rawFormTotals: rawFormTotals,
    firstTouchTotals: firstTouchTotals,
    paidTotals: paidTotals,
    organicTotals: organicTotals,
    totalSpend: totalSpend,
    totalCPA: totalCPA,
    firstTouchCPA: firstTouchCPA,
    totalAdImpressions: totalAdImpressions,
    totalAdClicks: totalAdClicks,
    totalAdLinkClicks: totalAdLinkClicks,
    totalAdUniqueLinkClicks: totalAdUniqueLinkClicks,
    totalAdLPViews: totalAdLPViews,
    adSpendAvailable: adSpendRows.length > 0,
    adSpendEstimated: data.adSpend && data.adSpend.estimated === true,
    organicSocial: organicSocial,
    paidSocial: paidSocial,
    hasPaidData: paidSocial.length > 0 || campaigns.length > 0,
    utmConfigured: utmConfigured,
    metaAdDeliveryDetected: hasMetaDeliveredAdTraffic,
    utmWarning: {
      shouldShow: shouldShowUtmWarning,
      reason: shouldShowUtmWarning ? "meta_ads_delivery_without_paid_social" : "",
    },
  };
}

// ===== CHATWORK NOTIFICATION =====
function sendToChatWork(message) {
  const url = `https://api.chatwork.com/v2/rooms/${CONFIG.CHATWORK_ROOM_ID}/messages`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      headers: { "X-ChatWorkToken": CONFIG.CHATWORK_API_TOKEN },
      payload: { body: message },
      muteHttpExceptions: true,
    });
    return { success: true, result: JSON.parse(response.getContentText()) };
  } catch (error) {
    console.error("ChatWork Error:", error);
    return { success: false, error: error.toString() };
  }
}

// ===== SCHEDULED TASKS =====
function fetchAndCacheAllData() {
  const data = getAllDashboardData(true);
  setConfigValue("LAST_FULL_FETCH", new Date().toISOString());
  console.log(
    "Data fetched: " +
      (data.campaigns.rows || []).length +
      " campaign rows, " +
      (data.instagramPosts.data || []).length +
      " posts"
  );
  return data;
}

function sendWeeklyReport() {
  const data = getAllDashboardData(false);
  const summary = data.summary;
  const campaigns = summary.campaigns || [];

  let reportLines = [];
  reportLines.push("[info][title]Instagram広告 週次レポート[/title]");
  reportLines.push("集計期間: " + data.period30.startDate + " ～ " + data.period30.endDate);
  reportLines.push("");

  if (summary.utmWarning && summary.utmWarning.shouldShow) {
    reportLines.push("⚠️ UTMパラメータ未設定: Instagram広告トラフィックが正確に計測されていません。");
    reportLines.push("Meta Ads Managerでの設定を推奨します。");
    reportLines.push("");
  }

  reportLines.push("━━━ サマリー ━━━");
  reportLines.push("セッション: " + summary.totals.sessions);
  reportLines.push("ユーザー: " + summary.totals.totalUsers);
  reportLines.push("CTAページ閲覧: " + summary.totals.ctaPageViews);
  reportLines.push("フォーム開始: " + summary.totals.formStarts);
  reportLines.push("フォーム完了(thankscv): " + summary.totals.formSubmissions);
  reportLines.push("電話CV(telcv): " + summary.totals.telConversions);
  reportLines.push("合計CV: " + summary.totals.totalConversions);
  reportLines.push("");

  if (campaigns.length > 0) {
    reportLines.push("━━━ キャンペーン別 ━━━");
    campaigns.slice(0, 5).forEach(function (c, i) {
      reportLines.push(
        (i + 1) +
          ". " +
          c.name +
          " | セッション: " +
          c.sessions +
          " | CTA: " +
          c.ctaPageViews +
          " | CV: " +
          c.formSubmissions
      );
    });
  }

  reportLines.push("[/info]");

  sendToChatWork(reportLines.join("\n"));
}

function setupTriggers() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === "fetchAndCacheAllData" || fn === "sendWeeklyReport" || fn === "refreshAdsTokenIfNeeded") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Daily data fetch at 6:00
  ScriptApp.newTrigger("fetchAndCacheAllData")
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  // Weekly report on Monday at 9:00
  ScriptApp.newTrigger("sendWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  // Daily ads token check at 9:00
  ScriptApp.newTrigger("refreshAdsTokenIfNeeded")
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .create();

  console.log("Triggers set up: daily fetch (6:00), weekly report (Mon 9:00), token refresh check (daily 9:00)");
}

// ===== CACHE SPREADSHEET INITIALIZATION =====
function initializeCacheSpreadsheet() {
  const ss = SpreadsheetApp.create("Instagram Ad Strategy - Cache");
  const spreadsheetId = ss.getId();

  // Create sheets
  const sheetNames = [
    "campaign_ga4_data",
    "instagram_posts",
    "campaign_post_mapping",
    "funnel_data",
    "config",
  ];

  sheetNames.forEach(function (name) {
    ss.insertSheet(name);
  });

  // Remove default Sheet1
  const defaultSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("シート1");
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  // Initialize config
  const configSheet = ss.getSheetByName("config");
  configSheet.appendRow(["key", "value"]);
  configSheet.appendRow(["LAST_GA4_FETCH", ""]);
  configSheet.appendRow(["LAST_IG_FETCH", ""]);

  // Initialize mapping headers
  const mappingSheet = ss.getSheetByName("campaign_post_mapping");
  mappingSheet.appendRow([
    "campaign_name",
    "post_id",
    "permalink",
    "mapped_by",
    "mapped_at",
  ]);

  console.log("Cache spreadsheet created: " + spreadsheetId);
  console.log("URL: " + ss.getUrl());
  console.log(
    "IMPORTANT: Update CONFIG.CACHE_SPREADSHEET_ID = '" + spreadsheetId + "'"
  );

  return spreadsheetId;
}

// ===== TEST FUNCTIONS =====
function testGA4CampaignData() {
  const now = new Date();
  const endDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  const startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 30);
  const startDate = Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");

  console.log("Fetching GA4 campaign data: " + startDate + " to " + endDate);
  const result = getGA4CampaignData(CONFIG.GA4_PROPERTY_HOMEPAGE, startDate, endDate);
  console.log("Rows: " + (result.rows || []).length);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function testGA4AllTraffic() {
  const now = new Date();
  const endDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  const startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 30);
  const startDate = Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");

  console.log("Fetching GA4 all traffic data: " + startDate + " to " + endDate);
  const result = getGA4AllTrafficByChannel(CONFIG.GA4_PROPERTY_HOMEPAGE, startDate, endDate);
  console.log("Rows: " + (result.rows || []).length);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function testGetAdAccountId() {
  console.log("=== Finding Ad Account ID ===");
  var result = getAdAccountId();
  console.log(JSON.stringify(result, null, 2));

  if (result.data && result.data.length > 0) {
    result.data.forEach(function (account) {
      console.log("Ad Account: " + account.name + " | ID: " + account.id + " | Status: " + account.account_status);
    });
    console.log("\nIMPORTANT: Set CONFIG.AD_ACCOUNT_ID = '" + result.data[0].id + "'");
  }
  return result;
}

function exchangeForLongLivedToken() {
  // Exchange short-lived User Access Token for long-lived (~60 day) token
  // Requires App ID and App Secret from Meta App settings
  var appId = "4331485363796972";
  var appSecret = PropertiesService.getScriptProperties().getProperty("META_APP_SECRET");

  var shortToken = CONFIG.ADS_ACCESS_TOKEN;
  var url = CONFIG.BASE_URL + "/oauth/access_token" +
    "?grant_type=fb_exchange_token" +
    "&client_id=" + appId +
    "&client_secret=" + appSecret +
    "&fb_exchange_token=" + shortToken;

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());

    if (data.access_token) {
      var expiryDays = data.expires_in ? Math.round(data.expires_in / 86400) : 60;
      console.log("=== Long-Lived Token Generated ===");
      console.log("Expires in: " + expiryDays + " days");

      // Save to Script Properties for auto-refresh
      var props = PropertiesService.getScriptProperties();
      props.setProperty("ADS_LONG_LIVED_TOKEN", data.access_token);
      props.setProperty("ADS_TOKEN_CREATED", new Date().toISOString());
      props.setProperty("ADS_TOKEN_EXPIRES_DAYS", String(expiryDays));
      props.setProperty("META_APP_SECRET", appSecret);

      console.log("Token saved to Script Properties (auto-refresh enabled).");
      console.log("Token preview: " + data.access_token.substring(0, 30) + "...");
    } else {
      console.log("Error: " + resp.getContentText());
    }
  } catch (e) {
    console.log("Error: " + e);
  }
}

function refreshAdsTokenIfNeeded() {
  var props = PropertiesService.getScriptProperties();
  var created = props.getProperty("ADS_TOKEN_CREATED");
  var expiresDays = parseInt(props.getProperty("ADS_TOKEN_EXPIRES_DAYS")) || 60;
  var currentToken = props.getProperty("ADS_LONG_LIVED_TOKEN");

  if (!created || !currentToken) {
    console.log("No ads token to refresh.");
    return;
  }

  var createdDate = new Date(created);
  var now = new Date();
  var daysSinceCreation = (now - createdDate) / 86400000;
  var daysRemaining = expiresDays - daysSinceCreation;

  console.log("Ads token age: " + Math.round(daysSinceCreation) + " days, remaining: " + Math.round(daysRemaining) + " days");

  // Refresh when less than 7 days remaining
  if (daysRemaining > 7) {
    console.log("Token still valid. No refresh needed.");
    return;
  }

  console.log("Token expiring soon. Refreshing...");

  var appId = "4331485363796972";
  var appSecret = props.getProperty("META_APP_SECRET");

  var url = CONFIG.BASE_URL + "/oauth/access_token" +
    "?grant_type=fb_exchange_token" +
    "&client_id=" + appId +
    "&client_secret=" + appSecret +
    "&fb_exchange_token=" + currentToken;

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());

    if (data.access_token) {
      var newExpiry = data.expires_in ? Math.round(data.expires_in / 86400) : 60;
      props.setProperty("ADS_LONG_LIVED_TOKEN", data.access_token);
      props.setProperty("ADS_TOKEN_CREATED", now.toISOString());
      props.setProperty("ADS_TOKEN_EXPIRES_DAYS", String(newExpiry));
      console.log("Token refreshed. New expiry: " + newExpiry + " days");

      // Notify via ChatWork
      sendToChatWork("[info][title]Ads Token Refreshed[/title]Meta Ads APIトークンを自動更新しました。\n有効期限: " + newExpiry + "日[/info]");
    } else {
      console.error("Token refresh failed: " + resp.getContentText());
      sendToChatWork("[info][title]⚠ Ads Token Refresh Failed[/title]Meta Ads APIトークンの自動更新に失敗しました。\n手動でGraph API Explorerから再取得してください。\n\nError: " + resp.getContentText() + "[/info]");
    }
  } catch (e) {
    console.error("Token refresh error: " + e);
  }
}

function testListAllAdAccounts() {
  var token = CONFIG.ADS_ACCESS_TOKEN || CONFIG.ACCESS_TOKEN;
  console.log("=== All Ad Accounts accessible by this token ===");
  var url = CONFIG.BASE_URL + "/" + CONFIG.API_VERSION +
    "/me/adaccounts?fields=id,name,account_status,currency,amount_spent" +
    "&access_token=" + token;
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    if (data.data && data.data.length > 0) {
      data.data.forEach(function (acct) {
        console.log(acct.name + " | ID: " + acct.id + " | Currency: " + acct.currency + " | Spent: " + acct.amount_spent);
      });
    } else {
      console.log("No ad accounts found. Raw: " + resp.getContentText());
    }
  } catch (e) {
    console.log("Error: " + e);
  }
}

function testAdSpendDebug() {
  var token = CONFIG.ADS_ACCESS_TOKEN || CONFIG.ACCESS_TOKEN;

  // 1. Check ad account info
  console.log("=== 1. Ad Account Info ===");
  var acctUrl = CONFIG.BASE_URL + "/" + CONFIG.API_VERSION + "/" + CONFIG.AD_ACCOUNT_ID +
    "?fields=name,account_status,currency,amount_spent,balance" +
    "&access_token=" + token;
  try {
    var acctResp = UrlFetchApp.fetch(acctUrl, { muteHttpExceptions: true });
    console.log(acctResp.getContentText());
  } catch (e) {
    console.log("Error: " + e);
  }

  // 2. List campaigns
  console.log("\n=== 2. Campaigns ===");
  var campUrl = CONFIG.BASE_URL + "/" + CONFIG.API_VERSION + "/" + CONFIG.AD_ACCOUNT_ID +
    "/campaigns?fields=name,status,daily_budget,lifetime_budget,objective" +
    "&access_token=" + token;
  try {
    var campResp = UrlFetchApp.fetch(campUrl, { muteHttpExceptions: true });
    console.log(campResp.getContentText());
  } catch (e) {
    console.log("Error: " + e);
  }

  // 3. Insights with shorter date range (last 7 days)
  console.log("\n=== 3. Insights (last 7 days) ===");
  var now = new Date();
  var endDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  var startObj = new Date(now);
  startObj.setDate(startObj.getDate() - 7);
  var startDate = Utilities.formatDate(startObj, "Asia/Tokyo", "yyyy-MM-dd");

  var timeRange = encodeURIComponent('{"since":"' + startDate + '","until":"' + endDate + '"}');
  var insUrl = CONFIG.BASE_URL + "/" + CONFIG.API_VERSION + "/" + CONFIG.AD_ACCOUNT_ID +
    "/insights?fields=spend,impressions,clicks,actions" +
    "&time_range=" + timeRange +
    "&access_token=" + token;
  try {
    var insResp = UrlFetchApp.fetch(insUrl, { muteHttpExceptions: true });
    console.log(insResp.getContentText());
  } catch (e) {
    console.log("Error: " + e);
  }
}

function testAdSpend() {
  if (!CONFIG.AD_ACCOUNT_ID) {
    console.log("ERROR: CONFIG.AD_ACCOUNT_ID is not set. Run testGetAdAccountId() first.");
    return;
  }

  var now = new Date();
  var endDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  var startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 90);
  var startDate = Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");

  console.log("=== Ad Spend Summary: " + startDate + " to " + endDate + " ===");
  var summary = getAdCampaignSpendSummary(CONFIG.AD_ACCOUNT_ID, startDate, endDate);

  if (summary.error) {
    console.log("Error: " + JSON.stringify(summary.error));
    return summary;
  }

  var totalSpend = 0;
  summary.data.forEach(function (row) {
    totalSpend += row.spend;
    console.log(
      row.campaign_name +
      " | Spend: ¥" + Math.round(row.spend) +
      " | Clicks: " + row.clicks +
      " | CPC: ¥" + Math.round(row.cpc) +
      " | LP Views: " + row.landing_page_views
    );
  });
  console.log("\nTotal Spend: ¥" + Math.round(totalSpend));
  return summary;
}

function testInstagramPosts() {
  console.log("Fetching Instagram posts with insights...");
  const result = getInstagramPostsWithInsights(5);
  console.log("Posts: " + (result.data || []).length);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function testFormConversions() {
  var now = new Date();
  var endDate = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  var startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 90);
  var startDate = Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");

  console.log("=== Form Conversions (Recruiting Site: " + CONFIG.GA4_PROPERTY_RECRUIT + ") ===");
  console.log("Period: " + startDate + " to " + endDate);

  // All conversion events (thankscv, form_start, telcv)
  var formResult = getGA4FormSubmissions(CONFIG.GA4_PROPERTY_RECRUIT, startDate, endDate);
  console.log("Form Events Rows: " + (formResult.rows || []).length);

  if (formResult.rows && formResult.rows.length > 0) {
    var summary = {};
    formResult.rows.forEach(function (row) {
      var eventName = row.eventName || "unknown";
      if (!summary[eventName]) {
        summary[eventName] = { count: 0, campaigns: [] };
      }
      summary[eventName].count += row.totalUsers || row.eventCount || 0;
      if (row.campaignName && row.campaignName !== "(not set)") {
        summary[eventName].campaigns.push(row.campaignName + ": " + (row.totalUsers || row.eventCount || 0));
      }
    });

    Object.keys(summary).forEach(function (eventName) {
      console.log("\n" + eventName + ": " + summary[eventName].count + " events");
      if (summary[eventName].campaigns.length > 0) {
        console.log("  Campaigns: " + summary[eventName].campaigns.join(", "));
      }
    });
  } else {
    console.log("No conversion events found in this period.");
  }

  // Also check CTA page views
  console.log("\n=== CTA Page Views ===");
  var ctaResult = getGA4CTAPageViews(CONFIG.GA4_PROPERTY_RECRUIT, startDate, endDate);
  console.log("CTA Page View Rows: " + (ctaResult.rows || []).length);
  if (ctaResult.rows) {
    ctaResult.rows.forEach(function (row) {
      console.log("  " + (row.campaignName || "(not set)") + " | " + row.pagePath + " | " + row.screenPageViews + " views");
    });
  }

  return { formEvents: formResult, ctaPageViews: ctaResult };
}

function debugFormEvents(customStart, customEnd) {
  var now = new Date();
  var endDate = customEnd || Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd");
  var startDateObj = new Date(now);
  startDateObj.setDate(startDateObj.getDate() - 90);
  var startDate = customStart || Utilities.formatDate(startDateObj, "Asia/Tokyo", "yyyy-MM-dd");

  // Query with date dimension to see daily breakdown
  var propId = CONFIG.GA4_PROPERTY_RECRUIT;
  var report = AnalyticsData.Properties.runReport(
    {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [
        { name: "date" },
        { name: "eventName" },
        { name: "sessionCampaignName" },
      ],
      metrics: [
        { name: "eventCount" },
        { name: "totalUsers" },
      ],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["thankscv", "telcv", "form_start"],
          },
        },
      },
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 500,
    },
    "properties/" + propId
  );

  var rows = [];
  if (report.rows) {
    report.rows.forEach(function(row) {
      rows.push({
        date: row.dimensionValues[0].value,
        event: row.dimensionValues[1].value,
        campaign: row.dimensionValues[2].value,
        eventCount: parseInt(row.metricValues[0].value) || 0,
        users: parseInt(row.metricValues[1].value) || 0,
      });
    });
  }

  // Summary by event
  var byEvent = {};
  var byEventUsers = {};
  rows.forEach(function(r) {
    byEvent[r.event] = (byEvent[r.event] || 0) + r.eventCount;
    byEventUsers[r.event] = (byEventUsers[r.event] || 0) + r.users;
  });

  var output = [];
  output.push("=== Form Event Debug (" + startDate + " ~ " + endDate + ") ===");
  output.push("Property: " + propId + " (Recruit)");
  output.push("");
  output.push("--- Summary by Event ---");
  Object.keys(byEvent).sort().forEach(function(ev) {
    output.push(ev + ": eventCount=" + byEvent[ev] + ", users=" + byEventUsers[ev]);
  });

  output.push("");
  output.push("--- Daily Detail ---");
  rows.forEach(function(r) {
    output.push(r.date + " | " + r.event + " | campaign=" + r.campaign + " | count=" + r.eventCount + " | users=" + r.users);
  });

  var text = output.join("\n");
  console.log(text);
  return text;
}

function testFullDashboard() {
  console.log("Fetching full dashboard data...");
  const data = getAllDashboardData(true);
  console.log("Campaigns: " + (data.summary.campaigns || []).length);
  console.log("Posts: " + (data.instagramPosts.data || []).length);
  console.log("Errors: " + data.errors.join(", "));
  console.log("UTM Configured: " + data.summary.utmConfigured);
  return data;
}
