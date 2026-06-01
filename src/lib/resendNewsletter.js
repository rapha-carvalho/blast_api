const config = require("../config");

const RESEND_API_BASE = "https://api.resend.com";

function cleanString(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function splitName(name) {
  const parts = cleanString(name, 120).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

async function resendRequest(path, { method = "GET", body } = {}) {
  if (!config.resendApiKey) {
    return { ok: false, skipped: true, reason: "resend_not_configured" };
  }

  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: data?.message || data?.error || text || `resend_http_${response.status}`,
      data,
    };
  }

  return { ok: true, status: response.status, data };
}

function buildContactPayload(subscriber) {
  const { firstName, lastName } = splitName(subscriber.name);
  const payload = {
    email: subscriber.email,
    first_name: firstName,
    last_name: lastName,
    unsubscribed: false,
    properties: {
      nome: subscriber.name || "",
      source: subscriber.source || "",
      source_detail: subscriber.sourceDetail || "",
      sql_level: subscriber.level || "",
      lead_magnet: "sql_cheatsheet",
      newsletter: "sql_pratico",
      consent_version: subscriber.consentVersion || "",
      first_subscribed_at: subscriber.subscribedAt || "",
      last_seen_at: subscriber.updatedAt || "",
    },
  };

  if (config.resendSqlSegmentId) {
    payload.segments = [{ id: config.resendSqlSegmentId }];
  }

  if (config.resendSqlTopicId) {
    payload.topics = [{ id: config.resendSqlTopicId, subscription: "opt_in" }];
  }

  return payload;
}

async function addContactToSqlSegment(email) {
  if (!config.resendSqlSegmentId) return { ok: true, skipped: true };
  return resendRequest(
    `/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(config.resendSqlSegmentId)}`,
    { method: "POST" }
  );
}

async function optContactIntoSqlTopic(email) {
  if (!config.resendSqlTopicId) return { ok: true, skipped: true };
  return resendRequest(`/contacts/${encodeURIComponent(email)}/topics`, {
    method: "PATCH",
    body: {
      topics: [{ id: config.resendSqlTopicId, subscription: "opt_in" }],
    },
  });
}

async function upsertSqlNewsletterContact(subscriber) {
  const createPayload = buildContactPayload(subscriber);
  const createResult = await resendRequest("/contacts", {
    method: "POST",
    body: createPayload,
  });

  if (createResult.ok) {
    return {
      ok: true,
      action: "created",
      contactId: createResult.data?.id || "",
      details: { contact: createResult },
    };
  }

  if (createResult.skipped) {
    return createResult;
  }

  const updatePayload = { ...createPayload };
  delete updatePayload.email;
  delete updatePayload.segments;
  delete updatePayload.topics;

  const updateResult = await resendRequest(`/contacts/${encodeURIComponent(subscriber.email)}`, {
    method: "PATCH",
    body: updatePayload,
  });

  if (!updateResult.ok) {
    return {
      ok: false,
      reason: updateResult.reason || createResult.reason,
      details: { create: createResult, update: updateResult },
    };
  }

  const [segmentResult, topicResult] = await Promise.all([
    addContactToSqlSegment(subscriber.email),
    optContactIntoSqlTopic(subscriber.email),
  ]);

  return {
    ok: true,
    action: "updated",
    contactId: updateResult.data?.id || "",
    details: {
      contact: updateResult,
      segment: segmentResult,
      topic: topicResult,
    },
  };
}

async function sendSqlJourneyStartEvent(subscriber) {
  return resendRequest("/events/send", {
    method: "POST",
    body: {
      event: "sql_cheatsheet_subscribed",
      email: subscriber.email,
      payload: {
        name: subscriber.name || "",
        level: subscriber.level || "",
        source: subscriber.source || "",
        source_detail: subscriber.sourceDetail || "",
        lead_magnet: "sql_cheatsheet",
        newsletter: "sql_pratico",
        journey: "sql_cheatsheet_v1",
        campaign_key: "sql_cheatsheet_v1_welcome",
        page_url: subscriber.pageUrl || "",
      },
    },
  });
}

module.exports = {
  sendSqlJourneyStartEvent,
  upsertSqlNewsletterContact,
  _test: {
    buildContactPayload,
  },
};
