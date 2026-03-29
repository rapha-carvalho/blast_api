function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, maxLength = 4000) {
  const asString = String(value);
  const withoutControls = asString.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (withoutControls.length <= maxLength) {
    return withoutControls;
  }
  return withoutControls.slice(0, maxLength);
}

function toOptionalString(value, maxLength) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanString(value, maxLength);
  }
  return undefined;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function sanitizeObject(obj, spec) {
  if (!isObject(obj)) return undefined;
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (rule === "number") {
      const value = toOptionalNumber(obj[key]);
      if (value !== undefined) out[key] = value;
      continue;
    }
    if (typeof rule === "number") {
      const value = toOptionalString(obj[key], rule);
      if (value !== undefined) out[key] = value;
      continue;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return undefined;
  const sanitized = items
    .slice(0, 20)
    .map((item) =>
      sanitizeObject(item, {
        item_id: 120,
        item_name: 255,
        item_category: 120,
        price: "number",
        quantity: "number",
      })
    )
    .filter(Boolean);
  return sanitized.length > 0 ? sanitized : undefined;
}

function validateTrackingEventBody(req, res, next) {
  const body = req.body;
  const errors = [];

  if (!isObject(body)) {
    errors.push("Body must be a JSON object.");
  } else {
    if (!toOptionalString(body.source_app, 120)) {
      errors.push("source_app is required.");
    }
    if (!toOptionalString(body.event_name, 80)) {
      errors.push("event_name is required.");
    }
    if (!toOptionalString(body.event_id, 120)) {
      errors.push("event_id is required.");
    }
    if (!toOptionalString(body.idempotency_key, 255)) {
      errors.push("idempotency_key is required.");
    }
    if (toOptionalNumber(body.event_time) === undefined) {
      errors.push("event_time must be a number.");
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ error: "Invalid request body", details: errors });
    return;
  }

  const client = sanitizeObject(body.client, {
    ip_address: 120,
    user_agent: 1000,
    page_location: 2000,
    referrer: 2000,
    ga_client_id: 255,
    ga_session_id: 255,
    fbp: 255,
    fbc: 255,
  });

  const attribution = sanitizeObject(body.attribution, {
    utm_source: 200,
    utm_medium: 200,
    utm_campaign: 200,
    utm_content: 200,
    utm_term: 200,
    gclid: 255,
    gbraid: 255,
    wbraid: 255,
    fbclid: 255,
  });

  const user = sanitizeObject(body.user, {
    email: 254,
  });

  const commerce = sanitizeObject(body.commerce, {
    currency: 12,
    value: "number",
    value_cents: "number",
    coupon: 120,
    course_id: 120,
    installment_count: "number",
    item_id: 120,
    item_name: 255,
    checkout_intent_id: 120,
    stripe_checkout_session_id: 255,
    transaction_id: 255,
  }) || {};

  const items = sanitizeItems(body.commerce && body.commerce.items);
  if (items) {
    commerce.items = items;
  }

  req.trackingEvent = {
    source_app: cleanString(body.source_app, 120),
    event_name: cleanString(body.event_name, 80),
    event_id: cleanString(body.event_id, 120),
    event_time: Number(body.event_time),
    idempotency_key: cleanString(body.idempotency_key, 255),
    client,
    attribution,
    user,
    commerce: Object.keys(commerce).length > 0 ? commerce : undefined,
  };

  next();
}

module.exports = validateTrackingEventBody;
