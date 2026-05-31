const express = require("express");
const { stripe, STRIPE_WEBHOOK_SECRET, PRICE_ID_MONTHLY, PRICE_ID_YEARLY, PRICE_ID_ONETIME } = require("../lib/stripeClient");
const { getSupabase } = require("../lib/supabase");
const { generateLicenseKey } = require("../lib/licenseKey");
const {
  sendLicenseEmail,
  sendMentorshipConfirmationEmail,
} = require("../lib/email");
const { createMentorshipEvent } = require("../lib/calendar");
const { createBooking } = require("../lib/mentorshipDb");
const { sendGiovannaMentorshipConfirmationForSession } = require("../lib/giovannaMentorshipConfirmation");

const router = express.Router();
const SITE_URL = process.env.SITE_URL || "https://blastgroup.org";

async function handleMentorshipBooking(session) {
  const buyerEmail = session.customer_details?.email || session.customer_email;
  const buyerName = session.metadata?.buyer_name || session.customer_details?.name || "Cliente";
  const slotStart = session.metadata?.slot_start;
  const slotEnd = session.metadata?.slot_end;

  if (!buyerEmail || !slotStart || !slotEnd) {
    console.error("Mentorship webhook: missing email or slot data", { buyerEmail, slotStart, slotEnd });
    return;
  }

  let meetLink = null;
  let calendarEventId = null;

  try {
    const calEvent = await createMentorshipEvent({ slotStart, slotEnd, buyerEmail, buyerName });
    meetLink = calEvent.hangoutLink || null;
    calendarEventId = calEvent.id || null;
  } catch (e) {
    console.error("Mentorship: calendar event creation failed:", e.message);
  }

  try {
    createBooking({
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      slot_start: slotStart,
      slot_end: slotEnd,
      stripe_session_id: session.id,
      stripe_customer_id: session.customer || null,
      calendar_event_id: calendarEventId,
      meet_link: meetLink,
    });
  } catch (e) {
    if (e.message && e.message.includes("UNIQUE")) {
      console.warn("Mentorship: duplicate booking ignored for session", session.id);
    } else {
      console.error("Mentorship: DB save failed:", e.message);
    }
  }

  await sendMentorshipConfirmationEmail({ to: buyerEmail, buyerName, slotStart, slotEnd, meetLink });
}

async function handleGiovannaMentorshipPurchase(session) {
  const result = await sendGiovannaMentorshipConfirmationForSession(session);

  if (!result.ok) {
    console.error("Giovanna mentorship confirmation email failed", {
      sessionId: session.id,
      reason: result.reason,
    });
  }
}

// Webhook — raw body is applied in index.js before this route
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!STRIPE_WEBHOOK_SECRET || !sig) {
    return res.status(400).send("Missing webhook secret or signature");
  }

  let event;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature failed:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    const supabase = getSupabase();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.metadata?.type === "mentorship") {
          await handleMentorshipBooking(session);
          break;
        }

        if (session.metadata?.type === "mentorship_giovanna") {
          await handleGiovannaMentorshipPurchase(session);
          break;
        }

        const customerId = session.customer;
        const email = session.customer_email || session.customer_details?.email;
        const subId = session.subscription;
        const isOneTime = session.mode === "payment" || !subId;

        if (!supabase) break;

        if (isOneTime) {
          const licenseKey = generateLicenseKey();
          const { error } = await supabase.from("licenses").insert({
            license_key: licenseKey,
            email: email || null,
            plan: "pro",
            status: "active",
            stripe_customer_id: customerId || null,
            stripe_subscription_id: null,
            current_period_end: null,
          });
          if (!error && email) await sendLicenseEmail(email, licenseKey, "Pro");
          break;
        }

        const sub = await stripe.subscriptions.retrieve(subId);
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { data: existing } = await supabase
          .from("licenses")
          .select("id, license_key")
          .eq("stripe_subscription_id", subId)
          .single();

        if (existing) {
          await supabase
            .from("licenses")
            .update({ status: "active", current_period_end: periodEnd, email: email || undefined, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        } else {
          const licenseKey = generateLicenseKey();
          const { error } = await supabase.from("licenses").insert({
            license_key: licenseKey,
            email: email || null,
            plan: "pro",
            status: "active",
            stripe_customer_id: customerId,
            stripe_subscription_id: subId,
            current_period_end: periodEnd,
          });
          if (!error && email) await sendLicenseEmail(email, licenseKey, "Pro");
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const status = sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
        if (getSupabase()) {
          await getSupabase()
            .from("licenses")
            .update({ current_period_end: periodEnd, status, updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", sub.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        if (getSupabase()) {
          await getSupabase()
            .from("licenses")
            .update({ status: "canceled", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", sub.id);
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).send("Webhook handler failed");
  }

  return res.sendStatus(200);
});

router.get("/checkout-url", getCheckoutUrl);
router.post("/checkout-url", getCheckoutUrl);

async function getCheckoutUrl(req, res) {
  const plan = req.query.plan || req.body?.plan;
  if (!plan || !stripe) return res.status(400).json({ error: "plan required" });

  const isOneTime = plan === "pro_onetime";
  const priceId = isOneTime
    ? PRICE_ID_ONETIME
    : plan === "pro_yearly"
    ? PRICE_ID_YEARLY
    : PRICE_ID_MONTHLY;

  if (!priceId) return res.status(500).json({ error: "Checkout not configured for this plan" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: isOneTime ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/products/ga4-inspector/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/products/ga4-inspector`,
      allow_promotion_codes: true,
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error("Checkout session error:", e);
    return res.status(500).json({ error: e.message });
  }
}

router.post("/portal", async (req, res) => {
  const { license_key: licenseKey } = req.body || {};
  const supabase = getSupabase();
  if (!licenseKey || !stripe || !supabase) {
    return res.status(400).json({ error: "license_key required" });
  }

  const { data: license } = await supabase
    .from("licenses")
    .select("stripe_customer_id")
    .eq("license_key", licenseKey.trim())
    .single();

  if (!license?.stripe_customer_id) {
    return res.status(404).json({ error: "License not found" });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripe_customer_id,
      return_url: `${SITE_URL}/products/ga4-inspector`,
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error("Portal session error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
