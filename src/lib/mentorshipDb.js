/**
 * Mentorship bookings — SQLite persistence layer.
 * Uses getDb() which always opens a connection regardless of ENABLE_DB.
 */
const { getDb } = require("./db");

function now() {
  return new Date().toISOString();
}

/**
 * Insert a new booking. Returns the created row.
 * Throws if stripe_session_id already exists (UNIQUE constraint).
 */
function createBooking({
  buyer_email,
  buyer_name,
  slot_start,
  slot_end,
  status = "confirmed",
  stripe_session_id = null,
  stripe_customer_id = null,
  calendar_event_id = null,
  meet_link = null,
}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO mentorship_bookings
      (buyer_email, buyer_name, slot_start, slot_end, status,
       stripe_session_id, stripe_customer_id, calendar_event_id, meet_link,
       created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ts = now();
  const result = stmt.run(
    buyer_email,
    buyer_name,
    slot_start,
    slot_end,
    status,
    stripe_session_id,
    stripe_customer_id,
    calendar_event_id,
    meet_link,
    ts,
    ts
  );

  return getBookingById(result.lastInsertRowid);
}

/** Returns a single booking by id, or null. */
function getBookingById(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM mentorship_bookings WHERE id = ?").get(id) || null;
}

/** Returns a single booking by Stripe session id, or null. */
function getBookingBySession(stripeSessionId) {
  const db = getDb();
  return (
    db
      .prepare("SELECT * FROM mentorship_bookings WHERE stripe_session_id = ?")
      .get(stripeSessionId) || null
  );
}

/**
 * List bookings with optional filters.
 * @param {{ status?: string, limit?: number, offset?: number }} opts
 */
function listBookings({ status = null, limit = 100, offset = 0 } = {}) {
  const db = getDb();

  if (status) {
    return db
      .prepare(
        `SELECT * FROM mentorship_bookings
         WHERE status = ?
         ORDER BY slot_start ASC
         LIMIT ? OFFSET ?`
      )
      .all(status, limit, offset);
  }

  return db
    .prepare(
      `SELECT * FROM mentorship_bookings
       ORDER BY slot_start ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

/**
 * Update the status of a booking. Returns the updated row or null.
 */
function updateBookingStatus(id, status) {
  const db = getDb();
  const valid = ["confirmed", "completed", "canceled", "no_show"];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${valid.join(", ")}`);
  }

  db.prepare(
    "UPDATE mentorship_bookings SET status = ?, updated_at = ? WHERE id = ?"
  ).run(status, now(), id);

  return getBookingById(id);
}

module.exports = {
  createBooking,
  getBookingById,
  getBookingBySession,
  listBookings,
  updateBookingStatus,
};
