import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { appendFileSync } from "node:fs";

const DATABASE_NAME = process.env.ANALYTICS_DATABASE_NAME || "gohome-study-analytics";
const DATABASE_ID = process.env.ANALYTICS_DATABASE_ID || "5a97458f-7a20-416b-b2f6-968595da0f4f";
const DEFAULT_BLOG_PERFORMANCE_SPREADSHEET_ID = "1mPg_kiLfHtGBwnvE9DERfdZB_4cRYRuIGcySoTQQuVY";
const REPORT_URL = process.env.ANALYTICS_REPORT_URL || "https://study.gohome-clinic.com/api/analytics/report";
const ANALYTICS_DASHBOARD_URL = "https://study.gohome-clinic.com/data/";
const days = normalizeDays(process.env.REPORT_DAYS);
const recordedAt = nowJstIso();
const reportEndDate = formatJstDate(new Date());
const reportStartDate = formatJstDate(addDays(new Date(), -days));

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

const sheetsUrl = await maybeAppendGoogleSheetsReport(result);
if (sheetsUrl) {
  console.log(`Google Sheets report appended: ${sheetsUrl}`);
}

function normalizeDays(value) {
  const parsed = Number.parseInt(String(value || "30"), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 366) return 30;
  return parsed;
}

function addDays(date, offset) {
  const copied = new Date(date);
  copied.setUTCDate(copied.getUTCDate() + offset);
  return copied;
}

function formatJstDate(value) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(value);
}

function nowJstIso() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+09:00`;
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
    "[info][title]情報資料室サイト行動分析レポート[/title]",
    `対象期間: 過去${days}日`,
    `情報資料室サイト分析Webアプリ: ${ANALYTICS_DASHBOARD_URL}`,
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

async function maybeAppendGoogleSheetsReport(data) {
  const spreadsheetId = process.env.BLOG_PERFORMANCE_SPREADSHEET_ID || DEFAULT_BLOG_PERFORMANCE_SPREADSHEET_ID;
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.PATIENT_MAP_SA_JSON;
  if (!spreadsheetId || !rawCredentials) {
    console.log("Google Sheets append skipped: BLOG_PERFORMANCE_SPREADSHEET_ID or service account JSON is not set.");
    return null;
  }

  const credentials = parseServiceAccount(rawCredentials);
  const accessToken = await getGoogleAccessToken(credentials);
  const sheets = createSheetsClient({ spreadsheetId, accessToken });
  const groups = buildSheetRowGroups(data);

  for (const group of groups) {
    await sheets.ensureSheet(group.sheetName);
    await sheets.ensureHeaders(group.sheetName, group.headers);
    if (group.rows.length > 0) {
      await sheets.appendRows(group.sheetName, group.rows);
    }
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function buildSheetRowGroups(data) {
  const common = [recordedAt, reportStartDate, reportEndDate, days];
  const totalsRows = data.totals.length
    ? data.totals.map((row) => [...common, row.event_name, row.events, row.visitors])
    : [[...common, "no_data", 0, 0]];

  return [
    {
      sheetName: "studyサイトイベント集計_履歴",
      headers: ["記録日時", "集計開始日", "集計終了日", "集計日数", "イベント", "件数", "訪問者数"],
      rows: totalsRows,
    },
    {
      sheetName: "studyサイトクリック_履歴",
      headers: [
        "記録日時",
        "集計開始日",
        "集計終了日",
        "集計日数",
        "種別",
        "コンテンツID",
        "タイトル",
        "クリック数",
        "訪問者数",
      ],
      rows: data.topClicks.map((row) => [
        ...common,
        row.content_type,
        row.content_id,
        row.content_title,
        row.clicks,
        row.visitors,
      ]),
    },
    {
      sheetName: "study法定研修動画_履歴",
      headers: [
        "記録日時",
        "集計開始日",
        "集計終了日",
        "集計日数",
        "モジュールID",
        "研修名",
        "再生開始",
        "25%到達",
        "50%到達",
        "75%到達",
        "95%到達",
        "完了",
        "訪問者数",
        "75%到達率",
        "完了率",
      ],
      rows: data.videoStats.map((row) => {
        const plays = Number(row.plays || 0);
        return [
          ...common,
          row.content_id,
          row.content_title,
          row.plays,
          row.p25,
          row.p50,
          row.p75,
          row.p95,
          row.completes,
          row.visitors,
          rate(row.p75, plays),
          rate(row.completes, plays),
        ];
      }),
    },
    {
      sheetName: "study法定研修アクション_履歴",
      headers: [
        "記録日時",
        "集計開始日",
        "集計終了日",
        "集計日数",
        "イベント",
        "モジュールID",
        "研修名",
        "件数",
        "訪問者数",
      ],
      rows: data.trainingActions.map((row) => [
        ...common,
        row.event_name,
        row.content_id,
        row.content_title,
        row.events,
        row.visitors,
      ]),
    },
  ];
}

function rate(numerator, denominator) {
  const den = Number(denominator || 0);
  if (den <= 0) return 0;
  return Math.round((Number(numerator || 0) / den) * 10000) / 10000;
}

function parseServiceAccount(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON must include client_email and private_key.");
  }
  return parsed;
}

async function getGoogleAccessToken(credentials) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: iat + 3600,
    iat,
  };
  const assertion = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(JSON.stringify(claims)),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(assertion).sign(credentials.private_key);
  const jwt = `${assertion}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`Google token request failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString("base64url");
}

function createSheetsClient({ spreadsheetId, accessToken }) {
  async function ensureSheet(sheetName) {
    const spreadsheet = await request("", {
      query: new URLSearchParams({ fields: "sheets.properties.title" }),
    });
    const titles = (spreadsheet.sheets || []).map((sheet) => sheet.properties?.title);
    if (titles.includes(sheetName)) return;
    await request(":batchUpdate", {
      method: "POST",
      body: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { rowCount: 1000, columnCount: 20 },
              },
            },
          },
        ],
      },
    });
  }

  async function ensureHeaders(sheetName, headers) {
    const current = await getValues(`${quoteSheetName(sheetName)}!1:1`);
    const firstRow = current.values?.[0] || [];
    if (headersEqual(firstRow, headers)) return;
    await updateValues(`${quoteSheetName(sheetName)}!A1`, [headers]);
  }

  async function appendRows(sheetName, rows) {
    await valuesRequest(`${quoteSheetName(sheetName)}!A1:Z`, ":append", {
      method: "POST",
      query: new URLSearchParams({
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
      }),
      body: { values: rows },
    });
  }

  async function getValues(range) {
    return valuesRequest(range, "", { method: "GET" });
  }

  async function updateValues(range, values) {
    return valuesRequest(range, "", {
      method: "PUT",
      query: new URLSearchParams({ valueInputOption: "USER_ENTERED" }),
      body: { values },
    });
  }

  async function valuesRequest(range, suffix, options = {}) {
    return rawRequest(
      `/${spreadsheetId}/values/${encodeURIComponent(range)}${suffix}`,
      options,
    );
  }

  async function request(suffix, options = {}) {
    return rawRequest(`/${spreadsheetId}${suffix}`, options);
  }

  async function rawRequest(path, options = {}) {
    const query = options.query ? `?${options.query.toString()}` : "";
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}${query}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Google Sheets request failed: ${JSON.stringify(json)}`);
    }
    return json;
  }

  return {
    ensureSheet,
    ensureHeaders,
    appendRows,
  };
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function headersEqual(current, expected) {
  if (current.length < expected.length) return false;
  return expected.every((header, index) => String(current[index] || "") === header);
}
