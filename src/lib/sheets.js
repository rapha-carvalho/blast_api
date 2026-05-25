const { google } = require("googleapis");

const WAITLIST_SPREADSHEET_ID =
  process.env.MENTORSHIP_WAITLIST_SPREADSHEET_ID || "1t-5si3mrSK81yBYOeuvKlraKTAuzv2BRj-L1jiQODeM";
const WAITLIST_SHEET_NAME = process.env.MENTORSHIP_WAITLIST_SHEET_NAME || "Inscricoes";

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

async function ensureWaitlistSheet(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: WAITLIST_SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });

  const existingSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === WAITLIST_SHEET_NAME
  );

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: WAITLIST_SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: WAITLIST_SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }

  const headerRange = `${WAITLIST_SHEET_NAME}!A1:K1`;
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: WAITLIST_SPREADSHEET_ID,
    range: headerRange,
  });

  const currentHeaders = headerResponse.data.values?.[0] || [];
  const missingOrDifferent = WAITLIST_HEADERS.some((header, index) => currentHeaders[index] !== header);

  if (missingOrDifferent) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: WAITLIST_SPREADSHEET_ID,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: { values: [WAITLIST_HEADERS] },
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
    await ensureWaitlistSheet(sheets);

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
      range: `${WAITLIST_SHEET_NAME}!A:K`,
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

module.exports = {
  appendWaitlistSubmission,
  WAITLIST_SHEET_NAME,
  WAITLIST_SPREADSHEET_ID,
};
