const express = require("express");
const config = require("../config");
const checkContentLength = require("../middleware/checkContentLength");
const createRateLimiter = require("../middleware/rateLimit");
const { getClientIp } = require("../lib/ip");
const { dispatchTrackingEvent } = require("../lib/trackingDispatch");
const { getTrackingResult, setTrackingResult } = require("../lib/trackingIdempotencyStore");

const router = express.Router();
const jsonParser = express.json({ limit: `${config.maxBodyMb}mb`, strict: true });
const rateLimiter = createRateLimiter({
  maxRequests: config.trackingRateLimitMax,
  windowMs: config.trackingRateLimitWindowMs,
});

const ALLOWED_EVENT_NAMES = new Set([
  "page_view",
  "view_content",
  "cta_click",
  "section_view",
  "sticky_cta_view",
  "sticky_cta_click",
  "exit_intent_impression",
  "exit_intent_dismiss",
  "exit_intent_cta_click",
]);

const ALLOWED_HOSTNAMES = new Set(["blastgroup.org", "www.blastgroup.org"]);
const COURSE_CHECKOUT_CTA_EVENT_NAMES = new Set([
  "cta_click",
  "sticky_cta_click",
  "exit_intent_cta_click",
]);

function cleanString(value, maxLength = 4000) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!text) return undefined;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isAllowedHostname(hostname) {
  return ALLOWED_HOSTNAMES.has(String(hostname || "").trim().toLowerCase());
}

function looksLikeCheckoutUrl(value) {
  const text = cleanString(value, 2000);
  if (!text) {
    return false;
  }

  try {
    const url = new URL(text, "https://blastgroup.org");
    return url.pathname.startsWith("/checkout/");
  } catch {
    return text.includes("/checkout/");
  }
}

