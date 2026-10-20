const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ═══════════════════════════════════════════════════
// ACCOUNTS CONFIGURATION
// Add as many Freshworks accounts as you need here.
// Each entry needs: label, subdomain, api_key
// ═══════════════════════════════════════════════════
const CRM_ACCOUNTS = [
  {
    label:     'Contentech',              // display name in dashboard
    subdomain: 'contentech',             // contentech.myfreshworks.com
    api_key:   'BxeRQEkiETipzcChVj_YnA',
    color:     '#2563eb',               // blue
  },
  {
    label:     'Future Trans',
    subdomain: 'futuretrans-org',
    api_key:   'NaGGhD-UQDkzQ99WJEmXiQ',
    color:     '#059669',
  },
  {
    label:     'FG Global',
    subdomain: 'fg-global',
    api_key:   'd5a_Je4HBnF5quoax817og',
    color:     '#7c3aed',
  },
];

// ═══════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════
function makeBase(subdomain) {
  return `https://${subdomain}.myfreshworks.com/crm/sales/api`;
}

async function apiCall(base, apiKey, endpoint) {
  const url = `${base}${endpoint}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Authorization': `Token token=${apiKey}`, 'Content-Type': 'application/json' }
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${txt.slice(0, 150)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

async function safe(label, fn, fallback = []) {
  try { const r = await fn(); console.log(`  ✓ ${label}`); return r; }
  catch (e) { console.warn(`  ✗ ${label}: ${e.message}`); return fallback; }
}

async function fetchView(base, apiKey, entity, viewId, include, maxPages) {
  const inc = include ? `&include=${include}` : '';
  const items = [];
  for (let p = 1; p <= maxPages; p++) {
    const data = await apiCall(base, apiKey, `/${entity}/view/${viewId}?per_page=100${inc}&page=${p}`);
    const batch = data[entity] || [];
    items.push(...batch);
    if (p >= (data.meta?.total_pages || 1) || !batch.length) break;
  }
  return items;
}

function findView(filters, ...kws) {
  for (const kw of kws) {
    const f = filters.find(f => f.name.toLowerCase().includes(kw));
    if (f) return f.id;
  }
  return null;
}

// ═══════════════════════════════════════════════════
// FETCH ONE ACCOUNT
// ═══════════════════════════════════════════════════
async function fetchAccount(account) {
  const { label, subdomain, api_key, color } = account;
  const base = makeBase(subdomain);
  const api = (ep) => apiCall(base, api_key, ep);
  console.log(`\n── Fetching: ${label} (${subdomain}) ──`);

  // Get view IDs
  const [dealFilters, acctFilters] = await Promise.all([
    safe(`${label} deal filters`,    () => api('/deals/filters').then(d => d.filters || []),         []),
    safe(`${label} account filters`, () => api('/sales_accounts/filters').then(d => d.filters || []),[]),
  ]);

  const openId = findView(dealFilters, 'open deals', 'open');
  const wonId  = findView(dealFilters, 'won deals',  'won');
  const lostId = findView(dealFilters, 'lost deals', 'lost');
  const acctId = findView(acctFilters, 'all accounts', 'all');

  const INC = 'deal_stage,owner,deal_reason,sales_account';

  const [openDeals, wonDeals, lostDeals, accounts, allOwners, deal_stages, deal_reasons, lead_sources] = await Promise.all([
    openId ? safe(`${label} open`,     () => fetchView(base, api_key, 'deals', openId, INC, 4).then(ds => ds.map(d => ({...d, _view_type: 'open'})))) : Promise.resolve([]),
    wonId  ? safe(`${label} won`,      () => fetchView(base, api_key, 'deals', wonId,  INC, 4).then(ds => ds.map(d => ({...d, _view_type: 'won'})))) : Promise.resolve([]),
    lostId ? safe(`${label} lost`,     () => fetchView(base, api_key, 'deals', lostId, INC, 4).then(ds => ds.map(d => ({...d, _view_type: 'lost'})))) : Promise.resolve([]),
    acctId ? safe(`${label} accounts`, () => fetchView(base, api_key, 'sales_accounts', acctId, '', 3)) : Promise.resolve([]),
    safe(`${label} owners`,       () => api('/selector/owners').then(d => d.users || [])),
    safe(`${label} deal stages`,  () => api('/selector/deal_stages').then(d => d.deal_stages || [])),
    safe(`${label} deal reasons`, () => api('/selector/deal_reasons').then(d => d.deal_reasons || [])),
    safe(`${label} lead sources`, () => api('/selector/lead_sources').then(d => d.lead_sources || [])),
  ]);

  // Filter active owners
  const owners = allOwners.filter(u => u.active !== false && u.is_active !== false && u.deactivated !== true);

  // Filter accounts: last 12 months activity
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const activeAccounts = accounts.filter(a => {
    const d = a.last_activity_date || a.last_contacted || a.updated_at;
    return d && new Date(d) >= cutoff;
  });

  // Build a stage lookup map for THIS account's stages
  const stageMap = {};
  deal_stages.forEach(s => { stageMap[s.id] = s.name; });

  // Merge + dedupe deals, tag with account label + color + resolved stage name
  const map = new Map();
  [...openDeals, ...wonDeals, ...lostDeals].forEach(d => map.set(d.id, d));
  const deals = [...map.values()].map(d => ({
    ...d,
    _crm: label,
    _crm_color: color,
    _crm_subdomain: subdomain,
    // Resolve stage name here on the server using THIS account's stage list
    _stage_name: d.deal_stage?.name
                 || stageMap[d.deal_stage_id]
                 || d.deal_stage?.label
                 || 'Unknown',
  }));

  // Tag accounts too
  const taggedAccounts = activeAccounts.map(a => ({ ...a, _crm: label, _crm_color: color }));
  const taggedAllAccounts = accounts.map(a => ({ ...a, _crm: label, _crm_color: color }));

  // Tag owners
  const taggedOwners = owners.map(u => ({ ...u, _crm: label }));

  const accountById = {};
  accounts.forEach(a => { accountById[`${label}_${a.id}`] = a; });

  console.log(`  ✓ ${label}: ${deals.length} deals | ${activeAccounts.length} accounts | ${owners.length} owners`);

  return {
    label, subdomain, color,
    deals, accounts: taggedAccounts, allAccounts: taggedAllAccounts,
    owners: taggedOwners, deal_stages, deal_reasons, lead_sources, accountById,
  };
}

// ═══════════════════════════════════════════════════
// MAIN REPORT ENDPOINT — fetches ALL accounts
// ═══════════════════════════════════════════════════
app.get('/api/full-report', async (req, res) => {
  try {
    console.log('\n════ Starting multi-account report ════');

    // Fetch all accounts in parallel
    const results = await Promise.allSettled(
      CRM_ACCOUNTS.map(account => fetchAccount(account))
    );

    // Merge everything
    const allDeals        = [];
    const allAccounts     = [];
    const allAllAccounts  = [];
    const allOwners       = [];
    const allDealStages   = [];
    const allDealReasons  = [];
    const allLeadSources  = [];
    const accountById     = {};
    const crmList         = [];   // list of loaded CRM names for filter

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`Account ${CRM_ACCOUNTS[i].label} failed:`, r.reason?.message);
        return;
      }
      const d = r.value;
      allDeals.push(...d.deals);
      allAccounts.push(...d.accounts);
      allAllAccounts.push(...d.allAccounts);
      allOwners.push(...d.owners);
      // Merge lookup lists (dedupe by name)
      d.deal_stages.forEach(s => { if (!allDealStages.find(x=>x.name===s.name)) allDealStages.push(s); });
      d.deal_reasons.forEach(s => { if (!allDealReasons.find(x=>x.name===s.name)) allDealReasons.push(s); });
      d.lead_sources.forEach(s => { if (!allLeadSources.find(x=>x.name===s.name)) allLeadSources.push(s); });
      Object.assign(accountById, d.accountById);
      crmList.push({ label: d.label, color: d.color, dealCount: d.deals.length });
    });

    console.log(`\n✓ Total: ${allDeals.length} deals | ${allAccounts.length} accounts | ${allOwners.length} owners`);
    console.log('CRM accounts loaded:', crmList.map(c=>`${c.label}(${c.dealCount})`).join(', '));

    res.json({
      deals: allDeals,
      accounts: allAccounts,
      allAccounts: allAllAccounts,
      owners: allOwners,
      deal_stages: allDealStages,
      deal_reasons: allDealReasons,
      lead_sources: allLeadSources,
      accountById,
      crmList,           // tell the UI which CRMs were loaded
      sales_activities: [],
      tasks: [],
    });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── On-demand activities (from first account only for now) ──
app.get('/api/activities', async (req, res) => {
  const account = CRM_ACCOUNTS[0];
  const base = makeBase(account.subdomain);
  try {
    const items = [];
    for (let p = 1; p <= 5; p++) {
      const data = await apiCall(base, account.api_key, `/sales_activities?per_page=100&page=${p}&sort_by=created_at&sort_order=desc`);
      const batch = data.sales_activities || data.collection || [];
      items.push(...batch.map(a => ({ ...a, _crm: account.label })));
      if (p >= (data.meta?.total_pages || 1) || !batch.length) break;
    }
    console.log(`  ✓ activities: ${items.length}`);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI insights ──
app.post('/api/insights', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.json({ insights: ruleInsights(req.body), ceo_summary: ceoBullets(req.body) });
  try {
    const d = req.body;
    const prompt = `You are a McKinsey Sales Advisor. Give CEO_SUMMARY (5 bullets) and PIPELINE_INSIGHTS (6 numbered). Use exact numbers. Format exactly:
CEO_SUMMARY:\n• ...\nPIPELINE_INSIGHTS:\n1. ...\n\nData: ${d.totalDeals} deals | won $${(d.wonValue||0).toLocaleString()} | lost $${(d.lostValue||0).toLocaleString()} | win rate ${d.winRate}% | coverage ${d.coverageRatio}x | stalled ${d.stalledDeals} | top rep ${d.topRep} ${d.topRepRate}% | bottom ${d.bottomRep} ${d.bottomRepRate}% | top loss reason: ${(d.lostReasons||[]).slice(0,2).map(r=>r.name+'('+r.count+')').join(', ')}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    const ceoMatch = text.match(/CEO_SUMMARY:([\s\S]*?)(?:PIPELINE_INSIGHTS:|$)/);
    const ceo_summary = ceoMatch ? ceoMatch[1].trim().split('\n').map(l=>l.replace(/^[•\-\*]\s*/,'')).filter(Boolean) : [];
    const insMatch = text.match(/PIPELINE_INSIGHTS:([\s\S]*)/);
    const insights = insMatch ? insMatch[1].trim().split('\n').filter(l=>l.match(/^\d+\./)).map(l=>l.replace(/^\d+\.\s*/,'').trim()).filter(Boolean) : [];
    res.json({ insights: insights.length ? insights : ruleInsights(d), ceo_summary: ceo_summary.length ? ceo_summary : ceoBullets(d) });
  } catch (e) { res.json({ insights: ruleInsights(req.body), ceo_summary: ceoBullets(req.body) }); }
});

