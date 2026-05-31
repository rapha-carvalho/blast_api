const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@blastgroup.org";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO = process.env.CONTACT_INBOX || "contato@blastgroup.org";
const MENTORSHIP_WAITLIST_NOTIFY_TO =
  process.env.MENTORSHIP_WAITLIST_NOTIFY_TO || "raphael.carvalho@blastgroup.org";

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWaitlistSubmittedAt(iso) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch (error) {
    return iso;
  }
}

function waitlistNotificationLines(submission) {
  return [
    `Nome: ${submission.name}`,
    `Email: ${submission.email}`,
    `WhatsApp: ${submission.whatsapp}`,
    `Área atual: ${submission.currentArea}`,
    `Maior dificuldade: ${submission.biggestChallenge}`,
    `Ferramentas: ${submission.tools.length ? submission.tools.join(", ") : "Não informado"}`,
    `Consentimento LGPD: ${submission.consent ? "Sim" : "Não"}`,
    `Página: ${submission.pageUrl || "Não informado"}`,
    `Enviado em: ${formatWaitlistSubmittedAt(submission.submittedAt)}`,
    submission.ip ? `IP: ${submission.ip}` : null,
  ].filter(Boolean);
}

async function sendMentorshipWaitlistConfirmationEmail(submission) {
  const firstName = submission.name.split(/\s+/)[0] || submission.name;
  const subject = "Recebemos seu cadastro na Mentoria Transição para Dados";
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
  <tr><td style="padding:28px 36px;border-bottom:3px solid #2563EB">
    <p style="margin:0;font-size:22px;font-weight:700;color:#111827">BlastGroup</p>
  </td></tr>
  <tr><td style="padding:36px">
    <h1 style="margin:0 0 12px;font-size:24px;color:#111827">Cadastro recebido</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151">Olá, <strong>${escapeHtml(firstName)}</strong>! Recebemos seu interesse na Mentoria Transição para Dados.</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151">Em breve, enviaremos os detalhes da primeira turma beta por e-mail.</p>
  </td></tr>
  <tr><td style="padding:20px 36px;border-top:1px solid #E5E7EB;background:#F9FAFB">
    <p style="margin:0;color:#6B7280;font-size:12px"><a href="https://blastgroup.org" style="color:#2563EB">blastgroup.org</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Olá, ${firstName}!`,
    "",
    "Recebemos seu interesse na Mentoria Transição para Dados.",
    "Em breve, enviaremos os detalhes da primeira turma beta por e-mail.",
    "",
    "https://blastgroup.org",
  ].join("\n");

  return sendResend({ to: submission.email, subject, html, text });
}

async function sendMentorshipWaitlistNotificationEmail(submission) {
  const to = MENTORSHIP_WAITLIST_NOTIFY_TO.split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (to.length === 0) {
    return { ok: false, reason: "notification_recipient_not_configured" };
  }

  const subject = `Novo cadastro na mentoria: ${submission.name}`;
  const lines = waitlistNotificationLines(submission);
  const text = [
    "Novo formulário preenchido na lista de espera da Mentoria Transição para Dados.",
    "",
    ...lines,
    "",
    "Blast Website",
  ].join("\n");

  const htmlRows = lines
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      const label = separatorIndex >= 0 ? line.slice(0, separatorIndex) : "Info";
      const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:700;color:#111827">${escapeHtml(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;color:#374151">${escapeHtml(value)}</td></tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
  <tr><td style="padding:28px 32px;border-bottom:3px solid #2563EB">
    <h1 style="margin:0;font-size:22px;color:#111827">Novo cadastro na mentoria</h1>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 20px;font-size:15px;color:#374151">Um novo formulário foi preenchido na lista de espera da Mentoria Transição para Dados.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;border-collapse:collapse">${htmlRows}</table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return sendResend({ to, subject, html, text, reply_to: submission.email });
}

async function sendGiovannaMentorshipPurchaseEmail({ to, buyerName }) {
  const firstName = String(buyerName || "aluna").trim().split(/\s+/)[0] || "aluna";
  const subject = "Compra confirmada: Mentoria Transição para Dados";
  const courseUrl = "https://education.blastgroup.org/checkout/sql-basico-avancado";
  const discountText =
    'como parte da mentoria, você ganhou 100% de desconto no meu curso "SQL do Zero avançado"; Acesse aqui: https://education.blastgroup.org/checkout/sql-basico-avancado e utilize o código RPA100 no checkout.';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
  <tr><td style="padding:28px 36px;border-bottom:3px solid #2563EB">
    <p style="margin:0;font-size:22px;font-weight:700;color:#111827">BlastGroup</p>
  </td></tr>
  <tr><td style="padding:36px">
    <h1 style="margin:0 0 12px;font-size:24px;color:#111827">Sua vaga está confirmada</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151">Olá, <strong>${escapeHtml(firstName)}</strong>! Recebemos sua compra da Mentoria Transição para Dados com Giovanna Godoi.</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151">Em breve, você receberá os próximos passos da turma por e-mail.</p>
    <div style="background:#EFF6FF;border-left:4px solid #2563EB;border-radius:8px;padding:18px 20px">
      <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#1F2937">${escapeHtml(discountText)}</p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#1F2937"><strong>Código:</strong> RPA100</p>
      <p style="margin:14px 0 0"><a href="${courseUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;border-radius:999px;padding:12px 18px;font-size:14px;font-weight:700">Acessar o curso</a></p>
    </div>
  </td></tr>
  <tr><td style="padding:20px 36px;border-top:1px solid #E5E7EB;background:#F9FAFB">
    <p style="margin:0;color:#6B7280;font-size:12px"><a href="https://blastgroup.org" style="color:#2563EB">blastgroup.org</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Olá, ${firstName}!`,
    "",
    "Recebemos sua compra da Mentoria Transição para Dados com Giovanna Godoi.",
    "Em breve, você receberá os próximos passos da turma por e-mail.",
    "",
    discountText,
    "",
    "https://blastgroup.org",
  ].join("\n");

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

module.exports = {
  sendLicenseEmail,
  sendMentorshipConfirmationEmail,
  sendMentorshipWaitlistConfirmationEmail,
  sendMentorshipWaitlistNotificationEmail,
  sendGiovannaMentorshipPurchaseEmail,
  sendContactEmail,
};
