/**
 * Mentorship booking endpoints.
 * All routes require a valid MENTORSHIP_API_TOKEN Bearer token.
 *
 * POST   /api/v1/mentorship/bookings         → create booking
 * GET    /api/v1/mentorship/bookings         → list bookings (admin)
 * GET    /api/v1/mentorship/bookings/:id     → get single booking
 * PATCH  /api/v1/mentorship/bookings/:id     → update status
 */
const express = require("express");
const requireMentorshipToken = require("../middleware/requireMentorshipToken");
const {
  createBooking,
  getBookingById,
  listBookings,
  updateBookingStatus,
} = require("../lib/mentorshipDb");

const router = express.Router();

router.use(requireMentorshipToken);

// POST /api/v1/mentorship/bookings
router.post("/", (req, res) => {
  const {
    buyer_email,
    buyer_name,
    slot_start,
    slot_end,
    status,
    stripe_session_id,
    stripe_customer_id,
    calendar_event_id,
    meet_link,
  } = req.body || {};

  if (!buyer_email || !buyer_name || !slot_start || !slot_end) {
    return res.status(400).json({ error: "buyer_email, buyer_name, slot_start, slot_end are required" });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) {
    return res.status(400).json({ error: "Invalid buyer_email" });
  }

  // Validate slot times are valid ISO dates
  if (isNaN(Date.parse(slot_start)) || isNaN(Date.parse(slot_end))) {
    return res.status(400).json({ error: "slot_start and slot_end must be valid ISO 8601 timestamps" });
  }

  try {
    const booking = createBooking({
      buyer_email: String(buyer_email).trim().toLowerCase(),
      buyer_name: String(buyer_name).trim(),
      slot_start,
      slot_end,
      status: status || "confirmed",
      stripe_session_id: stripe_session_id || null,
      stripe_customer_id: stripe_customer_id || null,
      calendar_event_id: calendar_event_id || null,
      meet_link: meet_link || null,
    });
    return res.status(201).json({ booking });
  } catch (err) {
    // UNIQUE constraint on stripe_session_id = duplicate webhook
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "Booking already exists for this Stripe session" });
    }
    console.error("mentorship create_booking error:", err.message);
    return res.status(500).json({ error: "Failed to create booking" });
  }
});

// GET /api/v1/mentorship/bookings
router.get("/", (req, res) => {
  const { status, limit, offset } = req.query;
  const opts = {
    status: status || null,
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    offset: parseInt(offset, 10) || 0,
  };

  try {
    const bookings = listBookings(opts);
    return res.json({ bookings, count: bookings.length });
  } catch (err) {
    console.error("mentorship list_bookings error:", err.message);
    return res.status(500).json({ error: "Failed to list bookings" });
  }
});

// GET /api/v1/mentorship/bookings/:id
router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const booking = getBookingById(id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    return res.json({ booking });
  } catch (err) {
    console.error("mentorship get_booking error:", err.message);
    return res.status(500).json({ error: "Failed to get booking" });
  }
});

// PATCH /api/v1/mentorship/bookings/:id
router.patch("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  try {
    const booking = updateBookingStatus(id, status);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    return res.json({ booking });
  } catch (err) {
    if (err.message && err.message.startsWith("Invalid status")) {
      return res.status(400).json({ error: err.message });
    }
    console.error("mentorship update_booking error:", err.message);
    return res.status(500).json({ error: "Failed to update booking" });
  }
});

module.exports = router;
