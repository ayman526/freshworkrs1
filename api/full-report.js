const { CRM_ACCOUNTS, fetchAccount } = require('../_lib/freshworks');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const results = await Promise.allSettled(
      CRM_ACCOUNTS.map(account => fetchAccount(account))
    );

    const allDeals       = [];
    const allAccounts    = [];
    const allAllAccounts = [];
    const allOwners      = [];
    const allDealStages  = [];
    const allDealReasons = [];
    const allLeadSources = [];
    const accountById    = {};
    const crmList        = [];

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
      d.deal_stages.forEach(s => { if (!allDealStages.find(x => x.name === s.name)) allDealStages.push(s); });
      d.deal_reasons.forEach(s => { if (!allDealReasons.find(x => x.name === s.name)) allDealReasons.push(s); });
      d.lead_sources.forEach(s => { if (!allLeadSources.find(x => x.name === s.name)) allLeadSources.push(s); });
      Object.assign(accountById, d.accountById);
      crmList.push({ label: d.label, color: d.color, dealCount: d.deals.length });
    });

    console.log(`✓ Total: ${allDeals.length} deals | ${allAccounts.length} accounts | ${allOwners.length} owners`);

    res.json({
      deals:         allDeals,
      accounts:      allAccounts,
      allAccounts:   allAllAccounts,
      owners:        allOwners,
      deal_stages:   allDealStages,
      deal_reasons:  allDealReasons,
      lead_sources:  allLeadSources,
      accountById,
      crmList,
      sales_activities: [],
      tasks: [],
    });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
