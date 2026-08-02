const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const API_SECRET = process.env.ALERTS_API_SECRET;
const KEY = 'price-alert-sentinel';

async function redisGet() {
  const r = await fetch(`${REDIS_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const { result } = await r.json();
  return result ? JSON.parse(result) : null;
}

async function redisSet(data) {
  await fetch(`${REDIS_URL}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars required' });
  }

  if (API_SECRET && req.headers['x-api-key'] !== API_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    const data = await redisGet();
    return res.status(200).json(data || { alerts: [], telegram: {}, watchlist: [] });
  }

  if (req.method === 'POST') {
    const { alerts = [], telegram = {}, watchlist = [] } = req.body;
    if (!Array.isArray(alerts) || alerts.length > 50) {
      return res.status(400).json({ error: 'invalid alerts (max 50)' });
    }
    if (!Array.isArray(watchlist) || watchlist.length > 50) {
      return res.status(400).json({ error: 'invalid watchlist (max 50)' });
    }
    await redisSet({ alerts, telegram, watchlist, updatedAt: Date.now() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
