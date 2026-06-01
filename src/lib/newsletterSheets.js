const { google } = require("googleapis");
const config = require("../config");
const { ensureSheetWithHeaders, getSheetsAuth, quoteSheetName } = require("./sheets");
const {
  CAMPAIGN_SUMMARY_HEADERS,
  EMAIL_EVENT_HEADERS,
  EMAIL_SUMMARY_HEADERS,
  applyCampaignSummaryEvent,
  applyEmailSummaryEvent,
  emailEventToRow,
  recordToRow,
} = require("./newsletterStats");

const SUBSCRIBERS_HEADERS = [
  "Email",
  "Nome",
  "Status",
  "Inscrito em",
  "Atualizado em",
  "Consentimento LGPD",
  "Versão consentimento",
  "Fonte inicial",
  "Última fonte",
  "Nível SQL",
  "Página inicial",
  "Última página",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "UTM Content",
  "UTM Term",
  "GCLID",
  "GBRAID",
  "WBRAID",
  "FBCLID",
  "Resend Contact ID",
  "Jornada iniciada em",
  "Descadastrado em",
  "User-Agent",
  "IP",
];

const NEWSLETTER_EVENTS_HEADERS = [
  "Registrado em",
  "Tipo",
  "Email",
  "Nome",
  "Fonte",
  "Detalhe da fonte",
  "Status",
  "Jornada iniciada",
  "Página",
  "Mensagem",
  "Payload JSON",
];

function stringifyJson(value) {
  try {
    const json = JSON.stringify(value || {});
    return json.length <= 45000 ? json : json.slice(0, 45000);
  } catch {
    return "{}";
  }
}

function toColumnName(index) {
  let current = index;
  let columnName = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    current = Math.floor((current - 1) / 26);
  }
  return columnName;
}

function getSheetsClient() {
  const auth = getSheetsAuth();
  if (!auth) {
    console.warn("sheets: Google credentials not set; skipping newsletter append.");
    return null;
  }
  return google.sheets({ version: "v4", auth });
}

async function ensureNewsletterSheet(sheets, sheetName, headers) {
  await ensureSheetWithHeaders(sheets, config.newsletterSpreadsheetId, sheetName, headers);
}

async function readRecords(sheets, sheetName, headers) {
  await ensureNewsletterSheet(sheets, sheetName, headers);
  const lastColumn = toColumnName(headers.length);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.newsletterSpreadsheetId,
    range: `${quoteSheetName(sheetName)}!A2:${lastColumn}`,
  });

  const values = response.data.values || [];
  return values.map((row, index) => ({
    rowNumber: index + 2,
    record: Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] || ""])),
  }));
}

