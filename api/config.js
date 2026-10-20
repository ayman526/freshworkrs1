const { CRM_ACCOUNTS } = require('../_lib/freshworks');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  res.json({
    crmAccounts: CRM_ACCOUNTS.map(a => ({
      label: a.label,
      color: a.color,
      subdomain: a.subdomain,
    })),
  });
};
