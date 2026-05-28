const { google } = require("googleapis");

const WAITLIST_SPREADSHEET_ID =
  process.env.MENTORSHIP_WAITLIST_SPREADSHEET_ID || "1t-5si3mrSK81yBYOeuvKlraKTAuzv2BRj-L1jiQODeM";
const WAITLIST_SHEET_NAME = process.env.MENTORSHIP_WAITLIST_SHEET_NAME || "Inscricoes";
const SQL_CHEATSHEET_SPREADSHEET_ID =
  process.env.SQL_CHEATSHEET_SPREADSHEET_ID || "1rKPDMGBNclAdWzM3P5L59nbvR7Z_pusB4zR1-3gmcVY";
const SQL_CHEATSHEET_SHEET_NAME = process.env.SQL_CHEATSHEET_SHEET_NAME || "Acessos";

const WAITLIST_HEADERS = [
  "Enviado em",
  "Nome",
  "Email",
  "WhatsApp",
  "Area atual",
  "Maior dificuldade",
  "Ferramentas",
  "Consentimento LGPD",
  "Pagina",
  "User-Agent",
  "IP",
];

const SQL_CHEATSHEET_HEADERS = [
  "Acessado em",
  "Nome",
  "Email",
  "Nivel",
  "Cargo ou interesse",
  "Consentimento LGPD",
  "Origem",
  "Pagina",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "UTM Content",
  "UTM Term",
  "GCLID",
  "GBRAID",
  "WBRAID",
  "FBCLID",
  "User-Agent",
  "IP",
];

function getSheetsAuth() {
  const serviceAccountEmail =
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;

  if (serviceAccountEmail && privateKey) {
    return new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return oauth2;
  }

  return null;
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

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function ensureSheetWithHeaders(sheets, spreadsheetId, sheetName, headers) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });

  const existingSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  }

  const lastColumn = toColumnName(headers.length);
  const headerRange = `${quoteSheetName(sheetName)}!A1:${lastColumn}1`;
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const currentHeaders = headerResponse.data.values?.[0] || [];
  const missingOrDifferent = headers.some((header, index) => currentHeaders[index] !== header);

  if (missingOrDifferent) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

async function appendWaitlistSubmission(submission) {
  const auth = getSheetsAuth();
  if (!auth) {
    console.warn("sheets: Google credentials not set; skipping waitlist append.");
    return { ok: false, reason: "sheets_not_configured" };
  }

  try {
    const sheets = google.sheets({ version: "v4", auth });
    await ensureSheetWithHeaders(
      sheets,
      WAITLIST_SPREADSHEET_ID,
      WAITLIST_SHEET_NAME,
      WAITLIST_HEADERS
    );

    const row = [
      submission.submittedAt,
      submission.name,
      submission.email,
      submission.whatsapp,
      submission.currentArea,
      submission.biggestChallenge,
      submission.tools.join(", "),
      submission.consent ? "Sim" : "Nao",
      submission.pageUrl,
      submission.userAgent,
      submission.ip,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: WAITLIST_SPREADSHEET_ID,
      range: `${quoteSheetName(WAITLIST_SHEET_NAME)}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    return { ok: true };
  } catch (error) {
    console.error("sheets: waitlist append failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

async function appendSqlCheatsheetAccess(access) {
  const auth = getSheetsAuth();
  if (!auth) {
    console.warn("sheets: Google credentials not set; skipping SQL cheatsheet access append.");
    return { ok: false, reason: "sheets_not_configured" };
  }

  try {
    const sheets = google.sheets({ version: "v4", auth });
    await ensureSheetWithHeaders(
      sheets,
      SQL_CHEATSHEET_SPREADSHEET_ID,
      SQL_CHEATSHEET_SHEET_NAME,
      SQL_CHEATSHEET_HEADERS
    );

    const row = [
      access.accessedAt,
      access.name,
      access.email,
      access.level,
      access.role,
      access.consent ? "Sim" : "Nao",
      access.source,
      access.pageUrl,
      access.utmSource,
      access.utmMedium,
      access.utmCampaign,
      access.utmContent,
      access.utmTerm,
      access.gclid,
      access.gbraid,
      access.wbraid,
      access.fbclid,
      access.userAgent,
      access.ip,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SQL_CHEATSHEET_SPREADSHEET_ID,
      range: `${quoteSheetName(SQL_CHEATSHEET_SHEET_NAME)}!A:S`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    return { ok: true };
  } catch (error) {
    console.error("sheets: SQL cheatsheet access append failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  appendWaitlistSubmission,
  appendSqlCheatsheetAccess,
  WAITLIST_SHEET_NAME,
  WAITLIST_SPREADSHEET_ID,
  SQL_CHEATSHEET_SHEET_NAME,
  SQL_CHEATSHEET_SPREADSHEET_ID,
};
