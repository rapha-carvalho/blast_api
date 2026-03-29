const config = require("../config");

function requireTrackingToken(req, res, next) {
  if (!config.trackingSharedToken) {
    res.status(500).json({ error: "Tracking token is not configured." });
    return;
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";

  if (!token || token !== config.trackingSharedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

module.exports = requireTrackingToken;
