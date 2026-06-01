const express = require("express");
const { Webhook } = require("svix");
const config = require("../config");
const checkContentLength = require("../middleware/checkContentLength");
const createRateLimiter = require("../middleware/rateLimit");
const {
  normalizeNewsletterSubscription,
  subscribeToSqlNewsletter,
  validateNewsletterSubscription,
} = require("../lib/newsletterService");
const { appendNewsletterEmailEvent } = require("../lib/newsletterSheets");
const { normalizeResendWebhookEvent } = require("../lib/newsletterStats");

const router = express.Router();
const rateLimiter = createRateLimiter({
  maxRequests: config.rateLimitMax,
  windowMs: config.rateLimitWindowMs,
});

function shouldRequireName(subscription) {
  return ["landing", "cheatsheet_landing"].includes(subscription.source);
}

function shouldRequireLevel(subscription) {
  return ["landing", "cheatsheet_landing"].includes(subscription.source);
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  if (typeof req.body === "string") {
    return req.body;
  }
  return JSON.stringify(req.body || {});
}

function verifyResendWebhook(req) {
  const webhookSecret = config.resendWebhookSecret;
  if (!webhookSecret) {
    const error = new Error("missing_resend_webhook_secret");
    error.statusCode = 500;
    throw error;
  }

  const headers = {
    "svix-id": req.get("svix-id"),
    "svix-timestamp": req.get("svix-timestamp"),
    "svix-signature": req.get("svix-signature"),
  };

  if (!headers["svix-id"] || !headers["svix-timestamp"] || !headers["svix-signature"]) {
    const error = new Error("missing_svix_headers");
    error.statusCode = 400;
    throw error;
  }

  const webhook = new Webhook(webhookSecret);
  return webhook.verify(getRawBody(req), headers);
}

router.post(
  "/subscribe",
  checkContentLength(config.maxBodyBytes, config.maxBodyMb),
  rateLimiter,
  async (req, res, next) => {
    try {
      const subscription = normalizeNewsletterSubscription(req.body || {}, req, {
        source: "site",
        sourceDetail: "newsletter",
      });

      if (subscription.website) {
        return res.status(200).json({ ok: true });
      }

      const errors = validateNewsletterSubscription(subscription, {
        requireName: shouldRequireName(subscription),
        requireLevel: shouldRequireLevel(subscription),
      });

      if (errors.length > 0) {
        return res.status(400).json({ error: "validation_failed", fields: errors });
      }

      const result = await subscribeToSqlNewsletter(subscription);
      if (!result.ok) {
        return res.status(503).json({ error: "newsletter_subscribe_failed", reason: result.reason });
      }

      return res.status(200).json({
        ok: true,
        subscriber_status: result.subscriberStatus,
        journey_started: result.journeyStarted,
        resend_status: result.resendStatus,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/resend-webhook", async (req, res) => {
  let event;
  try {
    event = verifyResendWebhook(req);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ error: "invalid_resend_webhook" });
  }

  const normalizedEvent = normalizeResendWebhookEvent(event, {
    webhookId: req.get("svix-id"),
    receivedAt: new Date().toISOString(),
  });

  const sheetResult = await appendNewsletterEmailEvent(normalizedEvent);
  if (!sheetResult.ok) {
    return res.status(503).json({ error: "newsletter_email_event_append_failed" });
  }

  return res.status(200).json({
    ok: true,
    duplicate: sheetResult.duplicate === true,
  });
});

module.exports = router;
module.exports._test = {
  getRawBody,
  verifyResendWebhook,
};
