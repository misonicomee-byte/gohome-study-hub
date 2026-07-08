interface AnalyticsEnv {
  ANALYTICS_DB?: D1Database;
}

type AnalyticsEventName =
  | "content_click"
  | "video_play"
  | "video_pause"
  | "video_progress"
  | "video_complete"
  | "quiz_grade"
  | "module_complete"
  | "certificate_create";

interface AnalyticsPayload {
  event_name?: unknown;
  page_path?: unknown;
  content_type?: unknown;
  content_id?: unknown;
  content_title?: unknown;
  destination_url?: unknown;
  video_current_time?: unknown;
  video_duration?: unknown;
  video_progress?: unknown;
  visitor_id?: unknown;
  session_id?: unknown;
}

const ALLOWED_EVENTS = new Set<AnalyticsEventName>([
  "content_click",
  "video_play",
  "video_pause",
  "video_progress",
  "video_complete",
  "quiz_grade",
  "module_complete",
  "certificate_create",
]);

export async function onRequestPost(context: {
  request: Request;
  env: AnalyticsEnv;
}): Promise<Response> {
  const db = context.env.ANALYTICS_DB;
  if (!db) {
    return json({ ok: false, error: "analytics_db_not_configured" }, 503);
  }

  let payload: AnalyticsPayload;
  try {
    payload = await readJsonPayload(context.request);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const eventName = sanitizeEventName(payload.event_name);
  if (!eventName) {
    return json({ ok: false, error: "invalid_event_name" }, 400);
  }

  const requestUrl = new URL(context.request.url);
  const row = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    eventName,
    pagePath: sanitizeText(payload.page_path, 300) || requestUrl.pathname,
    contentType: sanitizeText(payload.content_type, 80),
    contentId: sanitizeText(payload.content_id, 220),
    contentTitle: sanitizeText(payload.content_title, 220),
    destinationUrl: sanitizeText(payload.destination_url, 500),
    videoCurrentTime: sanitizeInteger(payload.video_current_time, 0, 24 * 60 * 60),
    videoDuration: sanitizeInteger(payload.video_duration, 0, 24 * 60 * 60),
    videoProgress: sanitizeInteger(payload.video_progress, 0, 100),
    visitorId: sanitizeText(payload.visitor_id, 80),
    sessionId: sanitizeText(payload.session_id, 80),
    country: sanitizeText((context.request as Request & { cf?: { country?: string } }).cf?.country, 8),
  };

  await db
    .prepare(
      `INSERT INTO analytics_events (
        id,
        created_at,
        event_name,
        page_path,
        content_type,
        content_id,
        content_title,
        destination_url,
        video_current_time,
        video_duration,
        video_progress,
        visitor_id,
        session_id,
        country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.createdAt,
      row.eventName,
      row.pagePath,
      row.contentType,
      row.contentId,
      row.contentTitle,
      row.destinationUrl,
      row.videoCurrentTime,
      row.videoDuration,
      row.videoProgress,
      row.visitorId,
      row.sessionId,
      row.country
    )
    .run();

  return json({ ok: true }, 200);
}

export function onRequestOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}

export function onRequestGet(): Response {
  return json({ ok: false, error: "method_not_allowed" }, 405, {
    Allow: "POST, OPTIONS",
  });
}

async function readJsonPayload(request: Request): Promise<AnalyticsPayload> {
  const text = await request.text();
  if (!text || text.length > 8192) throw new Error("invalid_payload_size");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_payload");
  }
  return parsed as AnalyticsPayload;
}

function sanitizeEventName(value: unknown): AnalyticsEventName | null {
  if (typeof value !== "string") return null;
  return ALLOWED_EVENTS.has(value as AnalyticsEventName) ? (value as AnalyticsEventName) : null;
}

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function sanitizeInteger(value: unknown, min: number, max: number): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const rounded = Math.round(numberValue);
  if (rounded < min || rounded > max) return null;
  return rounded;
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
