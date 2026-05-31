const { stripe } = require("./stripeClient");
const { sendGiovannaMentorshipPurchaseEmail } = require("./email");

const GIOVANNA_MENTORSHIP_SESSION_TYPE = "mentorship_giovanna";
const CONFIRMATION_EMAIL_SENT_KEY = "giovanna_purchase_email_sent_at";

function getBuyerEmail(session) {
  return session.customer_details?.email || session.customer_email || session.metadata?.buyer_email || "";
}

function getBuyerName(session) {
  return session.customer_details?.name || session.metadata?.buyer_name || "Cliente";
}

function isGiovannaMentorshipSession(session) {
  return session?.metadata?.type === GIOVANNA_MENTORSHIP_SESSION_TYPE;
}

function isPaidSession(session) {
  return session?.payment_status === "paid" || session?.status === "complete";
}

async function markConfirmationEmailSent(session, sentAt) {
  if (!stripe || !session?.id) return;

  try {
    await stripe.checkout.sessions.update(session.id, {
      metadata: {
        ...(session.metadata || {}),
        [CONFIRMATION_EMAIL_SENT_KEY]: sentAt,
      },
    });
  } catch (error) {
    console.error("Giovanna mentorship confirmation metadata update failed", {
      sessionId: session.id,
      reason: error.message,
    });
  }
}

async function sendGiovannaMentorshipConfirmationForSession(session) {
  if (!isGiovannaMentorshipSession(session)) {
    return { ok: false, reason: "invalid_session_type" };
  }

  if (!isPaidSession(session)) {
    return { ok: false, reason: "session_not_paid" };
  }

  if (session.metadata?.[CONFIRMATION_EMAIL_SENT_KEY]) {
    return { ok: true, alreadySent: true };
  }

  const buyerEmail = getBuyerEmail(session);
  const buyerName = getBuyerName(session);

  if (!buyerEmail) {
    return { ok: false, reason: "missing_email" };
  }

  const emailResult = await sendGiovannaMentorshipPurchaseEmail({
    to: buyerEmail,
    buyerName,
  });

  if (!emailResult.ok) {
    return { ok: false, reason: emailResult.reason || "email_failed" };
  }

  await markConfirmationEmailSent(session, new Date().toISOString());

  return { ok: true, alreadySent: false };
}

async function sendGiovannaMentorshipConfirmationForSessionId(sessionId) {
  if (!stripe) {
    return { ok: false, reason: "checkout_not_configured" };
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return sendGiovannaMentorshipConfirmationForSession(session);
}

module.exports = {
  sendGiovannaMentorshipConfirmationForSession,
  sendGiovannaMentorshipConfirmationForSessionId,
};
