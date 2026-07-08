interface AnalyticsReportEnv {
  ANALYTICS_DB?: D1Database;
  ANALYTICS_REPORT_TOKEN?: string;
}

export async function onRequestGet(context: {
  request: Request;
  env: AnalyticsReportEnv;
}): Promise<Response> {
  const expectedToken = context.env.ANALYTICS_REPORT_TOKEN;
  if (!expectedToken) {
    return json({ ok: false, error: "report_token_not_configured" }, 503);
  }

  const authorization = context.request.headers.get("Authorization") || "";
  if (authorization !== `Bearer ${expectedToken}`) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const db = context.env.ANALYTICS_DB;
  if (!db) {
    return json({ ok: false, error: "analytics_db_not_configured" }, 503);
  }

  const url = new URL(context.request.url);
  const days = normalizeDays(url.searchParams.get("days"));
  const data = {
    topClicks: await queryRows(db, topClicksSql(days)),
    videoStats: await queryRows(db, videoStatsSql(days)),
    trainingActions: await queryRows(db, trainingActionsSql(days)),
    totals: await queryRows(db, totalsSql(days)),
  };

  return json({
    ok: true,
    days,
    generated_at: new Date().toISOString(),
    data,
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

async function queryRows(db: D1Database, sql: string): Promise<unknown[]> {
  const result = await db.prepare(sql).all();
  return Array.isArray(result.results) ? result.results : [];
}

function normalizeDays(value: string | null): number {
  const parsed = Number.parseInt(value || "30", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 366) return 30;
  return parsed;
}

function sinceExpression(days: number): string {
  return `datetime('now', '-${days} days')`;
}

function topClicksSql(days: number): string {
  return `
    SELECT
      COALESCE(content_type, 'unknown') AS content_type,
      COALESCE(content_id, '') AS content_id,
      COALESCE(content_title, '') AS content_title,
      COUNT(*) AS clicks,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE event_name = 'content_click'
      AND created_at >= ${sinceExpression(days)}
    GROUP BY content_type, content_id, content_title
    ORDER BY clicks DESC, visitors DESC
    LIMIT 20
  `;
}

function videoStatsSql(days: number): string {
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
      AND created_at >= ${sinceExpression(days)}
    GROUP BY content_id, content_title
    ORDER BY plays DESC, p75 DESC, completes DESC
    LIMIT 30
  `;
}

function trainingActionsSql(days: number): string {
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
      AND created_at >= ${sinceExpression(days)}
    GROUP BY event_name, content_id, content_title
    ORDER BY events DESC
    LIMIT 30
  `;
}

function totalsSql(days: number): string {
  return `
    SELECT
      event_name,
      COUNT(*) AS events,
      COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
    FROM analytics_events
    WHERE created_at >= ${sinceExpression(days)}
    GROUP BY event_name
    ORDER BY events DESC
  `;
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