async function appendRow(sheets, sheetName, headers, row) {
  await ensureNewsletterSheet(sheets, sheetName, headers);
  const lastColumn = toColumnName(headers.length);
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.newsletterSpreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:${lastColumn}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function updateRow(sheets, sheetName, headers, rowNumber, row) {
  const lastColumn = toColumnName(headers.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.newsletterSpreadsheetId,
    range: `${quoteSheetName(sheetName)}!A${rowNumber}:${lastColumn}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function subscriberRowFromRecord(record) {
  return recordToRow(SUBSCRIBERS_HEADERS, record);
}

async function findNewsletterSubscriber(email) {
  const sheets = getSheetsClient();
  if (!sheets) return { ok: false, reason: "sheets_not_configured" };

  try {
    const normalizedEmail = normalizeEmail(email);
    const rows = await readRecords(sheets, config.newsletterSubscribersSheetName, SUBSCRIBERS_HEADERS);
    const found = rows.find(({ record }) => normalizeEmail(record.Email) === normalizedEmail);
    return { ok: true, subscriber: found ? found.record : null };
  } catch (error) {
    console.error("sheets: newsletter subscriber lookup failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

async function upsertNewsletterSubscriber(subscriber) {
  const sheets = getSheetsClient();
  if (!sheets) return { ok: false, reason: "sheets_not_configured" };

  try {
    const now = subscriber.updatedAt || new Date().toISOString();
    const normalizedEmail = normalizeEmail(subscriber.email);
    const rows = await readRecords(sheets, config.newsletterSubscribersSheetName, SUBSCRIBERS_HEADERS);
    const found = rows.find(({ record }) => normalizeEmail(record.Email) === normalizedEmail);
    const existing = found ? found.record : {};
    const wasInactive = ["descadastrado", "removido", "spam"].includes(
      normalizeEmail(existing.Status)
    );
    const subscriberStatus = !found ? "created" : wasInactive ? "resubscribed" : "updated";
    const record = {
      ...existing,
      Email: normalizedEmail,
      Nome: subscriber.name || existing.Nome || "",
      Status: subscriber.status || "ativo",
      "Inscrito em": existing["Inscrito em"] || subscriber.subscribedAt || now,
      "Atualizado em": now,
      "Consentimento LGPD": subscriber.consent ? "Sim" : existing["Consentimento LGPD"] || "",
      "Versão consentimento": subscriber.consentVersion || existing["Versão consentimento"] || "",
      "Fonte inicial": existing["Fonte inicial"] || subscriber.source || "",
      "Última fonte": subscriber.source || existing["Última fonte"] || "",
      "Nível SQL": subscriber.level || existing["Nível SQL"] || "",
      "Página inicial": existing["Página inicial"] || subscriber.pageUrl || "",
      "Última página": subscriber.pageUrl || existing["Última página"] || "",
      "UTM Source": subscriber.utmSource || existing["UTM Source"] || "",
      "UTM Medium": subscriber.utmMedium || existing["UTM Medium"] || "",
      "UTM Campaign": subscriber.utmCampaign || existing["UTM Campaign"] || "",
      "UTM Content": subscriber.utmContent || existing["UTM Content"] || "",
      "UTM Term": subscriber.utmTerm || existing["UTM Term"] || "",
      GCLID: subscriber.gclid || existing.GCLID || "",
      GBRAID: subscriber.gbraid || existing.GBRAID || "",
      WBRAID: subscriber.wbraid || existing.WBRAID || "",
      FBCLID: subscriber.fbclid || existing.FBCLID || "",
      "Resend Contact ID": subscriber.resendContactId || existing["Resend Contact ID"] || "",
      "Jornada iniciada em": subscriber.journeyStartedAt || existing["Jornada iniciada em"] || "",
      "Descadastrado em": subscriber.status === "ativo" ? "" : existing["Descadastrado em"] || "",
      "User-Agent": subscriber.userAgent || existing["User-Agent"] || "",
      IP: subscriber.ip || existing.IP || "",
    };

    if (found) {
      await updateRow(
        sheets,
        config.newsletterSubscribersSheetName,
        SUBSCRIBERS_HEADERS,
        found.rowNumber,
        subscriberRowFromRecord(record)
      );
    } else {
      await appendRow(
        sheets,
        config.newsletterSubscribersSheetName,
        SUBSCRIBERS_HEADERS,
        subscriberRowFromRecord(record)
      );
    }

    return { ok: true, subscriberStatus, subscriber: record };
  } catch (error) {
    console.error("sheets: newsletter subscriber upsert failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

async function appendNewsletterEvent(event) {
  const sheets = getSheetsClient();
  if (!sheets) return { ok: false, reason: "sheets_not_configured" };

  try {
    await appendRow(sheets, config.newsletterEventsSheetName, NEWSLETTER_EVENTS_HEADERS, [
      event.recordedAt || new Date().toISOString(),
      event.type,
      normalizeEmail(event.email),
      event.name || "",
      event.source || "",
      event.sourceDetail || "",
      event.status || "",
      event.journeyStarted ? "Sim" : "Não",
      event.pageUrl || "",
      event.message || "",
      stringifyJson(event.payload),
    ]);
    return { ok: true };
  } catch (error) {
    console.error("sheets: newsletter event append failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

function hasPriorEvent(rows, event, eventType) {
  const email = normalizeEmail(event.email);
  const campaignKey = event.campaignKey || event.broadcastId || event.templateId || event.eventType;
  return rows.some(({ record }) => {
    return (
      record["Tipo do evento"] === eventType &&
      normalizeEmail(record.Email) === email &&
      (record["Campaign Key"] || record["Broadcast ID"] || record["Template ID"] || record["Tipo do evento"]) ===
        campaignKey
    );
  });
}

async function upsertEmailSummary(sheets, event, subscriber) {
  if (!event.email) return;
  const rows = await readRecords(sheets, config.newsletterEmailSummarySheetName, EMAIL_SUMMARY_HEADERS);
  const found = rows.find(({ record }) => normalizeEmail(record.Email) === normalizeEmail(event.email));
  const record = applyEmailSummaryEvent(found ? found.record : {}, event, subscriber);
  const row = recordToRow(EMAIL_SUMMARY_HEADERS, record);

  if (found) {
    await updateRow(sheets, config.newsletterEmailSummarySheetName, EMAIL_SUMMARY_HEADERS, found.rowNumber, row);
  } else {
    await appendRow(sheets, config.newsletterEmailSummarySheetName, EMAIL_SUMMARY_HEADERS, row);
  }
}

async function upsertCampaignSummary(sheets, event, existingEmailEvents) {
  if (!event.eventType.startsWith("email.")) return;
  const campaignKey = event.campaignKey || event.broadcastId || event.templateId || event.eventType;
  const rows = await readRecords(sheets, config.newsletterCampaignSummarySheetName, CAMPAIGN_SUMMARY_HEADERS);
  const found = rows.find(({ record }) => record["Campaign Key"] === campaignKey);
  const record = applyCampaignSummaryEvent(found ? found.record : {}, { ...event, campaignKey }, {
    isUniqueOpen: !hasPriorEvent(existingEmailEvents, { ...event, campaignKey }, "email.opened"),
    isUniqueClick: !hasPriorEvent(existingEmailEvents, { ...event, campaignKey }, "email.clicked"),
  });
  const row = recordToRow(CAMPAIGN_SUMMARY_HEADERS, record);

  if (found) {
    await updateRow(sheets, config.newsletterCampaignSummarySheetName, CAMPAIGN_SUMMARY_HEADERS, found.rowNumber, row);
  } else {
    await appendRow(sheets, config.newsletterCampaignSummarySheetName, CAMPAIGN_SUMMARY_HEADERS, row);
  }
}

async function appendNewsletterEmailEvent(event) {
  const sheets = getSheetsClient();
  if (!sheets) return { ok: false, reason: "sheets_not_configured" };

  try {
    const existingEmailEvents = await readRecords(
      sheets,
      config.newsletterEmailEventsSheetName,
      EMAIL_EVENT_HEADERS
    );
    const duplicate = existingEmailEvents.some(({ record }) => record["Webhook ID"] === event.webhookId);
    if (duplicate) {
      return { ok: true, duplicate: true };
    }

    const subscriberLookup = await findNewsletterSubscriber(event.email);
    const subscriber = subscriberLookup.ok && subscriberLookup.subscriber
      ? {
          email: subscriberLookup.subscriber.Email,
          name: subscriberLookup.subscriber.Nome,
          source: subscriberLookup.subscriber["Fonte inicial"],
          level: subscriberLookup.subscriber["Nível SQL"],
          subscribedAt: subscriberLookup.subscriber["Inscrito em"],
        }
      : { email: event.email };

    await appendRow(
      sheets,
      config.newsletterEmailEventsSheetName,
      EMAIL_EVENT_HEADERS,
      emailEventToRow(event)
    );
    await upsertEmailSummary(sheets, event, subscriber);
    await upsertCampaignSummary(sheets, event, existingEmailEvents);

    return { ok: true, duplicate: false };
  } catch (error) {
    console.error("sheets: newsletter email event append failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  CAMPAIGN_SUMMARY_HEADERS,
  EMAIL_EVENT_HEADERS,
  EMAIL_SUMMARY_HEADERS,
  NEWSLETTER_EVENTS_HEADERS,
  SUBSCRIBERS_HEADERS,
  appendNewsletterEmailEvent,
  appendNewsletterEvent,
  findNewsletterSubscriber,
  upsertNewsletterSubscriber,
};
