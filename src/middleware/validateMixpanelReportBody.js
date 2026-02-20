const MAX_EVENTS_PER_REQUEST = 10_000;

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
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanString(value, maxLength);
  }
  return undefined;
}

function toOptionalInteger(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return undefined;
}

function sanitizeParamValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return cleanString(value, 4000);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeParamValue(item));
  }
  if (isObject(value)) {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, 50)) {
      out[cleanString(key, 200)] = sanitizeParamValue(nestedValue);
    }
    return out;
  }
  return cleanString(value, 4000);
}

function sanitizeParams(params) {
  if (!isObject(params)) {
    return undefined;
  }
  const out = {};
  for (const [key, value] of Object.entries(params).slice(0, 200)) {
    out[cleanString(key, 200)] = sanitizeParamValue(value);
  }
  return out;
}

function sanitizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return undefined;
  }
  const out = [];
  for (const warning of warnings.slice(0, 50)) {
    const normalized = toOptionalString(warning, 500);
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}

function sanitizeSessionInfo(sessionInfo) {
  if (!isObject(sessionInfo)) {
    return undefined;
  }
  const out = {};
  for (const [key, value] of Object.entries(sessionInfo).slice(0, 200)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[cleanString(key, 200)] = cleanString(value, 4000);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeEvent(event) {
  if (!isObject(event)) {
    return {};
  }

  return {
    id: toOptionalString(event.id, 128),
    timestamp: toOptionalString(event.timestamp, 128),
    eventName: toOptionalString(event.eventName, 256),
    projectToken: toOptionalString(event.projectToken, 128),
    distinctId: toOptionalString(event.distinctId, 256),
    sessionId: toOptionalString(event.sessionId, 256),
    measurementId: toOptionalString(event.measurementId, 128),
    clientId: toOptionalString(event.clientId, 256),
    pageUrl: toOptionalString(event.pageUrl, 4000),
    tabId: toOptionalInteger(event.tabId),
    source: toOptionalString(event.source, 128),
    endpointType: toOptionalString(event.endpointType, 64),
    params: sanitizeParams(event.params),
    warnings: sanitizeWarnings(event.warnings),
  };
}

function validateMixpanelReportBody(req, res, next) {
  const errors = [];
  const body = req.body;

  if (!isObject(body)) {
    errors.push("Body must be a JSON object.");
  } else {
    if (!Array.isArray(body.events)) {
      errors.push("events must be an array.");
    } else {
      if (body.events.length === 0) {
        errors.push("events must contain at least one item.");
      }
      if (body.events.length > MAX_EVENTS_PER_REQUEST) {
        errors.push(`events must contain at most ${MAX_EVENTS_PER_REQUEST} items.`);
      }
    }

    if (typeof body.generatedAt !== "string" || Number.isNaN(Date.parse(body.generatedAt))) {
      errors.push("generatedAt must be a valid ISO 8601 datetime string.");
    }

    if (body.source !== "extension") {
      errors.push('source must be exactly "extension".');
    }

    if (
      body.sessionInfo !== undefined &&
      body.sessionInfo !== null &&
      !isObject(body.sessionInfo)
    ) {
      errors.push("sessionInfo must be an object when provided.");
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ error: "Invalid request body", details: errors });
    return;
  }

  req.reportPayload = {
    events: body.events.map((event) => sanitizeEvent(event)),
    sessionInfo: sanitizeSessionInfo(body.sessionInfo),
    generatedAt: body.generatedAt,
    source: body.source,
  };

  next();
}

module.exports = validateMixpanelReportBody;
