import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const DATABASE_NAME = process.env.ANALYTICS_DATABASE_NAME || "gohome-study-analytics";
const DATABASE_ID = process.env.ANALYTICS_DATABASE_ID || "5a97458f-7a20-416b-b2f6-968595da0f4f";
const REPORT_URL = process.env.ANALYTICS_REPORT_URL || "https://study.gohome-clinic.com/api/analytics/report";
const days = normalizeDays(process.env.REPORT_DAYS);

const sinceExpression = `datetime('now', '-${days} days')`;

const queries = {
  topClicks: `
    SELECT
      COALESCE(content_type, 'unknown') AS content_type,
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      COUNT(*) AS clicks,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE event_name = 'content_click'
      AND created_at >= ${sinceExpression}
    GROUP BY content_type, content_id, content_title
    ORDER BY clicks DESC, visitors DESC
    LIMIT 20
  `,
  videoStats: `
    SELECT
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      SUM(CASE WHEN event_name = 'video_play' THEN 1 ELSE 0 END) AS plays,
      SUM(CASE WHEN event_name = 'video_progress' AND video_progress = 25 THEN 1 ELSE 0 END) AS p25,
      SUM(CASE WHEN event_name = 'video_progress' AND video_progress = 50 THEN 1 ELSE 0 END) AS p50,
      SUM(CASE WHEN event_name = 'video_progress' AND video_progress = 75 THEN 1 ELSE 0 END) AS p75,
      SUM(CASE WHEN event_name = 'video_progress' AND video_progress = 95 THEN 1 ELSE 0 END) AS p95,
      SUM(CASE WHEN event_name = 'video_complete' THEN 1 ELSE 0 END) AS completes,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE content_type = 'legal_training_video'
      AND event_name IN ('video_play', 'video_progress', 'video_complete')
      AND created_at >= ${sinceExpression}
    GROUP BY content_id, content_title
    ORDER BY plays DESC, p75 DESC, completes DESC
    LIMIT 30
  `,
  trainingActions: `
    SELECT
      event_name,
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      COUNT(*) AS events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE content_type = 'legal_training_video'
      AND event_name IN ('quiz_grade', 'module_complete', 'certificate_create')
      AND created_at >= ${sinceExpression}
    GROUP BY event_name, content_id, content_title
    ORDER BY events DESC
    LIMIT 30
  `,
  totals: `
    SELECT
      event_name,
      COUNT(*) AS events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE created_at >= ${sinceExpression}
    GROUP BY event_name
    ORDER BY events DESC
  `,
};

const result = await loadReportData();

const markdown = renderMarkdown(result);
console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");
}

const chatworkSent = await maybeSendChatwork(renderChatwork(result));
if (!chatworkSent) {
  console.log("Chatwork notification skipped: CHATWORK_API_TOKEN or CHATWORK_NOTIFY_ROOM_ID is not set.");
}

function normalizeDays(value) {
  const parsed = Number.parseInt(String(value || "30"), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 366) return 30;
  return parsed;
}

async function queryRows(sql) {
  if (process.env.ANALYTICS_REPORT_TOKEN) {
    throw new Error("Direct D1 query is disabled when ANALYTICS_REPORT_TOKEN is set.");
  }
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
    return queryRowsWithCloudflareApi(sql);
  }
  return queryRowsWithWrangler(sql);
}

async function loadReportData() {
  if (process.env.ANALYTICS_REPORT_TOKEN) {
    return queryRowsWithReportEndpoint();
  }

  return {
    topClicks: await queryRows(queries.topClicks),
    videoStats: await queryRows(queries.videoStats),
    trainingActions: await queryRows(queries.trainingActions),
    totals: await queryRows(queries.totals),
  };
}

