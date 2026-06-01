const EMAIL_EVENT_HEADERS = [
  "Recebido em",
  "Webhook ID",
  "Tipo do evento",
  "Evento criado em",
  "Email",
  "Email ID",
  "Broadcast ID",
  "Template ID",
  "Assunto",
  "From",
  "To",
  "Campaign Key",
  "Journey Step",
  "Link clicado",
  "Motivo",
  "Tags JSON",
  "Payload JSON",
];

const EMAIL_SUMMARY_HEADERS = [
  "Email",
  "Nome",
  "Status",
  "Inscrito em",
  "Último evento em",
  "Enviados",
  "Entregues",
  "Aberturas",
  "Cliques",
  "Bounces",
  "Falhas",
  "Reclamações",
  "Suprimidos",
  "Último clique",
  "Descadastrado em",
  "Origem inicial",
  "Nível SQL",
];

const CAMPAIGN_SUMMARY_HEADERS = [
  "Campaign Key",
  "Broadcast ID",
  "Assunto",
  "Journey Step",
  "Enviados",
  "Entregues",
  "Aberturas únicas",
  "Cliques únicos",
  "Cliques totais",
  "Bounces",
  "Falhas",
  "Reclamações",
  "Suprimidos",
  "Delivery rate",
  "Open rate",
  "CTR",
  "Último evento em",
];

