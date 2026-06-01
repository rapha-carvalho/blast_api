const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyCampaignSummaryEvent,
  applyEmailSummaryEvent,
  normalizeResendWebhookEvent,
} = require("../src/lib/newsletterStats");
const {
  normalizeNewsletterSubscription,
  validateNewsletterSubscription,
} = require("../src/lib/newsletterService");

test("normalizes Resend clicked webhook payload", () => {
  const event = normalizeResendWebhookEvent(
    {
      type: "email.clicked",
      created_at: "2026-06-01T10:00:00.000Z",
      data: {
        broadcast_id: "broadcast_123",
        email_id: "email_123",
        from: "Blast <noreply@blastgroup.org>",
        to: ["aluno@example.com"],
        subject: "SQL pratico",
        template_id: "template_123",
        click: {
          link: "https://blastgroup.org/cursos/sql-zero-avancado/",
        },
        tags: {
          campaign_key: "sql_cheatsheet_v1_joins",
          step: "joins",
        },
      },
    },
    { webhookId: "msg_123", receivedAt: "2026-06-01T10:00:01.000Z" }
  );

  assert.equal(event.webhookId, "msg_123");
  assert.equal(event.eventType, "email.clicked");
  assert.equal(event.email, "aluno@example.com");
  assert.equal(event.clickedLink, "https://blastgroup.org/cursos/sql-zero-avancado/");
  assert.equal(event.campaignKey, "sql_cheatsheet_v1_joins");
  assert.equal(event.journeyStep, "joins");
});

test("updates email summary counters and unsubscribe status", () => {
  const delivered = normalizeResendWebhookEvent({
    type: "email.delivered",
    created_at: "2026-06-01T10:00:00.000Z",
    data: { to: ["aluno@example.com"] },
  });
  const clicked = normalizeResendWebhookEvent({
    type: "email.clicked",
    created_at: "2026-06-01T10:05:00.000Z",
    data: { to: ["aluno@example.com"], click: { link: "https://blastgroup.org" } },
  });
  const unsubscribed = normalizeResendWebhookEvent({
    type: "contact.updated",
    created_at: "2026-06-01T11:00:00.000Z",
    data: { email: "aluno@example.com", unsubscribed: true },
  });

  let summary = applyEmailSummaryEvent({}, delivered, {
    name: "Aluno",
    source: "cheatsheet_landing",
    level: "iniciante",
    subscribedAt: "2026-06-01T09:00:00.000Z",
  });
  summary = applyEmailSummaryEvent(summary, clicked);
  summary = applyEmailSummaryEvent(summary, unsubscribed);

  assert.equal(summary.Email, "aluno@example.com");
  assert.equal(summary.Nome, "Aluno");
  assert.equal(summary.Entregues, "1");
  assert.equal(summary.Cliques, "1");
  assert.equal(summary["Último clique"], "https://blastgroup.org");
  assert.equal(summary.Status, "descadastrado");
});

test("updates campaign summary rates", () => {
  const sent = normalizeResendWebhookEvent({
    type: "email.sent",
    created_at: "2026-06-01T10:00:00.000Z",
    data: { to: ["aluno@example.com"], tags: { campaign_key: "sql_cheatsheet_v1_welcome" } },
  });
  const delivered = { ...sent, eventType: "email.delivered" };
  const opened = { ...sent, eventType: "email.opened" };
  const clicked = { ...sent, eventType: "email.clicked" };

  let campaign = applyCampaignSummaryEvent({}, sent);
  campaign = applyCampaignSummaryEvent(campaign, delivered);
  campaign = applyCampaignSummaryEvent(campaign, opened, { isUniqueOpen: true });
  campaign = applyCampaignSummaryEvent(campaign, clicked, { isUniqueClick: true });

  assert.equal(campaign.Enviados, "1");
  assert.equal(campaign.Entregues, "1");
  assert.equal(campaign["Aberturas únicas"], "1");
  assert.equal(campaign["Cliques únicos"], "1");
  assert.equal(campaign["Cliques totais"], "1");
  assert.equal(campaign["Delivery rate"], "100.00%");
  assert.equal(campaign["Open rate"], "100.00%");
  assert.equal(campaign.CTR, "100.00%");
});

test("validates SQL newsletter subscription consent and email", () => {
  const subscription = normalizeNewsletterSubscription({
    source: "cheatsheet_landing",
    name: "Aluno",
    email: "aluno@example.com",
    level: "iniciante",
    consent: true,
  });
  assert.deepEqual(validateNewsletterSubscription(subscription, { requireName: true, requireLevel: true }), []);

  const invalid = normalizeNewsletterSubscription({
    source: "cheatsheet_landing",
    name: "A",
    email: "sem-email",
    level: "",
    consent: false,
  });
  assert.deepEqual(validateNewsletterSubscription(invalid, { requireName: true, requireLevel: true }), [
    "name",
    "email",
    "level",
    "consent",
  ]);
});
