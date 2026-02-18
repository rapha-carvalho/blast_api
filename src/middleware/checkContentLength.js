function checkContentLength(maxBytes, maxBodyMb) {
  return (req, res, next) => {
    const rawLength = req.headers["content-length"];
    if (!rawLength) {
      next();
      return;
    }

    const parsed = Number.parseInt(rawLength, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      res.status(413).json({ error: `Payload too large (max ${maxBodyMb}MB)` });
      return;
    }

    next();
  };
}

module.exports = checkContentLength;
