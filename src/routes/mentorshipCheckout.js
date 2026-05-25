const express = require("express");
const { stripe, PRICE_ID_MENTORSHIP } = require("../lib/stripeClient");
const { getAvailableSlots } = require("../lib/calendar");
const {
  sendMentorshipWaitlistConfirmationEmail,
  sendMentorshipWaitlistNotificationEmail,
} = require("../lib/email");
const { appendWaitlistSubmission } = require("../lib/sheets");

const router = express.Router();
const SITE_URL = process.env.SITE_URL || "https://blastgroup.org";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT_LENGTH = 2000;

function getClientIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    ""
  );
}

function trimField(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeTools(value) {
  const rawTools = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const tools = [];

  for (const item of rawTools) {
    const tool = trimField(item, 80);
    if (!tool || seen.has(tool)) continue;
    seen.add(tool);
    tools.push(tool);
  }

  return tools;
}

function normalizeWaitlistSubmission(body, req) {
  return {
    name: trimField(body.nome || body.name, 120),
    email: trimField(body.email, 254).toLowerCase(),
    whatsapp: trimField(body.whatsapp || body.phone, 40),
    currentArea: trimField(body.area_atual || body.currentArea, 120),
    biggestChallenge: trimField(body.maior_dificuldade || body.biggestChallenge, MAX_TEXT_LENGTH),
    tools: normalizeTools(body.ferramentas || body.tools),
    consent: body.consentimento_lgpd === true || body.consent === true,
    website: trimField(body.website, 255),
    pageUrl: trimField(body.pageUrl || body.page_url, 500),
    submittedAt: new Date().toISOString(),
    userAgent: trimField(req.get("user-agent"), 500),
    ip: trimField(getClientIp(req), 120),
  };
}

function validateWaitlistSubmission(submission) {
  const errors = [];

  if (submission.name.length < 2) errors.push("nome");
  if (!EMAIL_RE.test(submission.email)) errors.push("email");
  if (submission.whatsapp.length < 8) errors.push("whatsapp");
  if (submission.currentArea.length < 2) errors.push("area_atual");
  if (submission.biggestChallenge.length < 3) errors.push("maior_dificuldade");
  if (!submission.consent) errors.push("consentimento_lgpd");

  return errors;
}

router.get("/availability", async (req, res) => {
  try {
    const slots = await getAvailableSlots(30);
    return res.json({ slots });
  } catch (e) {
    console.error("Availability error:", e);
    return res.status(500).json({ error: "Failed to fetch availability" });
  }
});

router.post("/waitlist", async (req, res) => {
  const body = req.body || {};
  const submission = normalizeWaitlistSubmission(body, req);

  if (submission.website) {
    return res.status(200).json({ ok: true });
  }

  const errors = validateWaitlistSubmission(submission);
  if (errors.length > 0) {
    return res.status(400).json({ error: "validation_failed", fields: errors });
  }

  const [sheetResult, confirmationResult, notificationResult] = await Promise.all([
    appendWaitlistSubmission(submission),
    sendMentorshipWaitlistConfirmationEmail(submission),
    sendMentorshipWaitlistNotificationEmail(submission),
  ]);

  if (!confirmationResult.ok || !notificationResult.ok) {
    console.error("Waitlist email failed", {
      confirmation: confirmationResult,
      notification: notificationResult,
    });
    return res.status(503).json({ error: "email_failed" });
  }

  if (!sheetResult.ok) {
    console.warn("Waitlist sheet append failed", { reason: sheetResult.reason });
  }

  return res.status(200).json({
    ok: true,
    sheets: sheetResult.ok ? "ok" : "failed",
  });
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
