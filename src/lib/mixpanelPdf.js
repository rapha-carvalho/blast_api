const fs = require("fs");

const MAX_EVENTS_IN_REPORT = 500;
const MAX_WARNING_EVENTS = 300;
const FALLBACK_VALUE = "n/a";

function parseDate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDate(value) {
  const parsed = value instanceof Date ? value : parseDate(value);
  if (!parsed) {
    return FALLBACK_VALUE;
  }
  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function cleanText(value, fallback = FALLBACK_VALUE, maxLength = 2000) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const asString = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!asString) {
    return fallback;
  }
  if (asString.length <= maxLength) {
    return asString;
  }
  return asString.slice(0, maxLength);
}

function truncate(value, maxLength) {
  const normalized = cleanText(value);
  if (normalized === FALLBACK_VALUE) {
    return normalized;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getWarnings(event) {
  if (!event || !Array.isArray(event.warnings)) {
    return [];
  }
  return event.warnings
    .filter((warning) => warning !== null && warning !== undefined && warning !== "")
    .map((warning) => cleanText(warning, "", 500))
    .filter(Boolean)
    .slice(0, 25);
}

function formatTimeRange(events) {
  const parsed = events
    .map((event) => parseDate(event && event.timestamp))
    .filter((value) => value !== null);

  if (parsed.length === 0) {
    return FALLBACK_VALUE;
  }

  parsed.sort((a, b) => a.getTime() - b.getTime());
  return `${formatDate(parsed[0])} to ${formatDate(parsed[parsed.length - 1])}`;
}

function countUniqueEventNames(events) {
  const set = new Set();
  events.forEach((event) => {
    const name = cleanText(event && event.eventName, "", 256).trim().toLowerCase();
    if (name) {
      set.add(name);
    }
  });
  return set.size;
}

function countWarnings(events) {
  return events.reduce((total, event) => total + getWarnings(event).length, 0);
}

function serializeParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return FALLBACK_VALUE;
  }
  const entries = Object.entries(params).slice(0, 25);
  if (entries.length === 0) {
    return FALLBACK_VALUE;
  }
  const compact = entries.map(([key, value]) => `${cleanText(key, "key", 40)}=${cleanText(value, "null", 80)}`);
  return compact.join(" | ");
}

function drawFooter(doc, generatedAtText, pageNumber) {
  const currentX = doc.x;
  const currentY = doc.y;
  const footerY = doc.page.maxY() - 10;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.font("Helvetica").fontSize(8).fillColor("#6b7280");
  doc.text(
    `Mixpanel Inspector | Report generated at ${generatedAtText} | Page ${pageNumber}`,
    doc.page.margins.left,
    footerY,
    { width, lineBreak: false }
  );
  doc.restore();

  doc.x = currentX;
  doc.y = currentY;
}

function drawLogoBlock(doc, logoPath, topY, contentWidth) {
  const logoBlockWidth = 170;
  const logoX = doc.page.margins.left + contentWidth - logoBlockWidth;

  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, logoX + 18, topY, {
        fit: [150, 50],
        align: "right",
      });
    } catch (error) {
      // Invalid image should not fail report generation.
    }
  }

  doc.save();
  doc.font("Helvetica").fontSize(9).fillColor("#4b5563");
  doc.text("Powered by BlastGroup", logoX, topY + 55, {
    width: logoBlockWidth,
    align: "right",
  });
  doc.restore();
}

