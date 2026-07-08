CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_name TEXT NOT NULL,
  page_path TEXT NOT NULL,
  content_type TEXT,
  content_id TEXT,
  content_title TEXT,
  destination_url TEXT,
  video_current_time INTEGER,
  video_duration INTEGER,
  video_progress INTEGER,
  visitor_id TEXT,
  session_id TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON analytics_events(created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created_at
  ON analytics_events(event_name, created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_content
  ON analytics_events(content_type, content_id, created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_video
  ON analytics_events(content_id, video_progress, created_at);
