const express = require("express");
const { sendContactEmail } = require("../lib/email");

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/", async (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const lang = body.lang === "en" ? "en" : "pt-BR";
  const website = typeof body.website === "string" ? body.website.trim() : "";
  const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.trim() : "";

  if (website) return res.status(200).json({ ok: true }); // honeypot

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "valid_email_required" });
  if (!company) return res.status(400).json({ error: "company_required" });
  if (!message || message.length < 10) return res.status(400).json({ error: "message_too_short" });
  if (message.length > 4000) return res.status(400).json({ error: "message_too_long" });

  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  const userAgent = req.headers["user-agent"] || "";

  const result = await sendContactEmail({ email, company, message, lang, pageUrl, userAgent, ip });
  if (!result.ok) return res.status(503).json({ error: "email_failed" });
  return res.json({ ok: true });
});

module.exports = router;
