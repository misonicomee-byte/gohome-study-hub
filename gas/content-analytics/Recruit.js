/**
 * 採用Instagram運用管理シート連携（Phase 2）
 *
 * 管理シート「採用Instagram運用管理」の
 *  - 「投稿管理」タブ: 投稿URLをキーに投稿別インサイト（リーチ・保存・シェア・プロフィールアクセス）を自動記入
 *  - 「KPIダッシュボード」タブ: アカウント週次ファネル（リーチ・プロフィールアクセス・bioリンクタップ）を自動記録
 *  - 週次Chatworkレポート: 先週の投稿実績＋理事長チェック待ちの催促
 *
 * Meta API 呼び出しは Code.js の callInstagramApi() / CONFIG を共用する（新規接続は作らない）。
 * 設計書: instagram-recruit-marketing/docs/superpowers/specs/2026-07-15-instagram-recruit-pipeline-design.md
 */

const RECRUIT_CONFIG = {
  SPREADSHEET_ID: "1ve5NrTOXu6wjtPi9RJAhShCJc3d_QGBtGSvDn9YIUC4",
  SHEET_URL:
    "https://docs.google.com/spreadsheets/d/1ve5NrTOXu6wjtPi9RJAhShCJc3d_QGBtGSvDn9YIUC4/edit",
  POSTS_TAB: "投稿管理",
  KPI_TAB: "KPIダッシュボード",
  // 週次レポート送付先: 理事長ダイレクト（事後チェック用のため船井同席ルームには送らない）
  CHATWORK_ROOM_ID: "260401754",
  // 投稿URLマッチングで遡るメディア取得の上限（50件×4ページ）
  MEDIA_PAGE_SIZE: 50,
  MEDIA_MAX_PAGES: 4,
  // 無人実行ガード: 1実行あたりのインサイトAPI呼び出し上限と実行時間上限
  // （超過分は翌日の日次実行で「実績未記入行が優先」ロジックにより自然に継続処理される）
  MAX_INSIGHT_CALLS_PER_RUN: 40,
  MAX_RUN_MS: 4.5 * 60 * 1000, // GASの6分制限に対する安全マージン
  // 取得済みの実績を再取得する対象期間（日）。これより古い取得済み投稿は更新しない
  METRICS_REFRESH_DAYS: 35,
};

// 「投稿管理」タブの列番号（1-based。build_sheet.py の sheet_spec.py と一致させる）
const RECRUIT_POST_COLS = {
  DATE: 1, // 投稿予定日
  THEME: 2, // テーマ
  PILLAR: 3, // ピラー
  STATUS: 7, // ステータス
  URL: 8, // 投稿URL
  REACH: 9, // リーチ
  SAVED: 10, // 保存
  SHARES: 11, // シェア
  PROFILE: 12, // プロフィールアクセス
  CHECK: 13, // 理事長チェック
};

// ===== PURE HELPERS (unit tested in tests/recruit.test.js) =====

/**
 * Instagram投稿URLからショートコードを抽出する。
 * 例: https://www.instagram.com/p/Cabc/ → "Cabc"、/reel/xxx・/tv/xxx も対応。
 */
