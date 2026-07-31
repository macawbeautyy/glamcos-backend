/**
 * whatsappNotify — sends a WhatsApp message to the admin's phone using
 * Meta's WhatsApp Cloud API, for every "needs attention" event that also
 * feeds a sidebar badge (see notificationController.getAdminBadgeCounts).
 *
 * Setup (see WHATSAPP_SETUP.md at repo root): create a free Meta developer
 * app, add the WhatsApp product, and set these env vars on Render:
 *   WHATSAPP_ACCESS_TOKEN     — temporary or permanent Graph API token
 *   WHATSAPP_PHONE_NUMBER_ID  — the "from" number Meta gives you
 *   WHATSAPP_ADMIN_NUMBER     — admin's phone in international format, e.g. 91XXXXXXXXXX (no +, no spaces)
 *
 * Until all three are set, sendWhatsAppAlert() is a silent no-op — nothing
 * breaks, alerts just don't go out yet.
 */
const isConfigured = () =>
  !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ADMIN_NUMBER);

/**
 * Fire-and-forget WhatsApp text alert. Never throws — callers should NOT
 * await this in a way that blocks the user-facing response; call it and
 * let it resolve in the background (or .catch(() => {})).
 * @param {string} text - message body (WhatsApp free-form text)
 */
async function sendWhatsAppAlert(text) {
  if (!isConfigured()) return; // not set up yet — silent no-op

  try {
    const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: process.env.WHATSAPP_ADMIN_NUMBER,
        type: 'text',
        text: { body: text, preview_url: false },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[WhatsApp Alert] send failed:', res.status, errText.slice(0, 300));
    }
  } catch (err) {
    console.error('[WhatsApp Alert] error:', err.message);
  }
}

module.exports = { sendWhatsAppAlert, isConfigured };
