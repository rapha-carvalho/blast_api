const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@blastgroup.org";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO = process.env.CONTACT_INBOX || "contato@blastgroup.org";

async function sendResend({ to, subject, html, text, reply_to }) {
  if (!RESEND_API_KEY) {
    console.warn("email: RESEND_API_KEY not set; skipping.");
    return { ok: false, reason: "email_not_configured" };
  }
  try {
    const body = { from: EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject };
    if (html) body.html = html;
    if (text) body.text = text;
    if (reply_to) body.reply_to = reply_to;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", res.status, err);
      return { ok: false, reason: err };
    }
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("sendResend error:", e);
    return { ok: false, reason: String(e.message) };
  }
}

async function sendLicenseEmail(to, licenseKey, plan = "Pro") {
  const subject = "Your GA4 Inspector Pro license key";
  const text = `
Hello,

Thank you for purchasing GA4 Inspector Pro.

Your license key:
${licenseKey}

How to activate:
1. Open the GA4 Inspector Chrome extension.
2. Click "Restore purchase" or open the upgrade modal.
3. Paste the key above and click Validate.

You can manage your subscription here:
${process.env.SITE_URL || "https://blastgroup.org"}/products/ga4-inspector

— Blast / GA4 Inspector
  `.trim();

  return sendResend({ to, subject, text });
}

async function sendMentorshipConfirmationEmail({ to, buyerName, slotStart, slotEnd, meetLink }) {
  const fmt = (iso, opts) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...opts }).format(new Date(iso));

  const dateLabel = fmt(slotStart, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const startTime = fmt(slotStart, { hour: "2-digit", minute: "2-digit", hour12: false });
  const endTime = fmt(slotEnd, { hour: "2-digit", minute: "2-digit", hour12: false });

  const subject = "Mentoria confirmada — BlastGroup";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">
  <tr><td style="padding:32px 40px;border-bottom:3px solid #16A34A">
    <p style="margin:0;font-size:22px;font-weight:700;color:#111827">BlastGroup</p>
  </td></tr>
  <tr><td style="padding:40px 40px 24px">
    <h1 style="margin:0 0 8px;font-size:24px;color:#16A34A">Sua mentoria está confirmada!</h1>
    <p style="margin:0 0 24px;color:#374151;font-size:15px">Olá, <strong>${buyerName}</strong>! Sua sessão de mentoria com Raphael Carvalho está confirmada.</p>
    <div style="background:#F0FDF4;border-left:4px solid #16A34A;border-radius:8px;padding:20px 24px;margin-bottom:28px">
      <p style="margin:0 0 12px;font-weight:700;color:#111827;font-size:15px">Detalhes da sessão</p>
      <p style="margin:4px 0;color:#374151;font-size:14px">📅 ${dateLabel}</p>
      <p style="margin:4px 0;color:#374151;font-size:14px">⏰ ${startTime} – ${endTime} (Horário de Brasília)</p>
      <p style="margin:4px 0;color:#374151;font-size:14px">⏱ 60 minutos</p>
      ${meetLink ? `<p style="margin:12px 0 0;font-size:14px"><a href="${meetLink}" style="color:#16A34A;font-weight:600">📹 Entrar no Google Meet</a></p>` : "<p style=\"margin:4px 0;color:#374151;font-size:14px\">📹 Link do Google Meet no convite do calendário</p>"}
    </div>
    <p style="margin:0 0 8px;font-weight:600;color:#111827;font-size:15px">O que preparar:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8">
      <li>Seus principais objetivos para a sessão</li>
      <li>Dúvidas específicas sobre carreira, técnica ou projetos</li>
      <li>Currículo ou portfólio, se quiser feedback</li>
    </ul>
    <p style="margin:0;color:#6B7280;font-size:14px">Dúvidas? Responda este email ou me encontre no <a href="https://www.linkedin.com/in/rapha-carvalho/" style="color:#16A34A">LinkedIn</a>.</p>
  </td></tr>
  <tr><td style="padding:20px 40px;border-top:1px solid #E5E7EB;background:#F9FAFB">
    <p style="margin:0;color:#9CA3AF;font-size:12px">Raphael Carvalho · BlastGroup · <a href="https://blastgroup.org" style="color:#9CA3AF">blastgroup.org</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Olá, ${buyerName}!\n\nSua mentoria está confirmada.\n\nData: ${dateLabel}\nHorário: ${startTime} – ${endTime} (Horário de Brasília)\nDuração: 60 minutos\n${meetLink ? `Link: ${meetLink}\n` : ""}\nRaphael Carvalho · BlastGroup · blastgroup.org`;

  return sendResend({ to, subject, html, text });
}

async function sendContactEmail({ email, company, message, lang = "pt-BR", pageUrl, userAgent, ip }) {
  const isEnglish = lang === "en";
  const subject = isEnglish ? "New contact form message" : "Novo contato pelo site";
  const intro = isEnglish ? "New website contact form submission." : "Novo contato enviado pelo site.";

  const meta = [
    pageUrl ? `Page: ${pageUrl}` : null,
    userAgent ? `User-Agent: ${userAgent}` : null,
    ip ? `IP: ${ip}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const text = `${intro}\n\nCompany: ${company}\nEmail: ${email}\n\nMessage:\n${message}${meta ? `\n\n${meta}` : ""}\n\n— Blast Website`;

  return sendResend({ to: CONTACT_TO, subject, text, reply_to: email });
}

module.exports = { sendLicenseEmail, sendMentorshipConfirmationEmail, sendContactEmail };
