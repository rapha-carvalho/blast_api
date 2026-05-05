const express = require("express");
const { getSupabase } = require("../lib/supabase");

const router = express.Router();
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

function requireAdmin(req, res) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  if (!ADMIN_API_KEY || token !== ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/licenses", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "Database unavailable" });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  const { data: rows, error } = await supabase
    .from("licenses")
    .select("id, license_key, email, plan, status, current_period_end, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  const masked = (rows || []).map((r) => ({
    ...r,
    license_key: r.license_key
      ? `${r.license_key.slice(0, 4)}****-****-****-${r.license_key.slice(-4)}`
      : null,
  }));

  return res.json({ licenses: masked });
});

router.get("/licenses/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "Database unavailable" });

  const { data: license, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !license) return res.status(404).json({ error: "License not found" });

  const { data: activations } = await supabase
    .from("activations")
    .select("id, install_id, last_seen_at, created_at")
    .eq("license_id", req.params.id)
    .order("last_seen_at", { ascending: false });

  return res.json({ ...license, activations: activations || [] });
});

router.post("/licenses/:id/revoke", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "Database unavailable" });

  const { error } = await supabase
    .from("licenses")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

module.exports = router;
