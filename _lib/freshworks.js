// ═══════════════════════════════════════════════════
// Shared Freshworks CRM helpers — used by all /api routes
// API keys: set env vars in Vercel dashboard, fall back to
// hardcoded values for local dev (node server.js)
// ═══════════════════════════════════════════════════
const CRM_ACCOUNTS = [
  {
    label:     'Contentech',
    subdomain: 'contentech',
    api_key:   process.env.CT_API_KEY || 'BxeRQEkiETipzcChVj_YnA',
    color:     '#2563eb',
  },
  {
    label:     'Future Trans',
    subdomain: 'futuretrans-org',
    api_key:   process.env.FT_API_KEY || 'NaGGhD-UQDkzQ99WJEmXiQ',
    color:     '#059669',
  },
  {
    label:     'FG Global',
    subdomain: 'fg-global',
    api_key:   process.env.FG_API_KEY || 'd5a_Je4HBnF5quoax817og',
    color:     '#7c3aed',
  },
];

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
      headers: {
        'Authorization': `Token token=${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${txt.slice(0, 150)}`);
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
  }
}

async function safe(label, fn, fallback = []) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`  ✗ ${label}: ${e.message}`);
    return fallback;
  }
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

async function fetchAccount(account) {
  const { label, subdomain, api_key, color } = account;
  const base = makeBase(subdomain);
  const api = (ep) => apiCall(base, api_key, ep);

  const [dealFilters, acctFilters] = await Promise.all([
    safe(`${label} deal filters`,    () => api('/deals/filters').then(d => d.filters || []),          []),
    safe(`${label} account filters`, () => api('/sales_accounts/filters').then(d => d.filters || []), []),
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

  const owners = allOwners.filter(u => u.active !== false && u.is_active !== false && u.deactivated !== true);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const activeAccounts = accounts.filter(a => {
    const d = a.last_activity_date || a.last_contacted || a.updated_at;
    return d && new Date(d) >= cutoff;
  });

  const stageMap = {};
  deal_stages.forEach(s => { stageMap[s.id] = s.name; });

  const map = new Map();
  [...openDeals, ...wonDeals, ...lostDeals].forEach(d => map.set(d.id, d));
  const deals = [...map.values()].map(d => ({
    ...d,
    _crm: label,
    _crm_color: color,
    _crm_subdomain: subdomain,
    _stage_name: d.deal_stage?.name
                 || stageMap[d.deal_stage_id]
                 || d.deal_stage?.label
                 || 'Unknown',
  }));

  const taggedAccounts    = activeAccounts.map(a => ({ ...a, _crm: label, _crm_color: color }));
  const taggedAllAccounts = accounts.map(a => ({ ...a, _crm: label, _crm_color: color }));
  const taggedOwners      = owners.map(u => ({ ...u, _crm: label }));

  const accountById = {};
  accounts.forEach(a => { accountById[`${label}_${a.id}`] = a; });

  return {
    label, subdomain, color,
    deals, accounts: taggedAccounts, allAccounts: taggedAllAccounts,
    owners: taggedOwners, deal_stages, deal_reasons, lead_sources, accountById,
  };
}

module.exports = { CRM_ACCOUNTS, makeBase, apiCall, safe, fetchView, findView, fetchAccount };
