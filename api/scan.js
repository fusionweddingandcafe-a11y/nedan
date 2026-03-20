export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'NO_API_KEY' });
  }

  let body;
  try {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (req.body && typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf-8');
      body = JSON.parse(raw);
    }
  } catch (e) {
    console.error('BODY_PARSE_ERROR:', e.message);
    return res.status(400).json({ error: 'body_parse_failed', detail: e.message });
  }

  const image = body?.image;
  if (!image) {
    console.error('NO_IMAGE: bodyType=', typeof req.body);
    return res.status(400).json({ error: 'no_image', bodyType: typeof req.body });
  }
  if (image.length > 3000000) {
    console.error('TOO_LARGE:', image.length);
    return res.status(413).json({ error: 'too_large', size: image.length });
  }

  console.log('Calling Anthropic API, image size:', image.length, 'apiKey prefix:', apiKey.slice(0,10));

  const SYSTEM = `あなたは日本の小売店の値札読み取り専門AIです。JSONのみで返答してください。
スーパー: 税込価格を採用。食品は8%軽減税率あり。ダイソー: 税込110/220/330/550円。無印良品: そのまま税込。ユニクロ/GU: 税込のみ。
除外: 100g単価/重量g,kg,ml,L/JANコード13桁/賞味期限/カロリーkcal/バーコード8桁以上/%OFF単体。
税込/(税込)/内税→included。税抜/税別/+税→excluded。不明→unknown。
{"price":<整数|null>,"tax_status":"included"|"excluded"|"unknown","tax_rate":10,"confidence":"high"|"medium"|"low","reasoning":"<30字>","ignored":[]}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: 'この値札を解析。JSONのみ返答。' }
        ]}]
      })
    });

    const responseText = await r.text();
    console.log('Anthropic status:', r.status, 'response:', responseText.slice(0, 300));

    if (!r.ok) {
      console.error('ANTHROPIC_ERROR:', r.status, responseText.slice(0, 300));
      return res.status(r.status).json({ error: 'anthropic_error', status: r.status, detail: responseText.slice(0, 300) });
    }

    const data = JSON.parse(responseText);
    const txt = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();
    try { return res.status(200).json(JSON.parse(clean)); }
    catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) return res.status(200).json(JSON.parse(m[0]));
      return res.status(500).json({ error: 'parse_failed', raw: clean.slice(0, 200) });
    }
  } catch (e) {
    console.error('FETCH_ERROR:', e.message);
    return res.status(500).json({ error: 'fetch_error', detail: e.message });
  }
}
