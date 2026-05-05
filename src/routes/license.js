const express = require("express");
const { getSupabase } = require("../lib/supabase");
const { stripe } = require("../lib/stripeClient");
const { sendLicenseEmail } = require("../lib/email");
const { generateLicenseKey } = require("../lib/licenseKey");

const router = express.Router();

router.post("/validate", postValidate);
router.post("/activate", postValidate);

async function postValidate(req, res) {
  const { license_key: licenseKey, install_id: installId } = req.body || {};
  if (!licenseKey || typeof licenseKey !== "string" || !licenseKey.trim()) {
    return res.status(400).json({ valid: false, plan: "free" });
  }
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ valid: false, plan: "free" });

  const key = licenseKey.trim();
  const { data: row, error } = await supabase
    .from("licenses")
    .select("id, plan, status, current_period_end")
    .eq("license_key", key)
    .single();

  if (error || !row) return res.json({ valid: false, plan: "free" });

  const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;
  const expired = periodEnd && periodEnd.getTime() < Date.now();
  const valid = row.status === "active" && !expired;
  const plan = valid ? (row.plan === "team" ? "team" : "pro") : "free";

  if (valid && installId) {
    await supabase
      .from("activations")
      .upsert({ license_id: row.id, install_id: installId, last_seen_at: new Date().toISOString() }, { onConflict: ["license_id", "install_id"] })
      .select();
  }

  return res.json({ valid, plan, expires_at: row.current_period_end || null });
}

router.post("/resend", async (req, res) => {
  const email = req.body?.email ? String(req.body.email).trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email required" });
  }
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ error: "Service unavailable" });

  const { data: license } = await supabase
    .from("licenses")
    .select("license_key, plan")
    .eq("email", email)
    .in("status", ["active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!license) return res.status(404).json({ error: "No active license found for this email" });

  const result = await sendLicenseEmail(email, license.license_key, license.plan || "Pro");
  if (!result.ok) return res.status(500).json({ error: "Failed to send email" });
  return res.json({ ok: true });
});

router.get("/by-session", async (req, res) => {
  const sessionId = req.query.session_id;
  const supabase = getSupabase();
  if (!sessionId || !stripe) return res.status(400).json({ error: "session_id required" });
  if (!supabase) return res.status(503).json({ error: "Service unavailable" });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (!session) return res.status(404).json({ error: "Invalid session" });

    const email = session.customer_email || session.customer_details?.email;
    const customerId = session.customer;

    if (session.mode === "payment") {
      let q = supabase
        .from("licenses")
        .select("license_key, email")
        .is("stripe_subscription_id", null)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      q = customerId ? q.eq("stripe_customer_id", customerId) : q.eq("email", email);
      const { data: license } = await q.single();
      if (license) return res.json({ license_key: license.license_key, email: license.email });
      return res.status(404).json({ error: "License not found yet. Try refreshing in a moment." });
    }

    if (session.mode !== "subscription" || !session.subscription) {
      return res.status(404).json({ error: "Invalid session" });
    }

    const sub = session.subscription;
    const subId = typeof sub === "string" ? sub : sub.id;
    const periodEnd = typeof sub === "object" && sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

    let { data: license } = await supabase
      .from("licenses")
      .select("license_key, email")
      .eq("stripe_subscription_id", subId)
      .single();

    if (!license) {
      const licenseKey = generateLicenseKey();
      const { data: inserted, error } = await supabase
        .from("licenses")
        .insert({ license_key: licenseKey, email: email || null, plan: "pro", status: "active", stripe_customer_id: customerId, stripe_subscription_id: subId, current_period_end: periodEnd })
        .select("license_key, email")
        .single();
      if (error) return res.status(500).json({ error: "Failed to create license" });
      license = inserted;
    }

    return res.json({ license_key: license.license_key, email: license.email });
  } catch (e) {
    console.error("by-session error:", e);
    return res.status(500).json({ error: e.message || "Invalid session" });
  }
});

module.exports = router;
