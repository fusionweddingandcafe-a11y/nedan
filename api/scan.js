export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image missing' });
  if (image.length > 3000000) return res.status(413).json({ error: 'image_too_large', size: image.length });
  const SYSTEM = `あなたは日本の小売店の値札読み取り専門AIです。JSONのみで返答してください。スーパー: 税込価格を採用。食品は8%軽減税率あり。ダイソー: 税込110/220/330/550円。無印良品: そのまま税込。ユニクロ/GU: 税込のみ。除外: 100g単価/重量g,kg,ml,L/JANコード13桁/賞味期限/カロリーkcal/バーコード8桁以上/%OFF単体。税込/(税込)/内税→included。税抜/税別/+税→excluded。不明→unknown。{"price":<整数|null>,"tax_status":"included"|"excluded"|"unknown","tax_rate":10,"confidence":"high"|"medium"|"low","reasoning":"<30字>","ignored":[]}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: 'この値札を解析。JSONのみ返答。' }] }] })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(r.status).json({ error: r.status, detail: t.slice(0, 300) }); }
    const data = await r.json();
    const txt = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();
    try { return res.status(200).json(JSON.parse(clean)); }
    catch { const m = clean.match(/\{[\s\S]*\}/); if (m) return res.status(200).json(JSON.parse(m[0])); return res.status(500).json({ error: 'parse failed' }); }
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
