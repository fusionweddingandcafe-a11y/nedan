export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NO_API_KEY' });

  // ── ボディを確実に読み取る ──────────────────────
  let image = null;
  let debugInfo = {};

  try {
    // パターン1: Vercelが自動パース済み（オブジェクト）
    if (req.body && typeof req.body === 'object' && req.body.image) {
      image = req.body.image;
      debugInfo.source = 'req.body.object';

    // パターン2: 文字列として渡された
    } else if (req.body && typeof req.body === 'string') {
      const parsed = JSON.parse(req.body);
      image = parsed.image;
      debugInfo.source = 'req.body.string';

    // パターン3: ストリームから直接読む
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf-8');
      debugInfo.rawLength = raw.length;
      debugInfo.rawPreview = raw.slice(0, 50);
      if (raw) {
        const parsed = JSON.parse(raw);
        image = parsed.image;
        debugInfo.source = 'stream';
      }
    }
  } catch (e) {
    return res.status(400).json({ error: 'BODY_PARSE_ERROR', detail: e.message, debug: debugInfo });
  }

  // 診断情報を返す
  debugInfo.bodyType = typeof req.body;
  debugInfo.hasBody = !!req.body;
  debugInfo.hasImage = !!image;
  debugInfo.imageLength = image ? image.length : 0;
  debugInfo.contentType = req.headers['content-type'];

  if (!image) {
    return res.status(400).json({ error: 'NO_IMAGE', debug: debugInfo });
  }

  if (image.length > 3000000) {
    return res.status(413).json({ error: 'TOO_LARGE', size: image.length });
  }

  // ── Anthropic API 呼び出し ──────────────────────
  const SYSTEM = `あなたは日本の小売店の値札読み取り専門AIです。JSONのみで返答してください。
スーパー: 税込価格を採用。食品は8%軽減税率あり。ダイソー: 税込110/220/330/550円。
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
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: 'この値札を解析。JSONのみ返答。' }
        ]}]
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'ANTHROPIC_ERROR', status: r.status, detail: t.slice(0, 300) });
    }

    const data = await r.json();
    const txt = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();
    try { return res.status(200).json(JSON.parse(clean)); }
    catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) return res.status(200).json(JSON.parse(m[0]));
      return res.status(500).json({ error: 'PARSE_FAILED', raw: clean.slice(0, 200) });
    }
  } catch (e) {
    return res.status(500).json({ error: 'FETCH_ERROR', detail: e.message });
  }
}
