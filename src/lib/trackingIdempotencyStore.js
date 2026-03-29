const config = require("../config");

const entries = new Map();

function cleanup(now) {
  if (entries.size < 2000) return;
  for (const [key, value] of entries.entries()) {
    if (value.expiresAt <= now) {
      entries.delete(key);
    }
  }
}

function getTrackingResult(idempotencyKey) {
  const now = Date.now();
  const entry = entries.get(idempotencyKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(idempotencyKey);
    return null;
  }
  return entry.payload;
}

function setTrackingResult(idempotencyKey, payload) {
  const now = Date.now();
  entries.set(idempotencyKey, {
    payload,
    expiresAt: now + config.trackingIdempotencyTtlMs,
  });
  cleanup(now);
}

module.exports = {
  getTrackingResult,
  setTrackingResult,
};