function extractIgShortcode_(url) {
  if (!url || typeof url !== "string") return null;
  if (url.indexOf("instagram.com") === -1) return null;
  const m = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** 直近の「完了した」月曜始まり週を返す: { start: Date, endExclusive: Date } */
function recruitWeekRange_(now) {
  const daysSinceMonday = (now.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  const thisMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday
  );
  const start = new Date(
    thisMonday.getFullYear(),
    thisMonday.getMonth(),
    thisMonday.getDate() - 7
  );
  return { start: start, endExclusive: thisMonday };
}

function formatYmd_(date) {
  const pad = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/** シートセルの日付（Date / "yyyy-MM-dd" / "yyyy/MM/dd"）を Date に正規化。不明は null */
function parseSheetDate_(value) {
  // instanceof は vm/レルム跨ぎで偽陰性になるため duck-typing で判定
  if (value && typeof value.getTime === "function") return value;
  if (typeof value !== "string" || !value) return null;
  const m = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** date プロパティが週範囲内の行だけ返す */
function pickPostsForWeek_(rows, range) {
  return rows.filter(function (row) {
    const d = parseSheetDate_(row.date);
    if (!d) return false;
    return d.getTime() >= range.start.getTime() && d.getTime() < range.endExclusive.getTime();
  });
}

/**
 * 実績取得の対象行を選ぶ（純粋関数）。
 * 優先度: 実績未記入 → 直近 METRICS_REFRESH_DAYS 日以内の投稿（新しい順）。
 * 古い取得済み投稿は再取得せず、maxCalls 件で打ち切る。
 */
function selectMetricsTargets_(rows, now, maxCalls) {
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - RECRUIT_CONFIG.METRICS_REFRESH_DAYS
  );
  const candidates = rows.filter(function (r) {
    if (!r.shortcode) return false;
    const empty = r.reach === "" || r.reach === null || r.reach === undefined;
    if (empty) return true;
    const d = parseSheetDate_(r.date);
    return d !== null && d.getTime() >= cutoff.getTime();
  });
  candidates.sort(function (a, b) {
    const aEmpty = a.reach === "" || a.reach === null || a.reach === undefined ? 0 : 1;
    const bEmpty = b.reach === "" || b.reach === null || b.reach === undefined ? 0 : 1;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    const ad = parseSheetDate_(a.date);
    const bd = parseSheetDate_(b.date);
    return (bd ? bd.getTime() : 0) - (ad ? ad.getTime() : 0);
  });
  return candidates.slice(0, maxCalls);
}

/** 週次レポートを送るべきか（純粋関数）。送信済み週ラベルと一致したら force 以外はスキップ */
function recruitShouldSendReport_(lastSentWeekLabel, weekLabel, force) {
  if (force) return true;
  return lastSentWeekLabel !== weekLabel;
}

function formatNum_(n) {
  if (n === null || n === undefined || isNaN(n)) return "取得失敗";
  return Number(n).toLocaleString("en-US");
}

/** 週次Chatworkレポート本文を組み立てる（送信はしない） */
function buildRecruitWeeklyMessage_(params) {
  const lines = [];
  lines.push("[info][title]採用Instagram 週次レポート（" + params.weekLabel + "）[/title]");
  lines.push("━━━ 週次ファネル ━━━");
  lines.push("リーチ: " + formatNum_(params.funnel.reach));
  lines.push("プロフィールアクセス: " + formatNum_(params.funnel.profileViews));
  lines.push("bioリンクタップ: " + formatNum_(params.funnel.websiteClicks));
  lines.push("応募数: シート「KPIダッシュボード」に手動記入してください");
  lines.push("");

  lines.push("━━━ 先週の投稿（" + params.posts.length + "件）━━━");
  if (params.posts.length === 0) {
    lines.push("先週の投稿はありません");
  } else {
    params.posts.forEach(function (p, i) {
      lines.push(
        i +
          1 +
          ". " +
          p.dateLabel +
          " " +
          (p.pillar || "") +
          "「" +
          p.theme +
          "」 リーチ:" +
          formatNum_(p.reach) +
          " 保存:" +
          formatNum_(p.saved) +
          " シェア:" +
          formatNum_(p.shares)
      );
    });
  }
  lines.push("");

  lines.push("━━━ 理事長チェック待ち（" + params.unchecked.length + "件）━━━");
  if (params.unchecked.length === 0) {
    lines.push("チェック待ちはありません");
  } else {
    params.unchecked.forEach(function (u) {
      lines.push("- 「" + u.theme + "」 " + u.url);
    });
    lines.push("→ シート「理事長チェック」列に OK / 要修正 を記入してください");
  }
  lines.push("");
  (params.warnings || []).forEach(function (w) {
    lines.push("⚠ " + w);
  });
  lines.push("管理シート: " + params.sheetUrl);
  lines.push("[/info]");
  return lines.join("\n");
}

// ===== INSTAGRAM API (uses callInstagramApi / CONFIG from Code.js) =====

/**
 * 最近のメディア一覧を取得し shortcode → media の Map を作る。
 * unmatchedShortcodes が空になるか MEDIA_MAX_PAGES に達するまでページング。
 */
function fetchRecruitMediaMap_(neededShortcodes) {
  const map = {};
  const needed = {};
  neededShortcodes.forEach(function (sc) {
    needed[sc] = true;
  });
  let remaining = neededShortcodes.length;

  let after = null;
  for (let page = 0; page < RECRUIT_CONFIG.MEDIA_MAX_PAGES; page++) {
    let endpoint =
      CONFIG.INSTAGRAM_BUSINESS_ACCOUNT_ID +
      "/media?fields=id,permalink,timestamp,media_type&limit=" +
      RECRUIT_CONFIG.MEDIA_PAGE_SIZE;
    if (after) endpoint += "&after=" + encodeURIComponent(after);

    const data = callInstagramApi(endpoint);
    if (data.error) {
      console.error("fetchRecruitMediaMap_ error:", data.error);
      break;
    }
    (data.data || []).forEach(function (media) {
      const sc = extractIgShortcode_(media.permalink);
      if (sc && !map[sc]) {
        map[sc] = media;
        if (needed[sc]) remaining--;
      }
    });
    if (remaining <= 0) break;
    after = data.paging && data.paging.cursors && data.paging.cursors.after;
    if (!after || !(data.data || []).length) break;
  }
  return map;
}

/**
 * 投稿別インサイト。reach/saved/shares に加えて profile_visits を試み、
 * メディア種別で未対応（リール等）なら profileVisits: null で返す。
 */
function getRecruitPostInsights_(mediaId) {
  const parse = function (data) {
    const out = {};
    (data.data || []).forEach(function (metric) {
      if (metric.values && metric.values.length > 0) {
        out[metric.name] = metric.values[0].value;
      } else if (metric.total_value) {
        out[metric.name] = metric.total_value.value;
      }
    });
    return out;
  };

  let data = callInstagramApi(
    mediaId + "/insights?metric=reach,saved,shares,profile_visits"
  );
  let profileSupported = true;
  if (data.error) {
    profileSupported = false;
    data = callInstagramApi(mediaId + "/insights?metric=reach,saved,shares");
    if (data.error) {
      console.error("getRecruitPostInsights_ error for " + mediaId + ":", data.error);
      return null;
    }
  }
  const v = parse(data);
  return {
    reach: v.reach || 0,
    saved: v.saved || 0,
    shares: v.shares || 0,
    profileVisits: profileSupported ? v.profile_visits || 0 : null,
  };
}

/**
 * アカウントレベルの週次インサイト（リーチ・プロフィール表示・ウェブサイトクリック）。
 * metric_type=total_value で期間合計を取得。個別メトリクスが落ちても他は返す。
 */
function getRecruitAccountInsights_(sinceUnix, untilUnix) {
  const result = { reach: null, profileViews: null, websiteClicks: null };
  const metricMap = {
    reach: "reach",
    profileViews: "profile_views",
    websiteClicks: "website_clicks",
  };

  const endpoint =
    CONFIG.INSTAGRAM_BUSINESS_ACCOUNT_ID +
    "/insights?metric=reach,profile_views,website_clicks&period=day&metric_type=total_value" +
    "&since=" +
    sinceUnix +
    "&until=" +
    untilUnix;
  const data = callInstagramApi(endpoint);

  const applyData = function (payload) {
    (payload.data || []).forEach(function (metric) {
      const key = Object.keys(metricMap).filter(function (k) {
        return metricMap[k] === metric.name;
      })[0];
      if (!key) return;
      if (metric.total_value && metric.total_value.value !== undefined) {
        result[key] = metric.total_value.value;
      } else if (metric.values) {
        result[key] = metric.values.reduce(function (sum, v) {
          return sum + (v.value || 0);
        }, 0);
      }
    });
  };

  if (!data.error) {
    applyData(data);
    return result;
  }

  // 一括取得が失敗した場合はメトリクス別に再試行（1つの未対応メトリクスで全滅させない）
  console.warn("Account insights bulk fetch failed, retrying per metric:", data.error);
  Object.keys(metricMap).forEach(function (key) {
    const single = callInstagramApi(
      CONFIG.INSTAGRAM_BUSINESS_ACCOUNT_ID +
        "/insights?metric=" +
        metricMap[key] +
        "&period=day&metric_type=total_value&since=" +
        sinceUnix +
        "&until=" +
        untilUnix
    );
    if (!single.error) applyData(single);
  });
  return result;
}

// ===== SHEET SYNC =====

function getRecruitSheet_(tabName) {
  const ss = SpreadsheetApp.openById(RECRUIT_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error("管理シートにタブ「" + tabName + "」が見つかりません");
  return sheet;
}

/**
 * 毎日実行: 「投稿管理」タブの投稿URLをキーに実績を自動記入。
 * URLが記入済みでステータスが未更新の行は「投稿済み」に更新する。
 *
 * 無人実行ガード: 対象は「実績未記入」＋「直近35日の投稿」に絞り、
 * API呼び出し件数と実行時間に上限を設ける。超過分は翌日の実行が
 * 未記入行を優先するため自然に継続される（カーソル保存は不要）。
 */
function updateRecruitPostMetrics() {
  const startMs = Date.now();
  const sheet = getRecruitSheet_(RECRUIT_CONFIG.POSTS_TAB);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log("updateRecruitPostMetrics: no data rows");
    return { updated: 0, unmatched: [], skipped: 0 };
  }

  const values = sheet
    .getRange(2, 1, lastRow - 1, RECRUIT_POST_COLS.CHECK)
    .getValues();

  const rows = values.map(function (row, i) {
    return {
      rowIndex: i + 2,
      url: String(row[RECRUIT_POST_COLS.URL - 1] || "").trim(),
      shortcode: extractIgShortcode_(String(row[RECRUIT_POST_COLS.URL - 1] || "").trim()),
      date: row[RECRUIT_POST_COLS.DATE - 1],
      reach: row[RECRUIT_POST_COLS.REACH - 1],
      status: String(row[RECRUIT_POST_COLS.STATUS - 1] || ""),
    };
  });

  const targets = selectMetricsTargets_(
    rows,
    new Date(),
    RECRUIT_CONFIG.MAX_INSIGHT_CALLS_PER_RUN
  );
  if (targets.length === 0) {
    console.log("updateRecruitPostMetrics: no target rows");
    return { updated: 0, unmatched: [], skipped: 0 };
  }

  const mediaMap = fetchRecruitMediaMap_(
    targets.map(function (t) {
      return t.shortcode;
    })
  );

  let updated = 0;
  let skipped = 0;
  const unmatched = [];
  // 書き込みは収集してループ後にまとめて実行（API途中失敗時もそれまでの分は反映）
  const writes = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (Date.now() - startMs > RECRUIT_CONFIG.MAX_RUN_MS) {
      skipped = targets.length - i;
      console.warn("updateRecruitPostMetrics: time guard hit, skipping " + skipped + " rows");
      break;
    }
    const media = mediaMap[t.shortcode];
    if (!media) {
      unmatched.push(t.url);
      continue;
    }
    const insights = getRecruitPostInsights_(media.id);
    if (!insights) {
      unmatched.push(t.url);
      continue;
    }
    writes.push({ target: t, insights: insights });
  }

  writes.forEach(function (w) {
    sheet
      .getRange(w.target.rowIndex, RECRUIT_POST_COLS.REACH, 1, 4)
      .setValues([
        [
          w.insights.reach,
          w.insights.saved,
          w.insights.shares,
          w.insights.profileVisits === null ? "" : w.insights.profileVisits,
        ],
      ]);
    if (w.target.status !== "投稿済み") {
      sheet.getRange(w.target.rowIndex, RECRUIT_POST_COLS.STATUS).setValue("投稿済み");
    }
    updated++;
  });

  console.log(
    "updateRecruitPostMetrics: updated=" +
      updated +
      " skipped=" +
      skipped +
      " unmatched=" +
      JSON.stringify(unmatched)
  );
  return { updated: updated, unmatched: unmatched, skipped: skipped };
}

/**
 * 週次実行: 直近の完了週のアカウントファネルを「KPIダッシュボード」に記録。
 * 既存行があれば B〜D 列のみ更新（手動記入の応募数・備考は保持）。
 */
function updateRecruitKpiWeekly() {
  const range = recruitWeekRange_(new Date());
  const weekLabel = formatYmd_(range.start);
  const sinceUnix = Math.floor(range.start.getTime() / 1000);
  const untilUnix = Math.floor(range.endExclusive.getTime() / 1000) - 1;

  const funnel = getRecruitAccountInsights_(sinceUnix, untilUnix);

  const sheet = getRecruitSheet_(RECRUIT_CONFIG.KPI_TAB);
  const lastRow = sheet.getLastRow();
  let targetRow = null;
  if (lastRow >= 2) {
    const weekValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    weekValues.forEach(function (row, i) {
      const d = parseSheetDate_(row[0]);
      const label = d ? formatYmd_(d) : String(row[0]).trim();
      if (label === weekLabel) targetRow = i + 2;
    });
  }
  if (targetRow === null) targetRow = Math.max(lastRow + 1, 2);

  sheet.getRange(targetRow, 1).setValue(weekLabel);
  sheet
    .getRange(targetRow, 2, 1, 3)
    .setValues([
      [
        funnel.reach === null ? "" : funnel.reach,
        funnel.profileViews === null ? "" : funnel.profileViews,
        funnel.websiteClicks === null ? "" : funnel.websiteClicks,
      ],
    ]);

  console.log("updateRecruitKpiWeekly: week=" + weekLabel + " " + JSON.stringify(funnel));
  return { weekLabel: weekLabel, range: range, funnel: funnel };
}

// ===== WEEKLY REPORT =====

/** レポート素材を集めて本文を作る（送信しない。プレビュー・テスト用に分離） */
function buildRecruitWeeklyReport_() {
  const warnings = [];

  // 実績を最新化してからレポートを作る。同期に失敗してもシートの前回値でレポートは出す
  try {
    const sync = updateRecruitPostMetrics();
    if (sync.skipped > 0) {
      warnings.push("投稿実績の一部（" + sync.skipped + "件）は時間切れで未更新（翌日再取得）");
    }
    if (sync.unmatched.length > 0) {
      warnings.push("投稿URLがInstagram上で見つからない行: " + sync.unmatched.join(" "));
    }
  } catch (e) {
    console.error("buildRecruitWeeklyReport_: metrics sync failed:", e);
    warnings.push("投稿実績の自動記入に失敗（前回値でレポート）: " + e.message);
  }

  let kpi;
  try {
    kpi = updateRecruitKpiWeekly();
  } catch (e) {
    console.error("buildRecruitWeeklyReport_: KPI update failed:", e);
    warnings.push("週次ファネルの取得に失敗: " + e.message);
    const range = recruitWeekRange_(new Date());
    kpi = {
      weekLabel: formatYmd_(range.start),
      range: range,
      funnel: { reach: null, profileViews: null, websiteClicks: null },
    };
  }

  const sheet = getRecruitSheet_(RECRUIT_CONFIG.POSTS_TAB);
  const lastRow = sheet.getLastRow();
  const rows =
    lastRow < 2
      ? []
      : sheet.getRange(2, 1, lastRow - 1, RECRUIT_POST_COLS.CHECK).getValues();

  const posted = rows
    .filter(function (row) {
      return String(row[RECRUIT_POST_COLS.STATUS - 1]) === "投稿済み";
    })
    .map(function (row) {
      return {
        date: row[RECRUIT_POST_COLS.DATE - 1],
        theme: String(row[RECRUIT_POST_COLS.THEME - 1] || "(テーマ未記入)"),
        pillar: String(row[RECRUIT_POST_COLS.PILLAR - 1] || ""),
        url: String(row[RECRUIT_POST_COLS.URL - 1] || ""),
        reach: row[RECRUIT_POST_COLS.REACH - 1] || 0,
        saved: row[RECRUIT_POST_COLS.SAVED - 1] || 0,
        shares: row[RECRUIT_POST_COLS.SHARES - 1] || 0,
        check: String(row[RECRUIT_POST_COLS.CHECK - 1] || ""),
      };
    });

  const weekPosts = pickPostsForWeek_(posted, kpi.range).map(function (p) {
    const d = parseSheetDate_(p.date);
    const pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return {
      dateLabel: d ? pad(d.getMonth() + 1) + "/" + pad(d.getDate()) : "??/??",
      theme: p.theme,
      pillar: p.pillar,
      reach: p.reach,
      saved: p.saved,
      shares: p.shares,
    };
  });

  const unchecked = posted
    .filter(function (p) {
      return p.check === "" || p.check === "未確認";
    })
    .map(function (p) {
      return { theme: p.theme, url: p.url };
    });

  const endLabel = formatYmd_(new Date(kpi.range.endExclusive.getTime() - 1));
  return {
    weekLabel: kpi.weekLabel,
    message: buildRecruitWeeklyMessage_({
      weekLabel: kpi.weekLabel + "〜" + endLabel,
      funnel: kpi.funnel,
      posts: weekPosts,
      unchecked: unchecked,
      sheetUrl: RECRUIT_CONFIG.SHEET_URL,
      warnings: warnings,
    }),
  };
}

/**
 * 週次実行: レポートを組み立てて理事長のChatworkへ送信。
 * ScriptLock＋送信済み週マーカーで同一週の二重送信を防ぐ（トリガー重複・手動再実行対策）。
 */
function sendRecruitWeeklyReport() {
  return sendRecruitWeeklyReportInternal_(false);
}

/** 手動用: 送信済みマーカーを無視して今週分を再送する */
function forceSendRecruitWeeklyReport() {
  return sendRecruitWeeklyReportInternal_(true);
}

function sendRecruitWeeklyReportInternal_(force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    console.warn("sendRecruitWeeklyReport: could not acquire lock, another run in progress");
    return { sent: false, reason: "lock" };
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const report = buildRecruitWeeklyReport_();
    const lastSent = props.getProperty("RECRUIT_REPORT_LAST_SENT_WEEK");
    if (!recruitShouldSendReport_(lastSent, report.weekLabel, force)) {
      console.log("sendRecruitWeeklyReport: week " + report.weekLabel + " already sent, skip");
      return { sent: false, reason: "already_sent" };
    }

    const url =
      "https://api.chatwork.com/v2/rooms/" + RECRUIT_CONFIG.CHATWORK_ROOM_ID + "/messages";
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      headers: { "X-ChatWorkToken": CONFIG.CHATWORK_API_TOKEN },
      payload: { body: report.message },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code >= 300) {
      // 送信失敗時はマーカーを更新しない（次回実行で再送される）
      throw new Error("Chatwork送信失敗 (" + code + "): " + response.getContentText());
    }
    props.setProperty("RECRUIT_REPORT_LAST_SENT_WEEK", report.weekLabel);
    console.log("sendRecruitWeeklyReport: sent week " + report.weekLabel);
    return { sent: true };
  } finally {
    lock.releaseLock();
  }
}

