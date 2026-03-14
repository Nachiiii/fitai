export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body;
    const userMsg = messages[0];
    const hasImage = Array.isArray(userMsg.content) && userMsg.content.some(b => b.type === 'image');

    let textContent = '';
    if (Array.isArray(userMsg.content)) {
      for (const block of userMsg.content) {
        if (block.type === 'text') textContent += block.text;
      }
    } else {
      textContent = userMsg.content;
    }

    // Use Gemini for image scanning (meal photos), Groq for text plans
    if (hasImage) {
      const imageBlock = userMsg.content.find(b => b.type === 'image');
      const parts = [
        { inlineData: { mimeType: imageBlock.source.media_type, data: imageBlock.source.data } },
        { text: textContent }
      ];
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const gRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
        })
      });
      const gData = await gRes.json();
      if (!gRes.ok) return res.status(gRes.status).json({ error: gData.error?.message || 'Vision API error' });
      const text = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ content: [{ type: 'text', text }] });
    }

    // Groq for workout/diet plans
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 6000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an expert fitness coach and nutritionist. Always respond with valid JSON only. No markdown, no backticks, no explanation — just raw JSON.'
          },
          { role: 'user', content: textContent }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'API error' });

    const text = data.choices?.[0]?.message?.content || '';
    res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
