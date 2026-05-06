const express = require('express');
const router  = express.Router();

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ contents }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error('Gemini API error:', JSON.stringify(data));
    throw new Error(data.error?.message || 'Gemini API error');
  }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't respond.";
  return stripMarkdown(raw);
}

// ── POST /ai-stylist ───────────────────────────────────────────────────────────
// Handles two modes:
//   1. Chat  : { messages: [{role, content}] }
//   2. Vision: { messages: [{role, content}], imageBase64: "<base64 string>", mimeType?: "image/jpeg" }
router.post('/ai-stylist', async (req, res) => {
  try {
    const { messages, imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ reply: 'Invalid request: messages array required.' });
    }

    let contents;

    // ── Vision mode ─────────────────────────────────────────────────────────────
    if (imageBase64) {
      // Strip data-URL prefix if present (e.g. "data:image/jpeg;base64,...")
      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

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
            { inlineData: { mimeType, data: cleanBase64 } },
          ],
        },
      ];
    } else {
      // ── Chat mode ──────────────────────────────────────────────────────────────
      contents = [
        { role: 'user',  parts: [{ text: chatSystemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I am AURA, your personal beauty concierge. Ready to assist.' }] },
        ...messages.map((m) => ({
          role:  m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      ];
    }

    console.log(`AI Stylist: ${imageBase64 ? 'vision' : 'chat'} mode — ${messages.length} messages`);

    const reply = await callGemini(contents);
    res.json({ reply });

  } catch (error) {
    console.error('AI Stylist error:', error);
    res.status(500).json({ reply: "Sorry, I had trouble connecting. Please try again!" });
  }
});

module.exports = router;
