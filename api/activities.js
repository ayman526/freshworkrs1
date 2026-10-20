const { CRM_ACCOUNTS, makeBase, apiCall } = require('../_lib/freshworks');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const account = CRM_ACCOUNTS[0];
  const base = makeBase(account.subdomain);
  try {
    const items = [];
    for (let p = 1; p <= 5; p++) {
      const data = await apiCall(
        base,
        account.api_key,
        `/sales_activities?per_page=100&page=${p}&sort_by=created_at&sort_order=desc`
      );
      const batch = data.sales_activities || data.collection || [];
      items.push(...batch.map(a => ({ ...a, _crm: account.label })));
      if (p >= (data.meta?.total_pages || 1) || !batch.length) break;
    }
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
