const crypto = require("crypto");
const https = require("https");
const config = require("../config");

const META_EVENT_NAME_MAP = {
  page_view: "PageView",
  view_content: "ViewContent",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
  cta_click: "BlastCtaClick",
  generate_lead: "Lead",
  newsletter_subscribe: "Subscribe",
  cheatsheet_primary_cta_click: "BlastCheatsheetPrimaryCtaClick",
  cheatsheet_form_start: "BlastCheatsheetFormStart",
  cheatsheet_gate_view: "BlastCheatsheetGateView",
  cheatsheet_unlock: "BlastCheatsheetUnlock",
  cheatsheet_access: "BlastCheatsheetAccess",
  cheatsheet_print: "BlastCheatsheetPrint",
  cheatsheet_copy_code: "BlastCheatsheetCopyCode",
  cheatsheet_video_ad_view: "BlastCheatsheetVideoAdView",
  cheatsheet_video_interaction: "BlastCheatsheetVideoInteraction",
  cheatsheet_mobile_preview_view: "BlastCheatsheetMobilePreviewView",
  cheatsheet_mobile_expand: "BlastCheatsheetMobileExpand",
  cheatsheet_mobile_close: "BlastCheatsheetMobileClose",
  section_view: "BlastSectionView",
  sticky_cta_view: "BlastStickyCtaView",
  sticky_cta_click: "BlastStickyCtaClick",
  exit_intent_show: "BlastExitIntentShow",
  exit_intent_impression: "BlastExitIntentImpression",
  exit_intent_dismiss: "BlastExitIntentDismiss",
  exit_intent_cta_click: "BlastExitIntentCtaClick",
};

const COURSE_CHECKOUT_CTA_EVENT_NAMES = new Set([
  "cta_click",
  "sticky_cta_click",
  "exit_intent_cta_click",
]);

function looksLikeCheckoutUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  try {
    const url = new URL(text, "https://blastgroup.org");
    return url.pathname.startsWith("/checkout/");
  } catch {
    return text.includes("/checkout/");
  }
}

function isBlastgroupCourseCheckoutCta(trackingEvent) {
  const metadata = trackingEvent.metadata || {};

  if (trackingEvent.source_app !== "blastgroup_site") {
    return false;
  }

  if (!COURSE_CHECKOUT_CTA_EVENT_NAMES.has(trackingEvent.event_name)) {
    return false;
  }

  if (String(metadata.page_type || "") !== "course_landing") {
    return false;
  }

  if (String(metadata.content_category || "") !== "course") {
    return false;
  }

  return looksLikeCheckoutUrl(metadata.cta_destination);
}

function resolveMetaEventName(trackingEvent) {
  if (isBlastgroupCourseCheckoutCta(trackingEvent)) {
    return "AddToCart";
  }

  return META_EVENT_NAME_MAP[trackingEvent.event_name];
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildMetaUserData(trackingEvent) {
  const userData = {};
  const email = normalizeEmail(trackingEvent.user && trackingEvent.user.email);
  if (email) {
    userData.em = [sha256(email)];
  }
  if (trackingEvent.client && trackingEvent.client.ip_address) {
    userData.client_ip_address = trackingEvent.client.ip_address;
  }
  if (trackingEvent.client && trackingEvent.client.user_agent) {
    userData.client_user_agent = trackingEvent.client.user_agent;
  }
  if (trackingEvent.client && trackingEvent.client.fbp) {
    userData.fbp = trackingEvent.client.fbp;
  }
  if (trackingEvent.client && trackingEvent.client.fbc) {
    userData.fbc = trackingEvent.client.fbc;
  }
  return userData;
}

function buildMetaCustomData(trackingEvent) {
  if (trackingEvent.event_name === "page_view") {
    return undefined;
  }

  const commerce = trackingEvent.commerce || {};
  const metadata = trackingEvent.metadata || {};
  const isProductIntentEvent =
    trackingEvent.event_name === "view_content" || isBlastgroupCourseCheckoutCta(trackingEvent);
  const items = Array.isArray(commerce.items) ? commerce.items : [];
  const primaryItem = items[0] || {};
  const contentId = metadata.content_id;
  const customData = {
    currency: commerce.currency,
    value: commerce.value,
    order_id: commerce.transaction_id,
    content_name: commerce.item_name || primaryItem.item_name || metadata.content_name,
    content_ids:
      items
        .map((item) => item.item_id)
        .filter(Boolean)
        .concat(contentId ? [contentId] : []),
    content_category: metadata.content_category,
    content_type: isProductIntentEvent ? "product" : undefined,
    num_items: items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0) || undefined,
    contents: items.map((item) => ({
      id: item.item_id,
      quantity: Number(item.quantity) || 1,
      item_price: Number.isFinite(item.price) ? item.price : undefined,
    })),
    coupon: commerce.coupon || metadata.coupon,
    page_type: metadata.page_type,
    cta_text: metadata.cta_text,
    cta_section: metadata.cta_section,
    cta_destination: metadata.cta_destination,
    section_name: metadata.section_name,
    trigger: metadata.trigger,
    reason: metadata.reason,
  };

  return Object.fromEntries(
    Object.entries(customData).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
  );
}

