export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body;
    const userMsg = messages[0];

    const hasImage = Array.isArray(userMsg.content) &&
      userMsg.content.some(b => b.type === 'image');

    // Build Groq messages — it supports vision with llama-3.2-90b-vision-preview
    let groqMessages;

    if (hasImage) {
      // Vision request (meal scanning)
      const parts = [];
      if (Array.isArray(userMsg.content)) {
        for (const block of userMsg.content) {
          if (block.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`
              }
            });
          } else if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          }
        }
      }
      groqMessages = [
        {
          role: 'system',
          content: 'You are a nutrition expert. Analyze food photos and return accurate nutritional data as JSON only. No markdown, no backticks, just raw JSON.'
        },
        { role: 'user', content: parts }
      ];
    } else {
      // Text-only request (workout/diet plans)
      let textContent = '';
      if (Array.isArray(userMsg.content)) {
        for (const block of userMsg.content) {
          if (block.type === 'text') textContent += block.text;
        }
      } else {
        textContent = userMsg.content;
      }
      groqMessages = [
        {
          role: 'system',
          content: 'You are an expert fitness coach and nutritionist. Always respond with valid JSON only. No markdown, no backticks, no explanation — just raw JSON.'
        },
        { role: 'user', content: textContent }
      ];
    }

    const model = hasImage
      ? 'meta-llama/llama-4-scout-17b-16e-instruct'
      : 'llama-3.3-70b-versatile';

    const body = {
      model,
      max_tokens: hasImage ? 1000 : 6000,
      temperature: hasImage ? 0.2 : 0.7,
      messages: groqMessages
    };

    // Only add json mode for text requests (vision doesn't support it)
    if (!hasImage) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'API error'
      });
    }

    const text = data.choices?.[0]?.message?.content || '';
    res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