function drawEventsTable(doc, events, contentWidth) {
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 50;
  const headers = ["Timestamp", "Event name", "Source", "Endpoint", "Distinct ID", "Page URL"];
  const colPercents = [0.17, 0.22, 0.12, 0.12, 0.15, 0.22];
  const colWidths = colPercents.map((pct) => Math.floor(contentWidth * pct));
  colWidths[colWidths.length - 1] += contentWidth - colWidths.reduce((sum, value) => sum + value, 0);

  const colX = [];
  let runningX = left;
  for (const width of colWidths) {
    colX.push(runningX);
    runningX += width;
  }

  const headerHeight = 18;
  const rowHeight = 16;
  let y = doc.y + 8;

  const drawHeader = () => {
    doc.save();
    doc.rect(left, y, contentWidth, headerHeight).fill("#e5e7eb");
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");
    headers.forEach((label, index) => {
      doc.text(label, colX[index] + 4, y + 5, {
        width: colWidths[index] - 8,
        lineBreak: false,
      });
    });
    y += headerHeight;
  };

  if (y + headerHeight > bottomLimit()) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  drawHeader();

  events.forEach((event, index) => {
    if (y + rowHeight > bottomLimit()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    if (index % 2 === 1) {
      doc.save();
      doc.rect(left, y, contentWidth, rowHeight).fill("#f9fafb");
      doc.restore();
    }

    const rowValues = [
      truncate(formatDate(event.timestamp), 34),
      truncate(cleanText(event.eventName, "(unknown)", 256), 34),
      truncate(cleanText(event.source, FALLBACK_VALUE, 40), 18),
      truncate(cleanText(event.endpointType, FALLBACK_VALUE, 40), 18),
      truncate(cleanText(event.distinctId || event.clientId, FALLBACK_VALUE, 80), 24),
      truncate(cleanText(event.pageUrl, FALLBACK_VALUE, 4000), 34),
    ];

    doc.font("Helvetica").fontSize(8.5).fillColor("#111827");
    rowValues.forEach((value, columnIndex) => {
      doc.text(value, colX[columnIndex] + 4, y + 4, {
        width: colWidths[columnIndex] - 8,
        lineBreak: false,
      });
    });

    y += rowHeight;
  });

  doc.y = y + 8;
}

function drawEventDetails(doc, events, contentWidth) {
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 50;
  const cardHeight = 108;
  const cardGap = 8;

  const drawHeading = (continued) => {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827");
    doc.text(continued ? "Event details (cont.)" : "Event details", left, doc.y + 6);
    doc.y += 4;
  };

  drawHeading(false);
  let y = doc.y + 8;

  events.forEach((event) => {
    if (y + cardHeight > bottomLimit()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeading(true);
      y = doc.y + 8;
    }

    const eventName = cleanText(event.eventName, "(unknown)", 256);
    const timestamp = formatDate(event.timestamp);
    const pageUrl = truncate(cleanText(event.pageUrl, FALLBACK_VALUE, 4000), 95);
    const params = truncate(serializeParams(event.params), 180);
    const warnings = getWarnings(event);
    const warningSummary = warnings.length > 0 ? truncate(warnings.join(" | "), 180) : "None";

    doc.save();
    doc.roundedRect(left, y, contentWidth, cardHeight, 3).lineWidth(0.6).stroke("#d1d5db");
    doc.restore();

    const padding = 8;
    const textWidth = contentWidth - padding * 2;
    const colGap = 16;
    const colWidth = (textWidth - colGap) / 2;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    doc.text(`${truncate(eventName, 48)} | ${truncate(timestamp, 45)}`, left + padding, y + padding, {
      width: textWidth,
      lineBreak: false,
    });

    doc.font("Helvetica").fontSize(8).fillColor("#374151");
    doc.text(
      `Project token: ${truncate(cleanText(event.projectToken, FALLBACK_VALUE, 90), 35)}\nDistinct ID: ${truncate(
        cleanText(event.distinctId, FALLBACK_VALUE, 120),
        35
      )}\nSession ID: ${truncate(cleanText(event.sessionId, FALLBACK_VALUE, 120), 35)}`,
      left + padding,
      y + padding + 14,
      {
        width: colWidth,
        lineGap: 1,
      }
    );

    doc.text(
      `Client ID: ${truncate(cleanText(event.clientId, FALLBACK_VALUE, 120), 35)}\nMeasurement ID: ${truncate(
        cleanText(event.measurementId, FALLBACK_VALUE, 120),
        35
      )}\nTab ID: ${truncate(cleanText(event.tabId, FALLBACK_VALUE, 40), 35)}`,
      left + padding + colWidth + colGap,
      y + padding + 14,
      {
        width: colWidth,
        lineGap: 1,
      }
    );

    doc.font("Helvetica").fontSize(8.2).fillColor("#111827");
    doc.text(
      `Source: ${truncate(cleanText(event.source, FALLBACK_VALUE, 80), 25)} | Endpoint: ${truncate(
        cleanText(event.endpointType, FALLBACK_VALUE, 80),
        25
      )}`,
      left + padding,
      y + cardHeight - 38,
      {
        width: textWidth,
        lineBreak: false,
      }
    );

    doc.text(`Page URL: ${pageUrl}`, left + padding, y + cardHeight - 26, {
      width: textWidth,
      lineBreak: false,
    });
    doc.text(`Params: ${params}`, left + padding, y + cardHeight - 14, {
      width: textWidth,
      lineBreak: false,
    });

    if (warningSummary !== "None") {
      doc.font("Helvetica").fontSize(8).fillColor("#7f1d1d");
      doc.text(`Warnings: ${warningSummary}`, left + padding, y + cardHeight - 2, {
        width: textWidth,
        lineBreak: false,
      });
    }

    y += cardHeight + cardGap;
  });

  doc.y = y;
}

function drawWarningsSection(doc, eventsWithWarnings, contentWidth) {
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 45;
  const lineHeight = 14;

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827");
  doc.text("Diagnostics / warnings", left, doc.y + 6);
  doc.y += 10;

  if (eventsWithWarnings.length === 0) {
    doc.font("Helvetica").fontSize(9.5).fillColor("#4b5563");
    doc.text("No warnings captured in this request.", left, doc.y + 8);
    return;
  }

  let y = doc.y + 8;
  eventsWithWarnings.forEach((event, index) => {
    if (y + lineHeight > bottomLimit()) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827");
      doc.text("Diagnostics / warnings (cont.)", left, y);
      y = doc.y + 8;
    }

    const warnings = getWarnings(event).join(" | ");
    const line = `${index + 1}. ${truncate(cleanText(event.eventName, "(unknown)", 256), 40)} @ ${truncate(
      formatDate(event.timestamp),
      40
    )} => ${truncate(warnings, 130)}`;

    doc.font("Helvetica").fontSize(8.5).fillColor("#1f2937");
    doc.text(line, left, y, {
      width: contentWidth,
      lineBreak: false,
    });
    y += lineHeight;
  });

  doc.y = y;
}

