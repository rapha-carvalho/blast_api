const express = require("express");
const PDFDocument = require("pdfkit");
const config = require("../config");
const checkContentLength = require("../middleware/checkContentLength");
const createRateLimiter = require("../middleware/rateLimit");
const validateMixpanelReportBody = require("../middleware/validateMixpanelReportBody");
const { getClientIp } = require("../lib/ip");
const { buildMixpanelPdf } = require("../lib/mixpanelPdf");
const { recordReportRequest } = require("../lib/db");

const router = express.Router();
const jsonParser = express.json({ limit: `${config.maxBodyMb}mb`, strict: true });
const rateLimiter = createRateLimiter({
  maxRequests: config.rateLimitMax,
  windowMs: config.rateLimitWindowMs,
});

function buildFilenameDate(generatedAt) {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

router.post(
  "/",
  checkContentLength(config.maxBodyBytes, config.maxBodyMb),
  rateLimiter,
  jsonParser,
  validateMixpanelReportBody,
  (req, res) => {
    const { events, sessionInfo, generatedAt, source } = req.reportPayload;
    const clientIp = req.clientIp || getClientIp(req);

    console.log(
      JSON.stringify({
        product: "mixpanel-inspector",
        action: "generate-report",
        eventCount: events.length,
        timestamp: new Date().toISOString(),
        clientIp,
      })
    );

    try {
      recordReportRequest({
        clientIp,
        eventCount: events.length,
        source,
      });
    } catch (error) {
      console.error("report_request_insert_failed");
    }

    const fileDate = buildFilenameDate(generatedAt);
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mixpanel-inspector-report-${fileDate}.pdf"`
    );

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: "A4",
      layout: "landscape",
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      info: {
        Title: "Mixpanel Inspector Report",
      },
    });

    doc.on("error", () => {
      try {
        doc.unpipe(res);
      } catch (unpipeError) {
        // No-op.
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation failed" });
      } else if (!res.writableEnded) {
        try {
          res.end();
        } catch (endError) {
          // No-op: stream is already closing.
        }
      }
    });

    try {
      doc.pipe(res);
      buildMixpanelPdf(doc, {
        events,
        sessionInfo,
        generatedAt,
        source,
        logoPath: config.logoPath,
      });
      doc.end();
    } catch (error) {
      console.error("pdf_build_failed");
      try {
        doc.unpipe(res);
      } catch (unpipeError) {
        // No-op.
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation failed" });
        return;
      }
      if (!res.writableEnded) {
        try {
          res.end();
        } catch (endError) {
          // No-op: stream may already be closed.
        }
      }
    }
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
  next(err);
});

module.exports = router;
