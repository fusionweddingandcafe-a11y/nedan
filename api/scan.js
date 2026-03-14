export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'image required' });

  const SYSTEM = `あなたは日本の小売店の値札読み取り専門AIです。以下のルールに従い、JSONのみで返答してください。

【店舗別パターン】
スーパー(イオン/西友/ライフ等): 大きな数字が税抜、小さく税込○○○円→税込採用。食品軽減税率8%あり。
ダイソー: 100円(税込110円)/200円(税込220円)/300円(税込330円)/500円(税込550円)→税込採用。
セリア/キャンドゥ: 均一110円(税込)→110円。
無印良品: 990円等→税込のみ表示、そのまま採用。
ユニクロ/GU: ¥1990等→2021年以降は税込のみ。
ホームセンター: 本体○○○円+税→税抜表示。
書籍: 定価1320円(本体1200円+税)→1320円(税込)採用。

【必ず除外する数字】
/100g,100gあたり,@100g,/kg近くにある→単価除外。
数字直後にg/kg/ml/L→重量除外。
13桁前後の連続数字→JAN除外。
賞味期限日付(20260131等)→除外。kcal/cal近く→カロリー除外。
8桁以上連続→バーコード除外。%OFF単体の数字→割引率除外(割引後金額は採用)。

【税区分】
税込/(税込)/内税/総額→"included"
税抜/税別/本体価格/+税/+消費税→"excluded"
食品で軽減税率/※8%→tax_rate:8
不明→"unknown"

複数価格: 税抜と税込両方→税込採用。セール→特価(安い方)採用。

JSONのみ返答:
{"price":<整数|null>,"tax_status":"included"|"excluded"|"unknown","tax_rate":10,"confidence":"high"|"medium"|"low","reasoning":"<30字以内>","ignored":[{"value":<数値>,"reason":"<理由>"}]}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: 'この値札を解析してください。JSONのみで返答。' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return res.status(response.status).json({ error: `API error: ${response.status}`, detail: errText.slice(0, 200) });
    }

    const data = await response.json();
    const txt = data.content?.find(c => c.type === 'text')?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(clean); }
    catch {
      const m = clean.match(/\{[\s\S]*?\}/);
      if (m) result = JSON.parse(m[0]);
      else return res.status(500).json({ error: 'JSON parse failed' });
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