function sanitizeMetadata(body) {
  const metadata = {
    page_path: cleanString(body.page_path, 1000),
    page_title: cleanString(body.page_title, 300),
    page_type: cleanString(body.page_type, 120),
    content_name: cleanString(body.content_name, 255),
    content_category: cleanString(body.content_category, 120),
    content_id: cleanString(body.content_id, 120),
    cta_text: cleanString(body.cta_text, 255),
    cta_section: cleanString(body.cta_section, 120),
    cta_destination: cleanString(body.cta_destination, 2000),
    section_name: cleanString(body.section_name, 120),
    trigger: cleanString(body.trigger, 120),
    reason: cleanString(body.reason, 120),
    coupon: cleanString(body.coupon, 120),
  };

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

function buildCommerce(eventName, body, metadata) {
  const isViewContentEvent = eventName === "view_content";
  const isCourseCheckoutCta =
    COURSE_CHECKOUT_CTA_EVENT_NAMES.has(eventName) &&
    metadata.page_type === "course_landing" &&
    metadata.content_category === "course" &&
    looksLikeCheckoutUrl(metadata.cta_destination);

  if (!isViewContentEvent && !isCourseCheckoutCta) {
    return undefined;
  }

  const value = toOptionalNumber(body.value);
  const valueCents = toOptionalNumber(body.value_cents);
  const currency = cleanString(body.currency, 12);
  const itemId = metadata.content_id;
  const itemName = metadata.content_name;
  const itemCategory = metadata.content_category;

  if (
    value === undefined &&
    valueCents === undefined &&
    !currency &&
    !itemId &&
    !itemName &&
    !itemCategory &&
    !metadata.coupon
  ) {
    return undefined;
  }

  const item = {
    item_id: itemId,
    item_name: itemName,
    item_category: itemCategory,
    quantity: 1,
    price: value,
  };

  const commerce = {
    currency,
    value,
    value_cents: valueCents,
    coupon: metadata.coupon,
    item_id: itemId,
    item_name: itemName,
    item_category: itemCategory,
    items: itemId || itemName ? [item] : undefined,
  };

  return Object.fromEntries(
    Object.entries(commerce).filter(([, currentValue]) => {
      if (currentValue === undefined || currentValue === null) return false;
      if (Array.isArray(currentValue)) return currentValue.length > 0;
      return true;
    })
  );
}

function validateAndBuildTrackingEvent(req) {
  const body = req.body;
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["Body must be a JSON object."] };
  }

  const eventName = cleanString(body.event_name, 80);
  const eventId = cleanString(body.event_id, 120);
  const idempotencyKey = cleanString(body.idempotency_key, 255);
  const eventTime = toOptionalNumber(body.event_time);
  const pageLocation = cleanString(body.page_location, 2000);

  if (!eventName || !ALLOWED_EVENT_NAMES.has(eventName)) {
    errors.push("event_name is required and must be an allowed site event.");
  }
  if (!eventId) {
    errors.push("event_id is required.");
  }
  if (!idempotencyKey) {
    errors.push("idempotency_key is required.");
  }
  if (eventTime === undefined) {
    errors.push("event_time must be a number.");
  }
  if (!pageLocation) {
    errors.push("page_location is required.");
  }

  const pageUrl = pageLocation ? parseUrl(pageLocation) : null;
  if (!pageUrl || !isAllowedHostname(pageUrl.hostname)) {
    errors.push("page_location must belong to blastgroup.org.");
  }

  const origin = cleanString(req.headers.origin, 2000);
  if (origin) {
    const originUrl = parseUrl(origin);
    if (!originUrl || !isAllowedHostname(originUrl.hostname)) {
      errors.push("origin is not allowed.");
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const metadata = sanitizeMetadata(body);
  const trackingEvent = {
    source_app: "blastgroup_site",
    event_name: eventName,
    event_id: eventId,
    event_time: Number(eventTime),
    idempotency_key: idempotencyKey,
    client: {
      ip_address: getClientIp(req),
      user_agent: cleanString(req.headers["user-agent"], 1000),
      page_location: pageLocation,
      referrer: cleanString(body.referrer, 2000),
      ga_client_id: cleanString(body.ga_client_id, 255),
      ga_session_id: cleanString(body.ga_session_id, 255),
      fbp: cleanString(body.fbp, 255),
      fbc: cleanString(body.fbc, 255),
    },
    attribution: {
      utm_source: cleanString(body.utm_source, 200),
      utm_medium: cleanString(body.utm_medium, 200),
      utm_campaign: cleanString(body.utm_campaign, 200),
      utm_content: cleanString(body.utm_content, 200),
      utm_term: cleanString(body.utm_term, 200),
      gclid: cleanString(body.gclid, 255),
      gbraid: cleanString(body.gbraid, 255),
      wbraid: cleanString(body.wbraid, 255),
      fbclid: cleanString(body.fbclid, 255),
    },
    metadata,
    commerce: buildCommerce(eventName, body, metadata),
  };

  return { trackingEvent };
}

router.post(
  "/",
  checkContentLength(config.maxBodyBytes, config.maxBodyMb),
  rateLimiter,
  jsonParser,
  (req, res, next) => {
    const { trackingEvent, errors } = validateAndBuildTrackingEvent(req);
    if (errors && errors.length > 0) {
      res.status(400).json({ error: "Invalid request body", details: errors });
      return;
    }

    req.trackingEvent = trackingEvent;

    Promise.resolve()
      .then(async () => {
        const cached = getTrackingResult(req.trackingEvent.idempotency_key);
        if (cached) {
          res.status(200).json({
            ...cached,
            duplicate: true,
          });
          return;
        }

        const dispatchResult = await dispatchTrackingEvent(req.trackingEvent);
        setTrackingResult(req.trackingEvent.idempotency_key, dispatchResult);

        console.log(
          JSON.stringify({
            action: "site_tracking_dispatch",
            event_name: req.trackingEvent.event_name,
            event_id: req.trackingEvent.event_id,
            idempotency_key: req.trackingEvent.idempotency_key,
            destinations: dispatchResult.destinations,
            timestamp: new Date().toISOString(),
          })
        );

        res.status(200).json({
          ok: true,
          duplicate: false,
          ...dispatchResult,
        });
      })
      .catch(next);
  }
);

router.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    res.status(413).json({ error: `Payload too large (max ${config.maxBodyMb}MB)` });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, "body")) {
    res.status(400).json({
      error: "Invalid request body",
      details: ["Malformed JSON payload."],
    });
    return;
  }
  if (err && err.statusCode) {
    res.status(502).json({
      error: "Tracking dispatch failed",
      details: [String(err.message || "Dispatch request failed")],
      provider_status: err.statusCode,
      provider_response: err.body || undefined,
    });
    return;
  }
  next(err);
});

module.exports = router;