function buildMixpanelPdf(doc, { events, sessionInfo, generatedAt, source, logoPath }) {
  const safeEvents = Array.isArray(events) ? events : [];
  const visibleEvents = safeEvents.slice(0, MAX_EVENTS_IN_REPORT);
  const safeSessionInfo =
    sessionInfo && typeof sessionInfo === "object" && !Array.isArray(sessionInfo) ? sessionInfo : {};
  const eventsWithWarnings = safeEvents.filter((event) => getWarnings(event).length > 0).slice(0, MAX_WARNING_EVENTS);

  let pageNumber = 0;
  const generatedAtText = formatDate(generatedAt);
  doc.on("pageAdded", () => {
    pageNumber += 1;
    drawFooter(doc, generatedAtText, pageNumber);
  });

  doc.addPage();

  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const topY = doc.y;

  drawLogoBlock(doc, logoPath, topY, contentWidth);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827");
  doc.text("Mixpanel Inspector Report", left, topY, {
    width: contentWidth - 190,
  });

  doc.y = Math.max(doc.y, topY + 72);

  doc.font("Helvetica").fontSize(10).fillColor("#1f2937");
  doc.text(`Generated at: ${generatedAtText}`);
  doc.text(`Source: ${truncate(cleanText(source, "extension", 64), 80)}`);

  if (safeSessionInfo.pageUrl) {
    doc.text(`Page URL: ${truncate(safeSessionInfo.pageUrl, 120)}`);
  }
  if (safeSessionInfo.userAgent) {
    doc.text(`User agent: ${truncate(safeSessionInfo.userAgent, 120)}`);
  }

  doc.y += 8;
  const summaryY = doc.y;
  const summaryHeight = 86;

  doc.save();
  doc.roundedRect(left, summaryY, contentWidth, summaryHeight, 4).fill("#f3f4f6");
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  doc.text("Summary", left + 12, summaryY + 10);

  doc.font("Helvetica").fontSize(10).fillColor("#1f2937");
  doc.text(`Total events: ${safeEvents.length}`, left + 12, summaryY + 30);
  doc.text(`Unique event names: ${countUniqueEventNames(safeEvents)}`, left + 12, summaryY + 46);
  doc.text(`Warning count: ${countWarnings(safeEvents)}`, left + 300, summaryY + 30);
  doc.text(`Time range: ${formatTimeRange(safeEvents)}`, left + 300, summaryY + 46, {
    width: contentWidth - 312,
    lineBreak: false,
  });

  doc.y = summaryY + summaryHeight + 24;

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827");
  doc.text("Events");

  if (visibleEvents.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
    doc.text("No events available for this report.", left, doc.y + 10);
    return;
  }

  drawEventsTable(doc, visibleEvents, contentWidth);

  if (safeEvents.length > MAX_EVENTS_IN_REPORT) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#6b7280");
    doc.text(
      `Showing first ${MAX_EVENTS_IN_REPORT} of ${safeEvents.length} events. Export a smaller time range for full detail.`,
      left,
      doc.y + 2
    );
    doc.y += 8;
  }

  drawEventDetails(doc, visibleEvents, contentWidth);

  if (safeEvents.length > MAX_EVENTS_IN_REPORT) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#6b7280");
    doc.text(
      `Details limited to first ${MAX_EVENTS_IN_REPORT} of ${safeEvents.length} events.`,
      left,
      doc.y + 2
    );
    doc.y += 8;
  }

  drawWarningsSection(doc, eventsWithWarnings, contentWidth);

  if (safeEvents.filter((event) => getWarnings(event).length > 0).length > MAX_WARNING_EVENTS) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#6b7280");
    doc.text(
      `Diagnostics limited to first ${MAX_WARNING_EVENTS} events with warnings.`,
      left,
      doc.y + 4
    );
  }
}

module.exports = {
  buildMixpanelPdf,
  MAX_EVENTS_IN_REPORT,
};
