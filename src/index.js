const express = require("express");
const cors = require("cors");
const config = require("./config");
const reportsRouter = require("./routes/reports");
const mixpanelReportsRouter = require("./routes/mixpanelReports");
const siteTrackingRouter = require("./routes/siteTracking");
const trackingRouter = require("./routes/tracking");
const mentorshipRouter = require("./routes/mentorship");
const mentorshipCheckoutRouter = require("./routes/mentorshipCheckout");
const sqlCheatsheetRouter = require("./routes/sqlCheatsheet");
const newsletterRouter = require("./routes/newsletter");
const stripeRouter = require("./routes/stripe");
const licenseRouter = require("./routes/license");
const adminRouter = require("./routes/admin");
const contactRouter = require("./routes/contact");
const eventsRouter = require("./routes/events");
const { initDb } = require("./lib/db");

function isAllowedExtensionOrigin(origin, allowedExtensionIds) {
  if (!origin.startsWith("chrome-extension://")) {
    return false;
  }
  const extensionId = origin.replace("chrome-extension://", "").trim();
  if (!extensionId) {
    return false;
  }
  if (allowedExtensionIds.length === 0) {
    return true;
  }
  return allowedExtensionIds.includes(extensionId);
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  if (config.allowedOrigins.includes("*")) {
    return true;
  }
  if (config.allowedOrigins.includes(origin)) {
    return true;
  }
  if (config.allowChromeExtensionOrigins && isAllowedExtensionOrigin(origin, config.allowedExtensionIds)) {
    return true;
  }
  return false;
}

const app = express();
app.disable("x-powered-by");

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Raw body for Stripe webhook — must come before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json", limit: "64kb" }));
// Raw body for Resend webhook verification must also come before express.json().
app.use("/api/newsletter/resend-webhook", express.raw({ type: "application/json", limit: "512kb" }));

app.use(express.json({ limit: `${config.maxBodyMb}mb` }));

app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  res.status(204).end();
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api/v1/ga4-inspector/reports", reportsRouter);
app.use("/api/v1/reports/ga4-inspector", reportsRouter);
app.use("/api/v1/mixpanel-inspector/reports", mixpanelReportsRouter);
app.use("/api/v1/reports/mixpanel-inspector", mixpanelReportsRouter);
app.use("/api/v1/tracking/site-events", siteTrackingRouter);
app.use("/api/v1/tracking/events", trackingRouter);
app.use("/api/v1/mentorship/bookings", mentorshipRouter);
app.use("/api/mentorship", mentorshipCheckoutRouter);
app.use("/api/sql-cheatsheet", sqlCheatsheetRouter);
app.use("/api/newsletter", newsletterRouter);
app.use("/api/stripe", stripeRouter);
app.use("/api/license", licenseRouter);
app.use("/api/admin", adminRouter);
app.use("/api/contact", contactRouter);
app.use("/api/events", eventsRouter);

app.use((err, req, res, next) => {
  console.error("unhandled_error");
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});

try {
  initDb();
} catch (error) {
  console.error("db_init_failed", error && error.message ? error.message : error);
}

app.listen(config.port, () => {
  console.log(`ga4-inspector-backend listening on port ${config.port}`);
});
