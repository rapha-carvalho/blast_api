const { getClientIp } = require("./ip");
const {
  appendNewsletterEvent,
  findNewsletterSubscriber,
  upsertNewsletterSubscriber,
} = require("./newsletterSheets");
const {
  sendSqlJourneyStartEvent,
  upsertSqlNewsletterContact,
} = require("./resendNewsletter");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_VERSION = "newsletter_sql_pratico_v1_2026-06-01";

function cleanString(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1 || value === "on";
}

function readParam(body, ...keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return body[key];
  }
  return "";
}

function normalizeNewsletterSubscription(body = {}, req, defaults = {}) {
  return {
    name: cleanString(readParam(body, "name", "nome"), 120),
    email: cleanString(readParam(body, "email"), 254).toLowerCase(),
    level: cleanString(readParam(body, "level", "nivel"), 120),
    consent: normalizeBoolean(readParam(body, "consent", "consentimento_lgpd")),
    consentVersion: cleanString(
      readParam(body, "consent_version", "consentVersion") || defaults.consentVersion || CONSENT_VERSION,
      120
    ),
    source: cleanString(readParam(body, "source", "origem") || defaults.source || "site", 80),
    sourceDetail: cleanString(
      readParam(body, "source_detail", "sourceDetail") || defaults.sourceDetail || "",
      180
    ),
    website: cleanString(readParam(body, "website"), 255),
    pageUrl: cleanString(readParam(body, "pageUrl", "page_url"), 1000),
    utmSource: cleanString(readParam(body, "utm_source"), 200),
    utmMedium: cleanString(readParam(body, "utm_medium"), 200),
    utmCampaign: cleanString(readParam(body, "utm_campaign"), 200),
    utmContent: cleanString(readParam(body, "utm_content"), 200),
    utmTerm: cleanString(readParam(body, "utm_term"), 200),
    gclid: cleanString(readParam(body, "gclid"), 255),
    gbraid: cleanString(readParam(body, "gbraid"), 255),
    wbraid: cleanString(readParam(body, "wbraid"), 255),
    fbclid: cleanString(readParam(body, "fbclid"), 255),
    subscribedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userAgent: cleanString(req?.get?.("user-agent"), 500),
    ip: cleanString(req ? getClientIp(req) : "", 120),
  };
}

function validateNewsletterSubscription(subscription, options = {}) {
  const errors = [];
  if (options.requireName && subscription.name.length < 2) errors.push("name");
  if (!EMAIL_RE.test(subscription.email)) errors.push("email");
  if (options.requireLevel && subscription.level.length < 2) errors.push("level");
  if (!subscription.consent) errors.push("consent");
  return errors;
}

async function appendSafeNewsletterEvent(event) {
  const result = await appendNewsletterEvent(event);
  if (!result.ok) {
    console.warn("Newsletter event append failed", { reason: result.reason });
  }
  return result;
}

async function subscribeToSqlNewsletter(subscription) {
  if (subscription.website) {
    return { ok: true, honeypot: true };
  }

  const existingResult = await findNewsletterSubscriber(subscription.email);
  if (!existingResult.ok) {
    return { ok: false, reason: existingResult.reason };
  }

  const existing = existingResult.ok ? existingResult.subscriber : null;
  const existingJourneyStartedAt = existing ? existing["Jornada iniciada em"] : "";
  const shouldStartJourney = !existingJourneyStartedAt;

  const resendContact = await upsertSqlNewsletterContact(subscription);
  let journeyResult = { ok: true, skipped: true };
  let journeyStartedAt = existingJourneyStartedAt;

  if (shouldStartJourney) {
    journeyResult = await sendSqlJourneyStartEvent(subscription);
    if (journeyResult.ok) {
      journeyStartedAt = new Date().toISOString();
    }
  }

  const sheetResult = await upsertNewsletterSubscriber({
    ...subscription,
    status: "ativo",
    resendContactId: resendContact.contactId || existing?.["Resend Contact ID"] || "",
    journeyStartedAt,
  });

  if (!sheetResult.ok) {
    await appendSafeNewsletterEvent({
      type: "sheet_error",
      email: subscription.email,
      name: subscription.name,
      source: subscription.source,
      sourceDetail: subscription.sourceDetail,
      status: "failed",
      journeyStarted: false,
      pageUrl: subscription.pageUrl,
      message: sheetResult.reason,
      payload: { resendContact, journeyResult },
    });
    return { ok: false, reason: sheetResult.reason };
  }

  const subscriberStatus = sheetResult.subscriberStatus;
  await appendSafeNewsletterEvent({
    type: subscriberStatus === "created" ? "subscribe" : subscriberStatus,
    email: subscription.email,
    name: subscription.name,
    source: subscription.source,
    sourceDetail: subscription.sourceDetail,
    status: "ok",
    journeyStarted: shouldStartJourney && journeyResult.ok,
    pageUrl: subscription.pageUrl,
    message: resendContact.ok ? "" : resendContact.reason || "resend_error",
    payload: { resendContact, journeyResult },
  });

  if (!resendContact.ok) {
    await appendSafeNewsletterEvent({
      type: "resend_error",
      email: subscription.email,
      name: subscription.name,
      source: subscription.source,
      sourceDetail: subscription.sourceDetail,
      status: "failed",
      journeyStarted: false,
      pageUrl: subscription.pageUrl,
      message: resendContact.reason,
      payload: resendContact,
    });
  }

  if (!journeyResult.ok) {
    await appendSafeNewsletterEvent({
      type: "journey_error",
      email: subscription.email,
      name: subscription.name,
      source: subscription.source,
      sourceDetail: subscription.sourceDetail,
      status: "failed",
      journeyStarted: false,
      pageUrl: subscription.pageUrl,
      message: journeyResult.reason,
      payload: journeyResult,
    });
  }

  return {
    ok: true,
    subscriberStatus,
    journeyStarted: shouldStartJourney && journeyResult.ok,
    resendStatus: resendContact.ok ? resendContact.action || "ok" : "failed",
  };
}

module.exports = {
  CONSENT_VERSION,
  normalizeNewsletterSubscription,
  subscribeToSqlNewsletter,
  validateNewsletterSubscription,
  _test: {
    cleanString,
    normalizeBoolean,
  },
};