function buildMetaPayload(trackingEvent) {
  const metaEventName = resolveMetaEventName(trackingEvent);
  return {
    data: [
      {
        event_name: metaEventName,
        event_time: Math.round(Number(trackingEvent.event_time)),
        event_id: trackingEvent.event_id,
        action_source: "website",
        event_source_url: trackingEvent.client && trackingEvent.client.page_location,
        user_data: buildMetaUserData(trackingEvent),
        custom_data: buildMetaCustomData(trackingEvent),
      },
    ],
    ...(config.metaTestEventCode ? { test_event_code: config.metaTestEventCode } : {}),
  };
}

function cleanString(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getGa4Identity(trackingEvent) {
  const clientId = cleanString(trackingEvent.client && trackingEvent.client.ga_client_id);
  const sessionId = toPositiveNumber(trackingEvent.client && trackingEvent.client.ga_session_id);
  return { clientId, sessionId };
}

function getGa4EventName(trackingEvent) {
  if (trackingEvent.event_name === "view_content" && trackingEvent.source_app === "blastgroup_site") {
    return "view_item";
  }
  return trackingEvent.event_name;
}

function buildCampaignDetailsParams(trackingEvent) {
  const attribution = trackingEvent.attribution || {};
  const params = {
    campaign_id: attribution.utm_id,
    campaign: attribution.utm_campaign,
    source: attribution.utm_source,
    medium: attribution.utm_medium,
    term: attribution.utm_term,
    content: attribution.utm_content,
  };

  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );

  if (!cleaned.campaign_id && !cleaned.campaign && !cleaned.source && !cleaned.medium) {
    return undefined;
  }

  return cleaned;
}

function buildGa4EventParams(trackingEvent) {
  const commerce = trackingEvent.commerce || {};
  const attribution = trackingEvent.attribution || {};
  const metadata = trackingEvent.metadata || {};
  const identity = getGa4Identity(trackingEvent);
  const client = trackingEvent.client || {};
  const params = {
    session_id: identity.sessionId,
    session_started_at: client.session_started_at,
    engagement_time_msec: 1,
    currency: commerce.currency,
    value: commerce.value,
    coupon: commerce.coupon,
    transaction_id: commerce.transaction_id,
    checkout_intent_id: commerce.checkout_intent_id,
    stripe_checkout_session_id: commerce.stripe_checkout_session_id,
    installment_count: commerce.installment_count,
    items: Array.isArray(commerce.items)
      ? commerce.items.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          item_category: item.item_category,
          price: item.price,
          quantity: item.quantity,
        }))
      : undefined,
    page_location: client.page_location,
    page_referrer: client.referrer || client.landing_referrer,
    page_title: metadata.page_title || client.page_title,
    page_path: metadata.page_path,
    landing_page_location: client.landing_page_location,
    landing_page_path: metadata.landing_page_path,
    landing_referrer: client.landing_referrer,
    page_type: metadata.page_type,
    content_name: metadata.content_name,
    content_category: metadata.content_category,
    content_id: metadata.content_id,
    cta_text: metadata.cta_text,
    cta_section: metadata.cta_section,
    cta_destination: metadata.cta_destination,
    section_name: metadata.section_name,
    trigger: metadata.trigger,
    reason: metadata.reason,
    utm_id: attribution.utm_id,
    source: attribution.utm_source,
    medium: attribution.utm_medium,
    campaign: attribution.utm_campaign,
    term: attribution.utm_term,
    content: attribution.utm_content,
    gclid: attribution.gclid,
    gbraid: attribution.gbraid,
    wbraid: attribution.wbraid,
    debug_mode: config.trackingDebugEnabled ? 1 : undefined,
  };

  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
  );
}

