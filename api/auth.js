const crypto = require('crypto');

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const SALT    = process.env.AUTH_SALT || 'fgls-dashboard-v1';

function makeToken(pw) {
  return crypto.createHmac('sha256', SALT).update(pw).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const { password, token } = req.body || {};

  // Verify an existing token
  if (token) {
    const expected = makeToken(PASSWORD);
    const valid = PASSWORD && crypto.timingSafeEqual(
      Buffer.from(token.padEnd(64, '0').slice(0, 64)),
      Buffer.from(expected.padEnd(64, '0').slice(0, 64))
    );
    return res.json({ ok: !!valid });
  }

  // Validate a password
  if (!password) return res.status(400).json({ ok: false, error: 'No password provided' });
  if (!PASSWORD)  return res.status(500).json({ ok: false, error: 'DASHBOARD_PASSWORD env var not set' });

  if (password === PASSWORD) {
    return res.json({ ok: true, token: makeToken(PASSWORD) });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
};
