const express = require('express');
const router = express.Router();

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .trim();
}

const systemPrompt = `You are AURA, an elite AI beauty and style concierge. You speak with warm expertise like a luxury salon professional.

Rules:
- Give specific, actionable advice with product types and ingredients
- Ask ONE targeted follow-up question to personalize better
- Keep responses concise (3-5 sentences max per point)
- Mention specific ingredients (niacinamide, retinol, AHA/BHA etc.)
- Never use markdown asterisks or symbols — plain text only
- Suggest morning AND evening routines when relevant
- Be warm, confident, and empowering`;

router.post('/ai-stylist', async (req, res) => {
  try {
    const { messages } = req.body;
    console.log('AI Stylist hit, messages count:', messages?.length);

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am AURA, your personal beauty concierge. Ready to assist.' }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
    ];

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + process.env.GEMINI_API_KEY;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    const data = await response.json();
    console.log('Gemini full response:', JSON.stringify(data));

    const rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't respond.";
    const reply = stripMarkdown(rawReply);
    res.json({ reply });

  } catch (error) {
    console.error('Gemini error:', error);
    res.status(500).json({ reply: "Sorry, I had trouble connecting. Please try again!" });
  }
});

module.exports = router;