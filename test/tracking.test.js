const test = require("node:test");
const assert = require("node:assert/strict");

const siteTrackingRouter = require("../src/routes/siteTracking");
const trackingDispatch = require("../src/lib/trackingDispatch");

function makeTrackingEvent(overrides = {}) {
  return {
    source_app: "blastgroup_site",
    event_name: "view_content",
    event_id: "evt_1",
    event_time: 1760000000,
    idempotency_key: "evt_1",
    client: {
      page_location: "https://blastgroup.org/cursos/sql-zero-avancado/?utm_source=google",
      referrer: "",
      ga_client_id: "123456.1760000000",
      ga_session_id: "1760000000",
      session_started_at: 1760000000,
      landing_page_location: "https://blastgroup.org/cursos/sql-zero-avancado/?utm_source=google",
      landing_referrer: "",
    },
    attribution: {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "sql_course",
      utm_content: "hero",
      utm_term: "sql",
      gclid: "test-gclid",
    },
    metadata: {
      page_path: "/cursos/sql-zero-avancado/?utm_source=google",
      landing_page_path: "/cursos/sql-zero-avancado/?utm_source=google",
      page_title: "SQL do Zero ao Avancado | Blast",
      page_type: "course_landing",
      content_name: "SQL do Zero ao Avancado",
      content_category: "course",
      content_id: "sql-zero-avancado",
    },
    commerce: {
      currency: "BRL",
      value: 249,
      items: [
        {
          item_id: "sql-zero-avancado",
          item_name: "SQL do Zero ao Avancado",
          item_category: "course",
          price: 249,
          quantity: 1,
        },
      ],
    },
    ...overrides,
  };
}

test("GA4 payload is skipped when client_id is missing", () => {
  const event = makeTrackingEvent({
    client: {
      ...makeTrackingEvent().client,
      ga_client_id: "",
    },
  });

  assert.equal(trackingDispatch._test.buildGa4Payload(event), undefined);
});

test("GA4 payload is skipped when session_id is missing or invalid", () => {
  const event = makeTrackingEvent({
    client: {
      ...makeTrackingEvent().client,
      ga_session_id: "abc",
    },
  });

  assert.equal(trackingDispatch._test.buildGa4Payload(event), undefined);
});

test("GA4 payload sends campaign_details before the mapped event", () => {
  const payload = trackingDispatch._test.buildGa4Payload(makeTrackingEvent());

  assert.equal(payload.client_id, "123456.1760000000");
  assert.equal(payload.events[0].name, "campaign_details");
  assert.equal(payload.events[0].params.source, "google");
  assert.equal(payload.events[0].params.medium, "cpc");
  assert.equal(payload.events[1].name, "view_item");
  assert.equal(payload.events[1].params.session_id, 1760000000);
  assert.equal(payload.events[1].params.engagement_time_msec, 1);
});

test("GA4 page_view is skipped when browser GA4 owns the page view", () => {
  const event = makeTrackingEvent({
    event_name: "page_view",
    ga4_browser_page_view: true,
  });

  assert.equal(trackingDispatch._test.getGa4SkipReason(event), "ga4_browser_owned_event");
});

test("site tracking exposes only public browser config", () => {
  const publicConfig = siteTrackingRouter._test.buildPublicTrackingConfig();

  assert.ok(Object.hasOwn(publicConfig, "ga4_measurement_id"));
  assert.ok(!Object.hasOwn(publicConfig, "ga4_api_secret"));
});

test("site tracking allows configured education subdomain", () => {
  const req = {
    headers: {
      origin: "https://education.blastgroup.org",
      "user-agent": "node-test",
    },
    ip: "127.0.0.1",
    body: {
      event_name: "generate_lead",
      event_id: "evt_education",
      idempotency_key: "evt_education",
      event_time: 1760000000,
      page_location: "https://education.blastgroup.org/checkout/sql-zero-avancado",
      ga_client_id: "123456.1760000000",
      ga_session_id: "1760000000",
      session_started_at: 1760000000,
      ga4_browser_page_view: true,
      landing_page_location: "https://blastgroup.org/cursos/sql-zero-avancado/",
      landing_page_path: "/cursos/sql-zero-avancado/",
      utm_source: "newsletter",
      utm_medium: "email",
    },
  };

  const result = siteTrackingRouter._test.validateAndBuildTrackingEvent(req);
  assert.equal(result.errors, undefined);
  assert.equal(result.trackingEvent.event_name, "generate_lead");
  assert.equal(result.trackingEvent.client.ga_session_id, "1760000000");
  assert.equal(result.trackingEvent.ga4_browser_page_view, true);
  assert.equal(result.trackingEvent.metadata.landing_page_path, "/cursos/sql-zero-avancado/");
});

test("site tracking rejects unconfigured hostnames", () => {
  const req = {
    headers: {
      origin: "https://example.com",
      "user-agent": "node-test",
    },
    ip: "127.0.0.1",
    body: {
      event_name: "page_view",
      event_id: "evt_bad_host",
      idempotency_key: "evt_bad_host",
      event_time: 1760000000,
      page_location: "https://example.com/",
    },
  };

  const result = siteTrackingRouter._test.validateAndBuildTrackingEvent(req);
  assert.ok(result.errors.some((message) => message.includes("page_location")));
  assert.ok(result.errors.some((message) => message.includes("origin")));
});
