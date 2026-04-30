const express = require('express');
const router = express.Router();

router.post('/ai-stylist', async (req, res) => {
  try {
    const { messages } = req.body;
    console.log('AI Stylist hit, messages count:', messages?.length);

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + process.env.GEMINI_API_KEY;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    const data = await response.json();
    console.log('Gemini full response:', JSON.stringify(data));

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't respond.";
    res.json({ reply });

  } catch (error) {
    console.error('Gemini error:', error);
    res.status(500).json({ reply: "Sorry, I had trouble connecting. Please try again!" });
  }
});

module.exports = router;