const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

// ── AI-specific rate limiter: 20 requests per 15 minutes per user ──────────────
const aiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'AI request limit reached. Please wait 15 minutes before trying again.',
});

// ── Allowed MIME types for vision uploads ──────────────────────────────────────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// ── Max base64 payload: ~4MB decoded (≈ 5.5MB base64 string) ──────────────────
const MAX_BASE64_LENGTH = 5_500_000;

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .trim();
}

// ── System prompts ─────────────────────────────────────────────────────────────
const chatSystemPrompt = `You are AURA, an elite AI beauty and style concierge. You speak with warm expertise like a luxury salon professional.

Rules:
- Give specific, actionable advice with product types and ingredients
- Ask ONE targeted follow-up question to personalize better
- Keep responses concise (3-5 sentences max per point)
- Mention specific ingredients (niacinamide, retinol, AHA/BHA etc.)
- Never use markdown asterisks or symbols — plain text only
- Suggest morning AND evening routines when relevant
- Be warm, confident, and empowering`;

const skinAnalysisSystemPrompt = `You are AURA, an expert dermatologist and AI beauty analyst with 20 years of experience. Analyze facial photos with clinical precision but warm, empowering language.

Rules:
- Identify specific skin concerns by exact face zone (forehead, left cheek, right cheek, chin, nose, T-zone, under-eyes)
- Be specific about severity (mild / moderate / prominent)
- Never use markdown asterisks or symbols — plain text only
- Be warm, positive, and solution-focused
- Always end with encouragement`;

// ── Gemini API helper ──────────────────────────────────────────────────────────
async function callGemini(contents) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('AI service not configured. Contact support.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ contents }),
  });
  const data = await response.json();
  if (!response.ok) {
    logger.error('Gemini API error', { status: response.status, error: data.error?.message });
    throw new Error(data.error?.message || 'Gemini API error');
  }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't respond.";
  return stripMarkdown(raw);
}

// ── POST /ai-stylist ───────────────────────────────────────────────────────────
// Authenticated + rate-limited.
// Handles two modes:
//   1. Chat  : { messages: [{role, content}] }
//   2. Vision: { messages: [{role, content}], imageBase64: "<base64 string>", mimeType?: "image/jpeg" }
router.post('/ai-stylist', protect, aiLimiter, async (req, res) => {
  try {
    const { messages, imageBase64, mimeType = 'image/jpeg' } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ reply: 'Invalid request: messages array required.' });
    }

    if (messages.length > 50) {
      return res.status(400).json({ reply: 'Too many messages in a single request.' });
    }

    // Validate each message has role + string content
    for (const msg of messages) {
      if (!msg.role || typeof msg.content !== 'string') {
        return res.status(400).json({ reply: 'Invalid message format.' });
      }
      if (msg.content.length > 4000) {
        return res.status(400).json({ reply: 'Message content too long (max 4000 chars).' });
      }
    }

    let contents;

    // ── Vision mode ─────────────────────────────────────────────────────────
    if (imageBase64) {
      // MIME type validation
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ reply: 'Unsupported image type. Use JPEG, PNG, WebP, or HEIC.' });
      }

      // Size validation — prevent huge payloads draining Gemini quota
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      if (base64Data.length > MAX_BASE64_LENGTH) {
        return res.status(400).json({ reply: 'Image too large. Please use an image under 4MB.' });
      }

      const userTextPart = messages[0]?.content ||
        `Analyze this face image thoroughly. Use EXACTLY these section labels on separate lines:

Skin Type: (Oily / Dry / Combination / Normal — with detail)
Dark Spots: (location and severity of hyperpigmentation, sun spots, uneven tone)
Acne & Pimples: (active breakouts, blackheads, whiteheads — list zones: forehead, chin, nose, cheeks)
Oily Zones: (T-zone and any other visibly oily areas)
Skin Texture: (smoothness, pores size, rough patches)
Hair Type: (texture, volume, condition, visible concerns)
Top Picks: (3 specific product type recommendations with key active ingredients targeting the detected concerns)

If no clear face is visible, respond ONLY with: NO_FACE_DETECTED`;

      contents = [
        {
          role:  'user',
          parts: [{ text: skinAnalysisSystemPrompt }],
        },
        {
          role:  'model',
          parts: [{ text: 'Understood. I am AURA, your skin analysis expert. Ready to provide a detailed skin health report.' }],
        },
        {
          role:  'user',
          parts: [
            { text: userTextPart },
            { inlineData: { mimeType, data: base64Data } },
          ],
        },
      ];
    } else {
      // ── Chat mode ────────────────────────────────────────────────────────────
      contents = [
        { role: 'user',  parts: [{ text: chatSystemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I am AURA, your personal beauty concierge. Ready to assist.' }] },
        ...messages.map((m) => ({
          role:  m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      ];
    }

    logger.info(`AI Stylist request`, {
      userId: req.user?.id,
      mode: imageBase64 ? 'vision' : 'chat',
      messageCount: messages.length,
    });

    const reply = await callGemini(contents);
    res.json({ reply });

  } catch (error) {
    logger.error('AI Stylist error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ reply: "Sorry, I had trouble connecting. Please try again!" });
  }
});

module.exports = router;
