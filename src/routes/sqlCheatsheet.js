const express = require("express");
const config = require("../config");
const checkContentLength = require("../middleware/checkContentLength");
const createRateLimiter = require("../middleware/rateLimit");
const { getClientIp } = require("../lib/ip");
const { appendSqlCheatsheetAccess } = require("../lib/sheets");
const { CONSENT_VERSION, subscribeToSqlNewsletter } = require("../lib/newsletterService");

const router = express.Router();
const rateLimiter = createRateLimiter({
  maxRequests: config.rateLimitMax,
  windowMs: config.rateLimitWindowMs,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = new Set(["landing", "direct", "stored"]);

function cleanString(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeSource(value) {
  const source = cleanString(value, 40).toLowerCase();
  return ALLOWED_SOURCES.has(source) ? source : "direct";
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function normalizeAccess(body, req) {
  return {
    name: cleanString(body.name || body.nome, 120),
    email: cleanString(body.email, 254).toLowerCase(),
    level: cleanString(body.level || body.nivel, 120),
    role: cleanString(body.role || body.interest || body.cargo_interesse, 180),
    consent: normalizeBoolean(body.consent || body.consentimento_lgpd),
    source: normalizeSource(body.source || body.origem),
    website: cleanString(body.website, 255),
    pageUrl: cleanString(body.pageUrl || body.page_url, 1000),
    utmSource: cleanString(body.utm_source, 200),
    utmMedium: cleanString(body.utm_medium, 200),
    utmCampaign: cleanString(body.utm_campaign, 200),
    utmContent: cleanString(body.utm_content, 200),
    utmTerm: cleanString(body.utm_term, 200),
    gclid: cleanString(body.gclid, 255),
    gbraid: cleanString(body.gbraid, 255),
    wbraid: cleanString(body.wbraid, 255),
    fbclid: cleanString(body.fbclid, 255),
    accessedAt: new Date().toISOString(),
    userAgent: cleanString(req.get("user-agent"), 500),
    ip: cleanString(getClientIp(req), 120),
  };
}

function validateAccess(access) {
  const errors = [];

  if (!EMAIL_RE.test(access.email)) {
    errors.push("email");
  }

  if (access.source === "landing") {
    if (access.name.length < 2) errors.push("name");
    if (access.level.length < 2) errors.push("level");
    if (!access.consent) errors.push("consent");
  } else if (access.source === "direct" && !access.consent) {
    errors.push("consent");
  }

  return errors;
}

router.post(
  "/access",
  checkContentLength(config.maxBodyBytes, config.maxBodyMb),
  rateLimiter,
  async (req, res, next) => {
    try {
      const body = req.body || {};
      const access = normalizeAccess(body, req);

      if (access.website) {
        return res.status(200).json({ ok: true });
      }

      const errors = validateAccess(access);
      if (errors.length > 0) {
        return res.status(400).json({ error: "validation_failed", fields: errors });
      }

      const sheetResult = await appendSqlCheatsheetAccess(access);
      if (!sheetResult.ok) {
        console.warn("SQL cheatsheet sheet append failed", { reason: sheetResult.reason });
        return res.status(503).json({ error: "sheet_append_failed" });
      }

      if (access.consent) {
        const newsletterResult = await subscribeToSqlNewsletter({
          name: access.name,
          email: access.email,
          level: access.level,
          consent: access.consent,
          consentVersion: cleanString(body.consent_version || body.consentVersion || CONSENT_VERSION, 120),
          source: `cheatsheet_${access.source}`,
          sourceDetail: "sql_cheatsheet",
          website: access.website,
          pageUrl: access.pageUrl,
          utmSource: access.utmSource,
          utmMedium: access.utmMedium,
          utmCampaign: access.utmCampaign,
          utmContent: access.utmContent,
          utmTerm: access.utmTerm,
          gclid: access.gclid,
          gbraid: access.gbraid,
          wbraid: access.wbraid,
          fbclid: access.fbclid,
          subscribedAt: access.accessedAt,
          updatedAt: access.accessedAt,
          userAgent: access.userAgent,
          ip: access.ip,
        });

        if (!newsletterResult.ok) {
          console.warn("SQL cheatsheet newsletter subscribe failed", { reason: newsletterResult.reason });
          return res.status(503).json({ error: "newsletter_subscribe_failed" });
        }
      }

      console.log(
        JSON.stringify({
          action: "sql_cheatsheet_access",
          source: access.source,
          email_domain: access.email.split("@")[1] || "",
          timestamp: access.accessedAt,
        })
      );

      return res.status(200).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
