const { getClientIp } = require("../lib/ip");

function createRateLimiter({ maxRequests, windowMs }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const clientIp = getClientIp(req);
    req.clientIp = clientIp;

    const entry = buckets.get(clientIp);
    if (!entry || now - entry.windowStart >= windowMs) {
      buckets.set(clientIp, { count: 1, windowStart: now });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      res
        .status(429)
        .json({ error: "Too many requests. Please try again in a moment." });
      return;
    }

    if (buckets.size > 5000) {
      for (const [ip, bucket] of buckets.entries()) {
        if (now - bucket.windowStart >= windowMs) {
          buckets.delete(ip);
        }
      }
    }

    next();
  };
}

module.exports = createRateLimiter;
