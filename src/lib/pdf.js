const fs = require("fs");

const MAX_EVENTS_IN_REPORT = 500;
const FALLBACK_VALUE = "n/a";

const PAGE_VIEW_EVENTS = new Set(["page_view", "first_visit", "session_start"]);
const ECOMMERCE_EVENTS = new Set([
  "view_promotion",
  "view_item",
  "view_item_list",
  "select_item",
  "select_promotion",
  "add_to_cart",
  "add_to_wishlist",
  "remove_from_cart",
  "begin_checkout",
  "add_payment_info",
  "add_shipping_info",
  "purchase",
  "refund",
  "view_cart",
]);
const ENGAGEMENT_EVENTS = new Set([
  "login",
  "sign_up",
  "share",
  "scroll",
  "file_download",
  "video_start",
  "video_progress",
  "video_complete",
  "form_start",
  "form_submit",
]);

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

function getParams(event) {
  if (!event || !event.params || Array.isArray(event.params) || typeof event.params !== "object") {
    return {};
  }
  return event.params;
}

function getParam(event, ...keys) {
  const params = getParams(event);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== null && params[key] !== undefined) {
      return params[key];
    }
  }
  return undefined;
}

function deriveCategory(eventName) {
  const normalized = String(eventName || "").toLowerCase().trim();
  if (PAGE_VIEW_EVENTS.has(normalized)) {
    return "Page view";
  }
  if (ECOMMERCE_EVENTS.has(normalized)) {
    return "E-commerce";
  }
  if (ENGAGEMENT_EVENTS.has(normalized)) {
    return "Engagement";
  }
  return "Other";
}