async function queryRowsWithReportEndpoint() {
  const url = new URL(REPORT_URL);
  url.searchParams.set("days", String(days));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.ANALYTICS_REPORT_TOKEN}`,
      Accept: "application/json",
    },
  });
  const json = await response.json();
  if (!response.ok || json.ok !== true) {
    throw new Error(`Analytics report endpoint failed: ${JSON.stringify(json)}`);
  }
  return {
    topClicks: Array.isArray(json.data?.topClicks) ? json.data.topClicks : [],
    videoStats: Array.isArray(json.data?.videoStats) ? json.data.videoStats : [],
    trainingActions: Array.isArray(json.data?.trainingActions) ? json.data.trainingActions : [],
    totals: Array.isArray(json.data?.totals) ? json.data.totals : [],
  };
}

async function queryRowsWithCloudflareApi(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: compactSql(sql) }),
  });
  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(`Cloudflare D1 query failed: ${JSON.stringify(json.errors || json)}`);
  }
  return extractRows(json);
}

function queryRowsWithWrangler(sql) {
  const output = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", compactSql(sql)],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return extractRows(parseJsonOutput(output));
}

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  const firstArray = trimmed.indexOf("[");
  const firstObject = trimmed.indexOf("{");
  const start = firstArray === -1
    ? firstObject
    : firstObject === -1
      ? firstArray
      : Math.min(firstArray, firstObject);
  if (start === -1) throw new Error(`Could not parse wrangler output: ${trimmed}`);
  return JSON.parse(trimmed.slice(start));
}

function extractRows(json) {
  if (Array.isArray(json)) {
    for (const entry of json) {
      const rows = extractRows(entry);
      if (rows.length > 0 || entry?.results) return rows;
    }
    return [];
  }
  if (Array.isArray(json?.result)) {
    return extractRows(json.result);
  }
  if (Array.isArray(json?.results)) {
    return json.results;
  }
  return [];
}

function renderMarkdown(data) {
  const lines = [
    `# studyサイト行動分析レポート（過去${days}日）`,
    "",
    "## イベント総数",
    table(
      ["event", "events", "visitors"],
      data.totals.map((row) => [row.event_name, row.events, row.visitors]),
    ),
    "",
    "## クリック上位",
    table(
      ["type", "title", "clicks", "visitors"],
      data.topClicks.map((row) => [
        row.content_type,
        shortLabel(row.content_title || row.content_id, 42),
        row.clicks,
        row.visitors,
      ]),
    ),
    "",
    "## 法定研修動画",
    table(
      ["module", "plays", "25%", "50%", "75%", "95%", "complete"],
      data.videoStats.map((row) => [
        shortLabel(row.content_title || row.content_id, 36),
        row.plays,
        row.p25,
        row.p50,
        row.p75,
        row.p95,
        row.completes,
      ]),
    ),
    "",
    "## 法定研修アクション",
    table(
      ["event", "module", "events", "visitors"],
      data.trainingActions.map((row) => [
        row.event_name,
        shortLabel(row.content_title || row.content_id, 36),
        row.events,
        row.visitors,
      ]),
    ),
  ];
  return lines.join("\n");
}

function renderChatwork(data) {
  const clickLines = data.topClicks.slice(0, 10).map((row, index) => {
    return `${index + 1}. ${shortLabel(row.content_title || row.content_id, 28)} / ${row.content_type}: ${row.clicks}クリック`;
  });
  const videoLines = data.videoStats.slice(0, 10).map((row, index) => {
    return `${index + 1}. ${shortLabel(row.content_title || row.content_id, 28)}: 再生${row.plays} / 75%到達${row.p75} / 完了${row.completes}`;
  });

  return [
    "[info][title]studyサイト行動分析レポート[/title]",
    `対象期間: 過去${days}日`,
    "",
    "クリック上位",
    clickLines.length ? clickLines.join("\n") : "データなし",
    "",
    "法定研修動画",
    videoLines.length ? videoLines.join("\n") : "データなし",
    "",
    "詳細はGitHub ActionsのJob Summaryを確認してください。",
    "[/info]",
  ].join("\n");
}

function table(headers, rows) {
  if (!rows.length) return "_データなし_";
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => escapeTableCell(cell)).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function escapeTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function shortLabel(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

async function maybeSendChatwork(message) {
  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_NOTIFY_ROOM_ID;
  if (!token || !roomId) return false;

  const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ body: message }),
  });
  if (!response.ok) {
    throw new Error(`Chatwork notification failed: ${response.status} ${await response.text()}`);
  }
  return true;
}
