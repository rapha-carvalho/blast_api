const express = require("express");
const { stripe, PRICE_ID_MENTORSHIP } = require("../lib/stripeClient");
const { getAvailableSlots } = require("../lib/calendar");

const router = express.Router();
const SITE_URL = process.env.SITE_URL || "https://blastgroup.org";

router.get("/availability", async (req, res) => {
  try {
    const slots = await getAvailableSlots(30);
    return res.json({ slots });
  } catch (e) {
    console.error("Availability error:", e);
    return res.status(500).json({ error: "Failed to fetch availability" });
  }
});

router.post("/checkout", async (req, res) => {
  const { slot_start, slot_end, buyer_name } = req.body || {};

  if (!slot_start || !slot_end || !buyer_name?.trim()) {
    return res.status(400).json({ error: "slot_start, slot_end and buyer_name are required" });
  }
  if (!PRICE_ID_MENTORSHIP || !stripe) {
    return res.status(500).json({ error: "Mentorship checkout not configured. Set STRIPE_PRICE_ID_MENTORSHIP." });
  }
  if (new Date(slot_start) <= new Date()) {
    return res.status(400).json({ error: "Slot is in the past" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: PRICE_ID_MENTORSHIP, quantity: 1 }],
      success_url: `${SITE_URL}/mentoria/obrigado?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/mentoria`,
      allow_promotion_codes: true,
      metadata: {
        type: "mentorship",
        slot_start,
        slot_end,
        buyer_name: buyer_name.trim(),
      },
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error("Mentorship checkout error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
