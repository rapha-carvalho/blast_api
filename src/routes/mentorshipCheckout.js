const express = require("express");
const {
  stripe,
  STRIPE_PUBLISHABLE_KEY,
  PRICE_ID_MENTORSHIP,
  PRICE_ID_MENTORSHIP_GIOVANNA_1X,
  PRICE_ID_MENTORSHIP_GIOVANNA_2X,
  PRICE_ID_MENTORSHIP_GIOVANNA_3X,
  PRICE_ID_MENTORSHIP_GIOVANNA_4X,
  PRICE_ID_MENTORSHIP_GIOVANNA_5X,
  PRICE_ID_MENTORSHIP_GIOVANNA_6X,
} = require("../lib/stripeClient");
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
const GIOVANNA_PRICE_IDS = {
  1: PRICE_ID_MENTORSHIP_GIOVANNA_1X,
  2: PRICE_ID_MENTORSHIP_GIOVANNA_2X,
  3: PRICE_ID_MENTORSHIP_GIOVANNA_3X,
  4: PRICE_ID_MENTORSHIP_GIOVANNA_4X,
  5: PRICE_ID_MENTORSHIP_GIOVANNA_5X,
  6: PRICE_ID_MENTORSHIP_GIOVANNA_6X,
};

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

function normalizeInstallments(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 1;
}

function getGiovannaPriceId(installments) {
  return GIOVANNA_PRICE_IDS[installments] || null;
}

async function buildGiovannaInstallmentOptions() {
  const configuredOptions = Object.entries(GIOVANNA_PRICE_IDS)
    .map(([installments, priceId]) => ({
      installments: Number(installments),
      priceId,
    }))
    .filter((option) => Boolean(option.priceId));

  if (!stripe) {
    return configuredOptions.map((option) => ({
      installments: option.installments,
      amount: null,
      currency: "brl",
      label: `${option.installments}x`,
    }));
  }

  const options = await Promise.all(
    configuredOptions.map(async (option) => {
      try {
        const price = await stripe.prices.retrieve(option.priceId, { expand: ["product"] });
        const productName =
          price.product && typeof price.product === "object" ? price.product.name : "Mentoria Transição para Dados";

        return {
          installments: option.installments,
          amount: price.unit_amount,
          currency: price.currency,
          label: price.nickname || `${option.installments}x`,
          productName,
        };
      } catch (error) {
        console.error("Giovanna price retrieve failed:", option.installments, error.message);
        return {
          installments: option.installments,
          amount: null,
          currency: "brl",
          label: `${option.installments}x`,
        };
      }
    })
  );

  return options.sort((a, b) => a.installments - b.installments);
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

router.get("/giovanna/checkout-config", async (req, res) => {
  try {
    const installmentOptions = await buildGiovannaInstallmentOptions();
    return res.json({
      publishableKey: STRIPE_PUBLISHABLE_KEY || null,
      installmentOptions,
    });
  } catch (error) {
    console.error("Giovanna checkout config error:", error.message);
    return res.status(500).json({ error: "checkout_config_failed" });
  }
});

router.post("/giovanna/checkout-session", async (req, res) => {
  const body = req.body || {};
  const installments = normalizeInstallments(body.installments);
  const priceId = getGiovannaPriceId(installments);
  const customerEmail = trimField(body.customer_email || body.email, 254).toLowerCase();
  const customerName = trimField(body.customer_name || body.name, 120);
  const customerPhone = trimField(body.customer_phone || body.whatsapp || body.phone, 40);

  if (!stripe || !priceId) {
    return res.status(500).json({ error: "checkout_not_configured" });
  }

  try {
    const metadata = {
      type: "mentorship_giovanna",
      product: "mentoria_transicao_para_dados_giovanna",
      installments: String(installments),
    };
    if (customerName) metadata.buyer_name = customerName.slice(0, 500);
    if (customerEmail && EMAIL_RE.test(customerEmail)) metadata.buyer_email = customerEmail;
    if (customerPhone) metadata.buyer_whatsapp = customerPhone.slice(0, 500);

    const sessionParams = {
      mode: "payment",
      ui_mode: "embedded",
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          installments: { enabled: true },
        },
      },
      line_items: [{ price: priceId, quantity: 1 }],
      return_url: `${SITE_URL}/mentoria-transicao-para-dados/checkout/obrigado?session_id={CHECKOUT_SESSION_ID}`,
      metadata,
      payment_intent_data: { metadata },
    };

    if (customerEmail && EMAIL_RE.test(customerEmail)) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Giovanna checkout session error:", error);
    return res.status(500).json({ error: "checkout_session_failed" });
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
