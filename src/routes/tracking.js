const express = require("express");
const config = require("../config");
const checkContentLength = require("../middleware/checkContentLength");
const createRateLimiter = require("../middleware/rateLimit");
const requireTrackingToken = require("../middleware/requireTrackingToken");
const validateTrackingEventBody = require("../middleware/validateTrackingEventBody");
const { dispatchTrackingEvent } = require("../lib/trackingDispatch");
const { getTrackingResult, setTrackingResult } = require("../lib/trackingIdempotencyStore");

const router = express.Router();
const jsonParser = express.json({ limit: `${config.maxBodyMb}mb`, strict: true });
const rateLimiter = createRateLimiter({
  maxRequests: config.trackingRateLimitMax,
  windowMs: config.trackingRateLimitWindowMs,
});

router.post(
  "/",
  checkContentLength(config.maxBodyBytes, config.maxBodyMb),
  rateLimiter,
  jsonParser,
  requireTrackingToken,
  validateTrackingEventBody,
  (req, res, next) => {
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
            action: "tracking_dispatch",
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
