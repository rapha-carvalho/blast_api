CREATE TABLE IF NOT EXISTS report_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_at TEXT NOT NULL,
  client_ip_hash TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_requests_requested_at
  ON report_requests (requested_at);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anonymous_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentorship_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_email TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  calendar_event_id TEXT,
  meet_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mentorship_bookings_slot
  ON mentorship_bookings (slot_start);

CREATE INDEX IF NOT EXISTS idx_mentorship_bookings_email
  ON mentorship_bookings (buyer_email);

CREATE INDEX IF NOT EXISTS idx_mentorship_bookings_status
  ON mentorship_bookings (status);
