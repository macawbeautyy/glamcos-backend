/**
 * Mailer utility
 *
 * Sends emails via SMTP (nodemailer).
 * Configure with env vars:
 *   SMTP_HOST   (default: smtp.gmail.com)
 *   SMTP_PORT   (default: 587)
 *   SMTP_USER   (e.g. yourapp@gmail.com)
 *   SMTP_PASS   (Gmail app password or SMTP password)
 *   SMTP_FROM   (optional display name, default: SMTP_USER)
 *
 * If SMTP_USER / SMTP_PASS are not set, emails are logged to console only
 * (useful for local dev — check server logs for OTP).
 */

const nodemailer = require('nodemailer');

const createTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransporter({
    host:   SMTP_HOST || 'smtp.gmail.com',
    port:   Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // true only for port 465
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });
};

/**
 * Send an email.
 * @param {Object} opts
 * @param {string} opts.to       Recipient email
 * @param {string} opts.subject  Email subject
 * @param {string} opts.text     Plain-text body
 * @param {string} [opts.html]   HTML body (optional, overrides text in capable clients)
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
exports.sendEmail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();

  if (!transporter) {
    // No SMTP configured — log the email for dev inspection
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[Mailer] SMTP not configured. Email NOT sent.`);
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body:    ${text}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { success: false, reason: 'SMTP not configured' };
  }

  try {
    const from = process.env.SMTP_FROM || `"MACAW Beauty" <${process.env.SMTP_USER}>`;
    await transporter.sendMail({ from, to, subject, text, html });
    console.log(`[Mailer] Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (err) {
    console.error('[Mailer] Send failed:', err.message);
    return { success: false, reason: err.message };
  }
};
