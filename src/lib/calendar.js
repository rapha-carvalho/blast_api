const { google } = require("googleapis");

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "raphael.carvalho@blastgroup.org";
const SESSION_DURATION_MS = 60 * 60 * 1000;
const BRT_SLOT_HOURS = [12, 13];
const MIN_ADVANCE_MS = 4 * 60 * 60 * 1000;

function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/calendar"],
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

function isBusyAt(start, end, busyPeriods) {
  return busyPeriods.some((p) => {
    const s = new Date(p.start);
    const e = new Date(p.end);
    return start < e && end > s;
  });
}

function getDayOfWeekBRT(date) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? date.getDay();
}

async function getAvailableSlots(daysAhead = 30) {
  const auth = getAuth();
  if (!auth) {
    console.warn("Calendar: no Google credentials configured.");
    return [];
  }

  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();
  const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  let busyPeriods = [];
  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: "America/Sao_Paulo",
        items: [{ id: CALENDAR_ID }],
      },
    });
    busyPeriods = res.data.calendars?.[CALENDAR_ID]?.busy || [];
  } catch (e) {
    console.error("Calendar freeBusy error:", e.message);
    return [];
  }

  const slots = [];
  for (let i = 0; i <= daysAhead; i++) {
    const base = new Date(now);
    base.setUTCDate(base.getUTCDate() + i);

    for (const brtHour of BRT_SLOT_HOURS) {
      const slotStart = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), brtHour + 3, 0, 0, 0)
      );
      if (slotStart.getTime() - now.getTime() < MIN_ADVANCE_MS) continue;
      const dow = getDayOfWeekBRT(slotStart);
      if (dow === 0 || dow === 6) continue;
      const slotEnd = new Date(slotStart.getTime() + SESSION_DURATION_MS);
      if (!isBusyAt(slotStart, slotEnd, busyPeriods)) {
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }
    }
  }

  return slots;
}

async function createMentorshipEvent({ slotStart, slotEnd, buyerEmail, buyerName }) {
  const auth = getAuth();
  if (!auth) throw new Error("Google Calendar not configured");

  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary: `Mentoria BlastGroup — ${buyerName}`,
    description: [
      "Sessão de mentoria 1:1 com Raphael Carvalho.",
      "",
      `Cliente: ${buyerName}`,
      `Email: ${buyerEmail}`,
      "",
      "Tópicos: carreira em dados, analytics, SQL, Python, estratégia, stakeholders.",
    ].join("\n"),
    start: { dateTime: slotStart, timeZone: "America/Sao_Paulo" },
    end: { dateTime: slotEnd, timeZone: "America/Sao_Paulo" },
    attendees: [
      { email: CALENDAR_ID, organizer: true },
      { email: buyerEmail, displayName: buyerName },
    ],
    conferenceData: {
      createRequest: {
        requestId: `mentorship-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 30 },
      ],
    },
    guestsCanModifyEvent: false,
    guestsCanInviteOthers: false,
  };

  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event,
    conferenceDataVersion: 1,
    sendUpdates: "all",
  });

  return response.data;
}

module.exports = { getAvailableSlots, createMentorshipEvent };
