import { requireCloudflareAccess } from "../../_shared/accessGuard";

interface AnalyticsDashboardEnv {
  ANALYTICS_DB?: D1Database;
}

type QueryParam = string | number | null;

const NO_STORE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export async function onRequestGet(context: {
  request: Request;
  env: AnalyticsDashboardEnv;
}): Promise<Response> {
  const access = requireCloudflareAccess(context.request);
  if (!access.ok) {
    return json({ ok: false, error: "cloudflare_access_required" }, 401);
  }

  const db = context.env.ANALYTICS_DB;
  if (!db) {
    return json({ ok: false, error: "analytics_db_not_configured" }, 503);
  }

  const url = new URL(context.request.url);
  const days = normalizeDays(url.searchParams.get("days"));
  const sinceModifier = `-${days} days`;

  const [summary, daily, topClicks, videoStats, trainingActions, eventTotals] =
    await Promise.all([
      queryFirst(db, summarySql(), [sinceModifier]),
      queryRows(db, dailySql(), [sinceModifier]),
      queryRows(db, topClicksSql(), [sinceModifier]),
      queryRows(db, videoStatsSql(), [sinceModifier]),
      queryRows(db, trainingActionsSql(), [sinceModifier]),
      queryRows(db, eventTotalsSql(), [sinceModifier]),
    ]);

  return json({
    ok: true,
    days,
    generated_at: new Date().toISOString(),
    user_email: access.email,
    data: {
      summary: summary || {},
      daily,
      topClicks,
      videoStats,
      trainingActions,
      eventTotals,
    },
  });
}

export function onRequestOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}

export function onRequestPost(): Response {
  return json({ ok: false, error: "method_not_allowed" }, 405, {
    Allow: "GET, OPTIONS",
  });
}

async function queryRows(
  db: D1Database,
  sql: string,
  params: QueryParam[] = [],
): Promise<unknown[]> {
  const statement = db.prepare(sql);
  const bound = params.length ? statement.bind(...params) : statement;
  const result = await bound.all();
  return Array.isArray(result.results) ? result.results : [];
}

async function queryFirst(
  db: D1Database,
  sql: string,
  params: QueryParam[] = [],
): Promise<unknown | null> {
  const statement = db.prepare(sql);
  const bound = params.length ? statement.bind(...params) : statement;
  return bound.first();
}

function normalizeDays(value: string | null): number {
  const parsed = Number.parseInt(value || "30", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 366) return 30;
  return parsed;
}

function summarySql(): string {
  return `
    SELECT
      COUNT(*) AS total_events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors,
      COALESCE(SUM(CASE WHEN event_name = 'content_click' THEN 1 ELSE 0 END), 0) AS clicks,
      COALESCE(SUM(CASE WHEN event_name = 'video_play' THEN 1 ELSE 0 END), 0) AS video_plays,
      COALESCE(SUM(CASE WHEN event_name = 'video_complete' THEN 1 ELSE 0 END), 0) AS video_completes,
      COALESCE(SUM(CASE WHEN event_name IN ('quiz_grade', 'module_complete', 'certificate_create') THEN 1 ELSE 0 END), 0) AS training_actions
    FROM analytics_events
    WHERE created_at >= datetime('now', ?)
  `;
}

function dailySql(): string {
  return `
    SELECT
      substr(created_at, 1, 10) AS date,
      COUNT(*) AS total_events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors,
      SUM(CASE WHEN event_name = 'content_click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_name = 'video_play' THEN 1 ELSE 0 END) AS video_plays,
      SUM(CASE WHEN event_name = 'video_complete' THEN 1 ELSE 0 END) AS video_completes,
      SUM(CASE WHEN event_name IN ('quiz_grade', 'module_complete', 'certificate_create') THEN 1 ELSE 0 END) AS training_actions
    FROM analytics_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY date
    ORDER BY date ASC
  `;
}

function topClicksSql(): string {
  return `
    SELECT
      COALESCE(content_type, 'unknown') AS content_type,
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      COALESCE(destination_url, '') AS destination_url,
      COUNT(*) AS clicks,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE event_name = 'content_click'
      AND created_at >= datetime('now', ?)
    GROUP BY content_type, content_id, content_title, destination_url
    ORDER BY clicks DESC, visitors DESC
    LIMIT 30
  `;
}

function videoStatsSql(): string {
  return `
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
      AND created_at >= datetime('now', ?)
    GROUP BY content_id, content_title
    ORDER BY plays DESC, p75 DESC, completes DESC
    LIMIT 40
  `;
}

function trainingActionsSql(): string {
  return `
    SELECT
      event_name,
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      COUNT(*) AS events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE content_type = 'legal_training_video'
      AND event_name IN ('quiz_grade', 'module_complete', 'certificate_create')
      AND created_at >= datetime('now', ?)
    GROUP BY event_name, content_id, content_title
    ORDER BY events DESC
    LIMIT 40
  `;
}

function eventTotalsSql(): string {
  return `
    SELECT
      event_name,
      COUNT(*) AS events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY event_name
    ORDER BY events DESC
  `;
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...extraHeaders,
    },
  });
}