function cleanString(value, maxLength = 4000) {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function stringifyJson(value) {
  try {
    const json = JSON.stringify(value || {});
    return json.length <= 45000 ? json : json.slice(0, 45000);
  } catch {
    return "{}";
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeTags(tags) {
  if (!tags || typeof tags !== "object") return {};
  if (!Array.isArray(tags)) {
    return Object.fromEntries(
      Object.entries(tags).map(([key, value]) => [cleanString(key, 120), cleanString(value, 500)])
    );
  }

  const normalized = {};
  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    const key = cleanString(tag.name || tag.key, 120);
    const value = cleanString(tag.value, 500);
    if (key) normalized[key] = value;
  }
  return normalized;
}

function firstEmailFromData(data) {
  const to = asArray(data.to).map((item) => cleanString(item, 254)).filter(Boolean);
  return cleanString(data.email || data.recipient || to[0] || "", 254).toLowerCase();
}

function getReason(data, eventType) {
  if (data.failed && typeof data.failed === "object") {
    return cleanString(data.failed.reason || data.failed.message, 1000);
  }
  if (data.bounce && typeof data.bounce === "object") {
    return cleanString(
      [data.bounce.type, data.bounce.subType, data.bounce.message].filter(Boolean).join(" - "),
      1000
    );
  }
  if (data.suppressed && typeof data.suppressed === "object") {
    return cleanString(data.suppressed.reason || data.suppressed.message, 1000);
  }
  if (data.delivery_delayed && typeof data.delivery_delayed === "object") {
    return cleanString(data.delivery_delayed.reason || data.delivery_delayed.message, 1000);
  }
  return cleanString(data.reason || data.error || (eventType.startsWith("contact.") ? data.unsubscribed : ""), 1000);
}

function buildFallbackWebhookId(event, normalizedData) {
  return [
    event.type,
    normalizedData.emailId || normalizedData.email || "unknown",
    normalizedData.eventCreatedAt || event.created_at || "",
    normalizedData.clickedLink || "",
  ].join(":");
}

function normalizeResendWebhookEvent(event, options = {}) {
  const data = event && typeof event === "object" && event.data && typeof event.data === "object" ? event.data : {};
  const tags = normalizeTags(data.tags);
  const normalized = {
    receivedAt: cleanString(options.receivedAt || new Date().toISOString(), 80),
    webhookId: cleanString(options.webhookId || "", 255),
    eventType: cleanString(event && event.type, 120),
    eventCreatedAt: cleanString(event && event.created_at ? event.created_at : data.created_at, 120),
    email: firstEmailFromData(data),
    emailId: cleanString(data.email_id || data.id, 255),
    broadcastId: cleanString(data.broadcast_id, 255),
    templateId: cleanString(data.template_id, 255),
    subject: cleanString(data.subject, 500),
    from: cleanString(data.from, 500),
    to: asArray(data.to).map((item) => cleanString(item, 500)).filter(Boolean).join(", "),
    campaignKey: cleanString(tags.campaign_key || data.broadcast_id || data.template_id || "", 255),
    journeyStep: cleanString(tags.step || tags.journey_step || "", 120),
    clickedLink: cleanString((data.click && data.click.link) || data.link, 2000),
    reason: "",
    tags,
    payload: event || {},
    contactUnsubscribed: data.unsubscribed === true || data.unsubscribed === "true",
  };

  normalized.reason = getReason(data, normalized.eventType);
  normalized.webhookId = normalized.webhookId || buildFallbackWebhookId(event || {}, normalized);
  return normalized;
}

function emailEventToRow(event) {
  return [
    event.receivedAt,
    event.webhookId,
    event.eventType,
    event.eventCreatedAt,
    event.email,
    event.emailId,
    event.broadcastId,
    event.templateId,
    event.subject,
    event.from,
    event.to,
    event.campaignKey,
    event.journeyStep,
    event.clickedLink,
    event.reason,
    stringifyJson(event.tags),
    stringifyJson(event.payload),
  ];
}

function toInt(value) {
  const parsed = Number.parseInt(value || "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function increment(record, key, amount = 1) {
  record[key] = String(toInt(record[key]) + amount);
}

function applyEmailSummaryEvent(record, event, subscriber = {}) {
  const current = { ...record };
  current.Email = current.Email || event.email || subscriber.email || "";
  current.Nome = current.Nome || subscriber.name || "";
  current.Status = current.Status || "ativo";
  current["Inscrito em"] = current["Inscrito em"] || subscriber.subscribedAt || "";
  current["Último evento em"] = event.eventCreatedAt || event.receivedAt || current["Último evento em"] || "";
  current["Origem inicial"] = current["Origem inicial"] || subscriber.source || "";
  current["Nível SQL"] = current["Nível SQL"] || subscriber.level || "";

  switch (event.eventType) {
    case "email.sent":
      increment(current, "Enviados");
      break;
    case "email.delivered":
      increment(current, "Entregues");
      break;
    case "email.opened":
      increment(current, "Aberturas");
      break;
    case "email.clicked":
      increment(current, "Cliques");
      current["Último clique"] = event.clickedLink || current["Último clique"] || "";
      break;
    case "email.bounced":
      increment(current, "Bounces");
      current.Status = "bounce";
      break;
    case "email.failed":
      increment(current, "Falhas");
      current.Status = "falha";
      break;
    case "email.complained":
      increment(current, "Reclamações");
      current.Status = "spam";
      break;
    case "email.suppressed":
      increment(current, "Suprimidos");
      current.Status = "suprimido";
      break;
    case "contact.updated":
      if (event.contactUnsubscribed) {
        current.Status = "descadastrado";
        current["Descadastrado em"] = event.eventCreatedAt || event.receivedAt || "";
      }
      break;
    case "contact.deleted":
      current.Status = "removido";
      current["Descadastrado em"] = event.eventCreatedAt || event.receivedAt || "";
      break;
    default:
      break;
  }

  return current;
}

function formatRate(numerator, denominator) {
  const total = toInt(denominator);
  if (!total) return "0%";
  return `${((toInt(numerator) / total) * 100).toFixed(2)}%`;
}

function applyCampaignSummaryEvent(record, event, options = {}) {
  const current = { ...record };
  current["Campaign Key"] = current["Campaign Key"] || event.campaignKey || event.broadcastId || event.templateId || event.eventType;
  current["Broadcast ID"] = current["Broadcast ID"] || event.broadcastId || "";
  current.Assunto = current.Assunto || event.subject || "";
  current["Journey Step"] = current["Journey Step"] || event.journeyStep || "";
  current["Último evento em"] = event.eventCreatedAt || event.receivedAt || current["Último evento em"] || "";

  switch (event.eventType) {
    case "email.sent":
      increment(current, "Enviados");
      break;
    case "email.delivered":
      increment(current, "Entregues");
      break;
    case "email.opened":
      if (options.isUniqueOpen) increment(current, "Aberturas únicas");
      break;
    case "email.clicked":
      if (options.isUniqueClick) increment(current, "Cliques únicos");
      increment(current, "Cliques totais");
      break;
    case "email.bounced":
      increment(current, "Bounces");
      break;
    case "email.failed":
      increment(current, "Falhas");
      break;
    case "email.complained":
      increment(current, "Reclamações");
      break;
    case "email.suppressed":
      increment(current, "Suprimidos");
      break;
    default:
      break;
  }

  current["Delivery rate"] = formatRate(current.Entregues, current.Enviados);
  current["Open rate"] = formatRate(current["Aberturas únicas"], current.Entregues);
  current.CTR = formatRate(current["Cliques únicos"], current.Entregues);
  return current;
}

function recordToRow(headers, record) {
  return headers.map((header) => record[header] || "");
}

module.exports = {
  CAMPAIGN_SUMMARY_HEADERS,
  EMAIL_EVENT_HEADERS,
  EMAIL_SUMMARY_HEADERS,
  applyCampaignSummaryEvent,
  applyEmailSummaryEvent,
  emailEventToRow,
  normalizeResendWebhookEvent,
  recordToRow,
};
