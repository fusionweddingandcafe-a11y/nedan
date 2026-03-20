export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // ── ボディ読み取り ──────────────────────────────
  let body;
  try {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (req.body && typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }
  } catch (e) {
    return res.status(400).json({ error: 'body_parse_failed', detail: e.message });
  }

  const image = body?.image;
  if (!image) return res.status(400).json({ error: 'image missing' });
  if (image.length > 3000000) return res.status(413).json({ error: 'too_large', size: image.length });

  const PROMPT = `あなたは日本の小売店の値札読み取り専門AIです。

【店舗別パターン】
スーパー(イオン/西友/ライフ等): 大きな数字が税抜、小さく「税込○○○円」→税込採用。食品は軽減税率8%あり。
ダイソー: 100円(税込110円)/200円(税込220円)/300円(税込330円)/500円(税込550円)→税込採用。
セリア: 均一110円(税込)→110円。
無印良品: 990円等→税込のみ表示、そのまま採用。
ユニクロ/GU: ¥1990等→2021年以降は税込のみ。
書籍: 定価1320円(本体1200円+税)→1320円(税込)採用。

【除外する数字】
/100g・100gあたり・@100g・/kg近く→単価除外。
数字直後にg/kg/ml/L→重量除外。
13桁前後の連続数字→JAN除外。
賞味期限日付→除外。kcal/cal近く→カロリー除外。
8桁以上連続→バーコード除外。

【税区分判定】
「税込」「(税込)」「内税」「総額」→included
「税抜」「税別」「本体価格」「+税」「+消費税」→excluded
不明→unknown

JSONのみで返答（説明文不要）:
{"price":<整数|null>,"tax_status":"included"|"excluded"|"unknown","tax_rate":10,"confidence":"high"|"medium"|"low","reasoning":"<30字以内>","ignored":[{"value":<数値>,"reason":"<理由>"}]}`;

  try {
    // Google Gemini 2.0 Flash API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: image
              }
            },
            { text: PROMPT }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300
        }
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('Gemini error:', r.status, t.slice(0, 300));
      return res.status(r.status).json({ error: 'gemini_error', status: r.status, detail: t.slice(0, 300) });
    }

    const data = await r.json();
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();

    try { return res.status(200).json(JSON.parse(clean)); }
    catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) return res.status(200).json(JSON.parse(m[0]));
      return res.status(500).json({ error: 'parse_failed', raw: clean.slice(0, 200) });
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
    return res.status(500).json({ error: 'fetch_error', detail: e.message });
  }
}
