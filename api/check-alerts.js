const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;
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
    body: JSON.stringify(JSON.stringify(data))
  });
}

async function getPrice(symbol) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
    const d = await r.json();
    return parseFloat(d.price);
  } catch {
    try {
      const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`);
      const d = await r.json();
      return parseFloat(d.data?.[0]?.last);
    } catch { return null; }
  }
}

async function sendTelegram(token, chatId, text) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

function fmtPrice(p) {
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Redis env vars missing' });
  }

  if (CRON_SECRET && req.query.key !== CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const data = await redisGet();
  if (!data || !data.alerts?.length) {
    return res.status(200).json({ checked: 0, triggered: 0 });
  }

  const { alerts, telegram } = data;
  const { token, chatId } = telegram || {};
  if (!token || !chatId) {
    return res.status(200).json({ checked: 0, triggered: 0, reason: 'no telegram config' });
  }

  const pending = alerts.filter(a => !a.triggered);
  if (!pending.length) return res.status(200).json({ checked: 0, triggered: 0 });

  const symbols = [...new Set(pending.map(a => a.symbol))];
  const prices = {};
  await Promise.all(symbols.map(async s => { prices[s] = await getPrice(s); }));

  let triggered = 0;
  for (const alert of pending) {
    const price = prices[alert.symbol];
    if (price == null) continue;
    const hit = alert.condition === 'above' ? price >= alert.target : price <= alert.target;
    if (hit) {
      alert.triggered = true;
      alert.triggeredAt = Date.now();
      triggered++;
      const dir = alert.condition === 'above' ? 'VƯỢT TRÊN ↑' : 'XUỐNG DƯỚI ↓';
      await sendTelegram(token, chatId,
        `⚡ <b>${alert.symbol}</b> đã ${dir} <b>${fmtPrice(alert.target)}</b>\nGiá hiện tại: <b>${fmtPrice(price)}</b>`
      );
    }
  }

  if (triggered > 0) await redisSet({ ...data, alerts });

  return res.status(200).json({ checked: pending.length, triggered });
}
