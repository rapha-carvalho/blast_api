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
};