function resolveEventPageUrl(event) {
  if (event && event.pageUrl) {
    return cleanText(event.pageUrl);
  }
  const fromParams = getParam(event, "page_location");
  return cleanText(fromParams);
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

function getItemsSummary(items) {
  if (Array.isArray(items)) {
    if (items.length === 0) {
      return "0 items";
    }
    const first = items[0];
    const firstName =
      first && typeof first === "object" && first.item_name ? ` (${cleanText(first.item_name, "", 80)})` : "";
    return `${items.length} items${firstName}`;
  }
  if (items && typeof items === "object") {
    const itemName = items.item_name ? cleanText(items.item_name, "", 80) : "";
    return itemName ? `1 item (${itemName})` : "1 item";
  }
  return FALLBACK_VALUE;
}

function buildKeyParamsSummary(event, category) {
  const params = getParams(event);
  if (!params || Object.keys(params).length === 0) {
    return "";
  }

  const parts = [];
  if (category === "E-commerce") {
    const transactionId = getParam(event, "transaction_id");
    const value = getParam(event, "value");
    const currency = getParam(event, "currency");
    const items = getParam(event, "items");

    if (transactionId !== undefined) {
      parts.push(`transaction_id: ${cleanText(transactionId, FALLBACK_VALUE, 80)}`);
    }
    if (value !== undefined) {
      parts.push(`value: ${cleanText(value, FALLBACK_VALUE, 40)}`);
    }
    if (currency !== undefined) {
      parts.push(`currency: ${cleanText(currency, FALLBACK_VALUE, 40)}`);
    }
    if (items !== undefined) {
      parts.push(`items: ${getItemsSummary(items)}`);
    }
  } else if (category === "Page view") {
    const pageLocation = getParam(event, "page_location");
    const pageTitle = getParam(event, "page_title");
    const pageReferrer = getParam(event, "page_referrer");

    if (pageLocation !== undefined) {
      parts.push(`page_location: ${truncate(pageLocation, 70)}`);
    }
    if (pageTitle !== undefined) {
      parts.push(`page_title: ${truncate(pageTitle, 50)}`);
    }
    if (pageReferrer !== undefined) {
      parts.push(`page_referrer: ${truncate(pageReferrer, 60)}`);
    }
  }

  return parts.join(" | ");
}

function drawFooter(doc, generatedAtText, pageNumber) {
  const currentX = doc.x;
  const currentY = doc.y;
  const footerY = doc.page.maxY() - 10;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.font("Helvetica").fontSize(8).fillColor("#6b7280");
  doc.text(
    `GA4 Inspector | Report generated at ${generatedAtText} | Page ${pageNumber}`,
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
  const headers = ["Timestamp", "Event name", "Category", "Measurement ID", "Page URL"];
  const colPercents = [0.18, 0.22, 0.12, 0.18, 0.3];
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

    const eventName = cleanText(event.eventName, "(unknown)", 256);
    const rowValues = [
      truncate(formatDate(event.timestamp), 34),
      truncate(eventName, 34),
      deriveCategory(eventName),
      truncate(cleanText(event.measurementId), 30),
      truncate(resolveEventPageUrl(event), 40),
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
  const cardHeight = 94;
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
    const category = deriveCategory(eventName);
    const timestamp = formatDate(event.timestamp);
    const pageUrl = truncate(resolveEventPageUrl(event), 80);

    const hitNumber = cleanText(getParam(event, "hit_number", "_n"), FALLBACK_VALUE, 40);
    const sessionCount = cleanText(
      getParam(event, "session_count", "sct", "ga_session_number"),
      FALLBACK_VALUE,
      40
    );
    const userId = cleanText(getParam(event, "user_id"), FALLBACK_VALUE, 80);

    const measurementId = cleanText(event.measurementId, FALLBACK_VALUE, 60);
    const clientId = cleanText(event.clientId || getParam(event, "client_id"), FALLBACK_VALUE, 80);
    const sessionId = cleanText(event.sessionId || getParam(event, "session_id"), FALLBACK_VALUE, 80);
    const keyParamsSummary = buildKeyParamsSummary(event, category);

    doc.save();
    doc.roundedRect(left, y, contentWidth, cardHeight, 3).lineWidth(0.6).stroke("#d1d5db");
    doc.restore();

    const padding = 8;
    const textWidth = contentWidth - padding * 2;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    doc.text(`${truncate(eventName, 50)} | ${category} | ${truncate(timestamp, 42)}`, left + padding, y + padding, {
      width: textWidth,
      lineBreak: false,
    });

    doc.font("Helvetica").fontSize(8.5).fillColor("#111827");
    doc.text(`Page URL: ${pageUrl}`, left + padding, y + padding + 13, {
      width: textWidth,
      lineBreak: false,
    });

    const colGap = 20;
    const colWidth = (textWidth - colGap) / 2;
    const identityTop = y + padding + 27;

    doc.font("Helvetica").fontSize(8).fillColor("#374151");
    doc.text(
      `Measurement ID: ${truncate(measurementId, 30)}\nClient ID: ${truncate(clientId, 30)}\nSession ID: ${truncate(
        sessionId,
        30
      )}`,
      left + padding,
      identityTop,
      {
        width: colWidth,
        lineGap: 1,
      }
    );

    doc.text(
      `Hit number: ${truncate(hitNumber, 30)}\nSession count: ${truncate(sessionCount, 30)}\nUser ID: ${truncate(
        userId,
        30
      )}`,
      left + padding + colWidth + colGap,
      identityTop,
      {
        width: colWidth,
        lineGap: 1,
      }
    );

    if (keyParamsSummary) {
      doc.save();
      doc.moveTo(left + padding, y + cardHeight - 24);
      doc.lineTo(left + contentWidth - padding, y + cardHeight - 24);
      doc.lineWidth(0.3).strokeColor("#e5e7eb").stroke();
      doc.restore();

      doc.font("Helvetica").fontSize(8).fillColor("#111827");
      doc.text(`Key params: ${truncate(keyParamsSummary, 170)}`, left + padding, y + cardHeight - 18, {
        width: textWidth,
        lineBreak: false,
      });
    }

    y += cardHeight + cardGap;
  });

  doc.y = y;
}

function buildPdf(doc, { events, sessionInfo, generatedAt, logoPath }) {
  const safeEvents = Array.isArray(events) ? events : [];
  const visibleEvents = safeEvents.slice(0, MAX_EVENTS_IN_REPORT);
  const safeSessionInfo =
    sessionInfo && typeof sessionInfo === "object" && !Array.isArray(sessionInfo) ? sessionInfo : {};

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
  doc.text("GA4 Inspector Report", left, topY, {
    width: contentWidth - 190,
  });

  doc.y = Math.max(doc.y, topY + 72);

  doc.font("Helvetica").fontSize(10).fillColor("#1f2937");
  doc.text(`Generated at: ${generatedAtText}`);

  if (safeSessionInfo.pageUrl) {
    doc.text(`Page URL: ${truncate(safeSessionInfo.pageUrl, 120)}`);
  }
  if (safeSessionInfo.userAgent) {
    doc.text(`User agent: ${truncate(safeSessionInfo.userAgent, 120)}`);
  }

  doc.y += 8;
  const summaryY = doc.y;
  const summaryHeight = 74;

  doc.save();
  doc.roundedRect(left, summaryY, contentWidth, summaryHeight, 4).fill("#f3f4f6");
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  doc.text("Summary", left + 12, summaryY + 10);

  doc.font("Helvetica").fontSize(10).fillColor("#1f2937");
  doc.text(`Total events: ${safeEvents.length}`, left + 12, summaryY + 30);
  doc.text(`Time range: ${formatTimeRange(safeEvents)}`, left + 12, summaryY + 46);

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
  }
}

module.exports = {
  buildPdf,
  MAX_EVENTS_IN_REPORT,
};