function buildGa4Payload(trackingEvent) {
  const identity = getGa4Identity(trackingEvent);
  if (!identity.clientId || !identity.sessionId) {
    return undefined;
  }

  const eventName = getGa4EventName(trackingEvent);
  const events = [];
  const campaignDetailsParams = buildCampaignDetailsParams(trackingEvent);
  if (campaignDetailsParams) {
    events.push({
      name: "campaign_details",
      params: {
        session_id: identity.sessionId,
        engagement_time_msec: 1,
        ...campaignDetailsParams,
      },
    });
  }

  events.push({
    name: eventName,
    params: buildGa4EventParams(trackingEvent),
  });

  return {
    client_id: identity.clientId,
    timestamp_micros: Math.round(Number(trackingEvent.event_time) * 1000 * 1000),
    events,
    ...(config.trackingGa4ValidateEvents
      ? { validation_behavior: "ENFORCE_RECOMMENDATIONS" }
      : {}),
  };
}

function getGa4SkipReason(trackingEvent) {
  if (trackingEvent.event_name !== "page_view") {
    return undefined;
  }

  if (trackingEvent.source_app === "blast_sql_vertical") {
    return "ga4_browser_owned_event";
  }

  if (trackingEvent.source_app === "blastgroup_site" && trackingEvent.ga4_browser_page_view) {
    return "ga4_browser_owned_event";
  }

  return undefined;
}

function postJson(urlString, body, headers = {}, timeoutMs = 5000) {
  const url = new URL(urlString);
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let parsedBody = null;
          if (rawBody) {
            try {
              parsedBody = JSON.parse(rawBody);
            } catch {
              parsedBody = rawBody;
            }
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode,
              body: parsedBody,
            });
            return;
          }

          const error = new Error(`HTTP ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.body = parsedBody;
          reject(error);
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Request timed out"));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function sendMetaEvent(trackingEvent) {
  if (!config.metaPixelId || !config.metaAccessToken) {
    return { status: "skipped", reason: "meta_not_configured" };
  }

  if (!resolveMetaEventName(trackingEvent)) {
    return { status: "skipped", reason: "meta_event_not_mapped" };
  }

  const payload = buildMetaPayload(trackingEvent);
  const url = `https://graph.facebook.com/v22.0/${encodeURIComponent(config.metaPixelId)}/events?access_token=${encodeURIComponent(config.metaAccessToken)}`;
  const response = await postJson(url, payload, {}, config.trackingDispatchTimeoutMs);
  return {
    status: "sent",
    http_status: response.statusCode,
    response: response.body || undefined,
  };
}

async function sendGa4Event(trackingEvent) {
  if (!config.ga4MeasurementId || !config.ga4ApiSecret) {
    return { status: "skipped", reason: "ga4_not_configured" };
  }

  const skipReason = getGa4SkipReason(trackingEvent);
  if (skipReason) {
    return { status: "skipped", reason: skipReason };
  }

  const payload = buildGa4Payload(trackingEvent);
  if (!payload) {
    return { status: "skipped", reason: "missing_ga4_client_or_session_id" };
  }

  const collectPath = config.trackingGa4ValidateEvents ? "/debug/mp/collect" : "/mp/collect";
  const url = `https://www.google-analytics.com${collectPath}?measurement_id=${encodeURIComponent(config.ga4MeasurementId)}&api_secret=${encodeURIComponent(config.ga4ApiSecret)}`;
  const response = await postJson(url, payload, {}, config.trackingDispatchTimeoutMs);
  return {
    status: "sent",
    http_status: response.statusCode,
    response: response.body || undefined,
  };
}

async function dispatchTrackingEvent(trackingEvent) {
  const [metaResult, ga4Result] = await Promise.all([
    sendMetaEvent(trackingEvent),
    sendGa4Event(trackingEvent),
  ]);

  return {
    event_name: trackingEvent.event_name,
    event_id: trackingEvent.event_id,
    idempotency_key: trackingEvent.idempotency_key,
    destinations: {
      meta: metaResult,
      ga4: ga4Result,
    },
  };
}

module.exports = {
  dispatchTrackingEvent,
  _test: {
    buildCampaignDetailsParams,
    buildGa4EventParams,
    buildGa4Payload,
    getGa4SkipReason,
    getGa4Identity,
  },
};
