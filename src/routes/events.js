const express = require("express");
const { getSupabase } = require("../lib/supabase");

const router = express.Router();
const ALLOWED_EVENTS = ["install", "activation", "limit_hit", "conversion", "session_start", "feature_used"];

router.post("/", async (req, res) => {
  const { event, plan, install_id: installId } = req.body || {};
  if (!event || typeof event !== "string") return res.status(400).json({ error: "event required" });
  if (!ALLOWED_EVENTS.includes(event)) return res.status(400).json({ error: "Invalid event type" });

  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "Service unavailable" });

  const { error } = await supabase
    .from("product_events")
    .insert({ event, plan: plan || null, install_id: installId || null });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
