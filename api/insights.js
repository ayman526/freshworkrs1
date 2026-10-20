const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

function ceoBullets(d) {
  const wr = d.winRate || 0;
  return [
    `${wr >= 50 ? '✓' : '△'} Win rate ${wr}% across ${d.totalDeals} deals — ${wr >= 50 ? 'above' : 'below'} 40% threshold`,
    `Open pipeline $${(d.openValue || 0).toLocaleString()} = ${d.coverageRatio}x coverage ratio`,
    `${d.stalledDeals || 0} deals stalled 30+ days — review and advance or disqualify`,
    `Top loss reason: "${(d.lostReasons || [{}])[0]?.name || 'Unknown'}" (${(d.lostReasons || [{}])[0]?.count || 0} deals)`,
    `Performance gap: ${d.topRep} at ${d.topRepRate}% vs ${d.bottomRep} at ${d.bottomRepRate}%`,
  ];
}

function ruleInsights(d) {
  const i = [], wr = d.winRate || 0;
  if (wr < 30) i.push(`Win rate ${wr}% critically below 30% — audit last 90 days of lost deals immediately.`);
  else if (wr >= 50) i.push(`Win rate ${wr}% is strong — protect it by ensuring every open deal has a close plan.`);
  else i.push(`Win rate ${wr}% — tighten stage-entry qualification to push above 40%.`);
  if (d.stalledDeals > 0) i.push(`${d.stalledDeals} deals stale 30d+ — advance or disqualify to clean forecast.`);
  if ((d.lostReasons || []).length) i.push(`"${d.lostReasons[0].name}" is #1 loss driver (${d.lostReasons[0].count}) — build a counter-playbook.`);
  if (d.openValue > (d.wonValue || 1) * 2) i.push(`Open pipeline is ${Math.round((d.openValue || 0) / (d.wonValue || 1))}× won — create close plans for top 10 open deals.`);
  if (d.topRep) i.push(`${d.topRep} leads at ${d.topRepRate}% — run a peer coaching session this week.`);
  if (d.bottomRep) i.push(`${d.bottomRep} at ${d.bottomRepRate}% — 30-day improvement plan needed.`);
  return i.slice(0, 6);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!ANTHROPIC_KEY) {
    return res.json({ insights: ruleInsights(req.body), ceo_summary: ceoBullets(req.body) });
  }
  try {
    const d = req.body;
    const prompt = `You are a McKinsey Sales Advisor. Give CEO_SUMMARY (5 bullets) and PIPELINE_INSIGHTS (6 numbered). Use exact numbers. Format exactly:
CEO_SUMMARY:\n• ...\nPIPELINE_INSIGHTS:\n1. ...\n\nData: ${d.totalDeals} deals | won $${(d.wonValue || 0).toLocaleString()} | lost $${(d.lostValue || 0).toLocaleString()} | win rate ${d.winRate}% | coverage ${d.coverageRatio}x | stalled ${d.stalledDeals} | top rep ${d.topRep} ${d.topRepRate}% | bottom ${d.bottomRep} ${d.bottomRepRate}% | top loss reason: ${(d.lostReasons || []).slice(0, 2).map(r => r.name + '(' + r.count + ')').join(', ')}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    const ceoMatch = text.match(/CEO_SUMMARY:([\s\S]*?)(?:PIPELINE_INSIGHTS:|$)/);
    const ceo_summary = ceoMatch
      ? ceoMatch[1].trim().split('\n').map(l => l.replace(/^[•\-\*]\s*/, '')).filter(Boolean)
      : [];
    const insMatch = text.match(/PIPELINE_INSIGHTS:([\s\S]*)/);
    const insights = insMatch
      ? insMatch[1].trim().split('\n').filter(l => l.match(/^\d+\./)).map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
      : [];
    res.json({
      insights: insights.length ? insights : ruleInsights(d),
      ceo_summary: ceo_summary.length ? ceo_summary : ceoBullets(d),
    });
  } catch (e) {
    res.json({ insights: ruleInsights(req.body), ceo_summary: ceoBullets(req.body) });
  }
};
