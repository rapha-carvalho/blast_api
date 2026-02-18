const express = require("express");
const cors = require("cors");
const config = require("./config");
const reportsRouter = require("./routes/reports");
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
  allowedHeaders: ["Content-Type", "Accept"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.status(204).end();
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api/v1/ga4-inspector/reports", reportsRouter);
app.use("/api/v1/reports/ga4-inspector", reportsRouter);

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
  console.error("db_init_failed");
}

app.listen(config.port, () => {
  console.log(`ga4-inspector-backend listening on port ${config.port}`);
});
