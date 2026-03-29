const path = require("path");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

const maxBodyMb = parsePositiveInt(process.env.MAX_BODY_MB, 5);

module.exports = {
  port: parsePositiveInt(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV || "development",
  maxBodyMb,
  maxBodyBytes: maxBodyMb * 1024 * 1024,
  rateLimitMax: parsePositiveInt(process.env.RATE_LIMIT_MAX, 20),
  rateLimitWindowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  enableDb: parseBoolean(process.env.ENABLE_DB, false),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), "data", "ga4-inspector.db"),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "https://blastgroup.org")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  allowChromeExtensionOrigins: parseBoolean(process.env.ALLOW_CHROME_EXTENSION_ORIGINS, true),
  allowedExtensionIds: (process.env.ALLOWED_EXTENSION_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  logoPath: process.env.LOGO_PATH || path.resolve(process.cwd(), "blast-logo.png"),
  trackingSharedToken: process.env.TRACKING_SHARED_TOKEN || "",
  trackingRateLimitMax: parsePositiveInt(process.env.TRACKING_RATE_LIMIT_MAX, 120),
  trackingRateLimitWindowMs: parsePositiveInt(process.env.TRACKING_RATE_LIMIT_WINDOW_MS, 60_000),
  trackingIdempotencyTtlMs: parsePositiveInt(process.env.TRACKING_IDEMPOTENCY_TTL_MS, 7 * 24 * 60 * 60 * 1000),
  trackingDispatchTimeoutMs: parsePositiveInt(process.env.TRACKING_DISPATCH_TIMEOUT_MS, 5000),
  trackingDebugEnabled: parseBoolean(process.env.TRACKING_DEBUG_ENABLED, false),
  metaPixelId: process.env.META_PIXEL_ID || "",
  metaAccessToken: process.env.META_ACCESS_TOKEN || "",
  metaTestEventCode: process.env.META_TEST_EVENT_CODE || "",
  ga4MeasurementId: process.env.GA4_MEASUREMENT_ID || "",
  ga4ApiSecret: process.env.GA4_API_SECRET || "",
};
