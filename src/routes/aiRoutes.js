const express = require('express');
const router = express.Router();

router.post('/ai-stylist', async (req, res) => {
  try {
    const { messages } = req.body;

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      }
    );

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't respond.";
    res.json({ reply });

  } catch (error) {
    console.error('Gemini error:', error);
    res.status(500).json({ reply: "Sorry, I had trouble connecting. Please try again!" });
  }
});

module.exports = router;