function ceoBullets(d) {
  const wr = d.winRate||0;
  return [
    `${wr>=50?'✓':'△'} Win rate ${wr}% across ${d.totalDeals} deals — ${wr>=50?'above':'below'} 40% threshold`,
    `Open pipeline $${(d.openValue||0).toLocaleString()} = ${d.coverageRatio}x coverage ratio`,
    `${d.stalledDeals||0} deals stalled 30+ days — review and advance or disqualify`,
    `Top loss reason: "${(d.lostReasons||[{}])[0]?.name||'Unknown'}" (${(d.lostReasons||[{}])[0]?.count||0} deals)`,
    `Performance gap: ${d.topRep} at ${d.topRepRate}% vs ${d.bottomRep} at ${d.bottomRepRate}%`,
  ];
}

function ruleInsights(d) {
  const i = [], wr = d.winRate||0;
  if (wr < 30) i.push(`Win rate ${wr}% critically below 30% — audit last 90 days of lost deals immediately.`);
  else if (wr >= 50) i.push(`Win rate ${wr}% is strong — protect it by ensuring every open deal has a close plan.`);
  else i.push(`Win rate ${wr}% — tighten stage-entry qualification to push above 40%.`);
  if (d.stalledDeals > 0) i.push(`${d.stalledDeals} deals stale 30d+ — advance or disqualify to clean forecast.`);
  if ((d.lostReasons||[]).length) i.push(`"${d.lostReasons[0].name}" is #1 loss driver (${d.lostReasons[0].count}) — build a counter-playbook.`);
  if (d.openValue > (d.wonValue||1)*2) i.push(`Open pipeline is ${Math.round((d.openValue||0)/(d.wonValue||1))}× won — create close plans for top 10 open deals.`);
  if (d.topRep) i.push(`${d.topRep} leads at ${d.topRepRate}% — run a peer coaching session this week.`);
  if (d.bottomRep) i.push(`${d.bottomRep} at ${d.bottomRepRate}% — 30-day improvement plan needed.`);
  return i.slice(0,6);
}

// ── Config endpoint — so UI can show which accounts are loaded ──
app.get('/api/config', (req, res) => {
  res.json({
    accounts: CRM_ACCOUNTS.map(a => ({ label: a.label, subdomain: a.subdomain, color: a.color }))
  });
});

app.listen(PORT, () => {
  console.log(`\n✅  Multi-account CRM server → http://localhost:${PORT}`);
  console.log(`   Accounts configured: ${CRM_ACCOUNTS.map(a=>a.label).join(' · ')}`);
  console.log(ANTHROPIC_KEY ? '   ✓ AI insights enabled' : '   ℹ  Rule-based insights');
});