// ===== TRIGGERS =====

/** 採用IG連携のトリガーを設定（既存ダッシュボードのトリガーには触れない） */
function setupRecruitTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === "updateRecruitPostMetrics" || fn === "sendRecruitWeeklyReport") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 毎日7:00 投稿実績の自動記入（既存の6:00全体フェッチの後）
  ScriptApp.newTrigger("updateRecruitPostMetrics").timeBased().atHour(7).everyDays(1).create();

  // 毎週月曜8:00 週次レポート（KPI記録込み）
  ScriptApp.newTrigger("sendRecruitWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  console.log("Recruit triggers set: daily metrics (7:00), weekly report (Mon 8:00)");
}

// ===== MANUAL TEST HELPERS =====

/** 手動テスト: シート書き込みなしで投稿URLのマッチ状況をログに出す */
function testRecruitMatching() {
  const sheet = getRecruitSheet_(RECRUIT_CONFIG.POSTS_TAB);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log("no data rows");
    return;
  }
  const values = sheet.getRange(2, 1, lastRow - 1, RECRUIT_POST_COLS.CHECK).getValues();
  const shortcodes = [];
  values.forEach(function (row) {
    const sc = extractIgShortcode_(String(row[RECRUIT_POST_COLS.URL - 1] || ""));
    if (sc) shortcodes.push(sc);
  });
  console.log("URLs with shortcode: " + JSON.stringify(shortcodes));
  const map = fetchRecruitMediaMap_(shortcodes);
  shortcodes.forEach(function (sc) {
    console.log(sc + " → " + (map[sc] ? map[sc].id : "NOT FOUND"));
  });
}

/** 手動テスト: 週次レポート本文をログに出す（Chatwork送信なし。シートの実績更新は実行される） */
function testRecruitWeeklyReportPreview() {
  const report = buildRecruitWeeklyReport_();
  console.log("week=" + report.weekLabel + "\n" + report.message);
}
