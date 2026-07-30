const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'price-alert-sentinel';

async function redisGet() {
  const r = await fetch(`${REDIS_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const { result } = await r.json();
  return result ? JSON.parse(result) : null;
}

async function getTicker(symbol) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
    const d = await r.json();
    return { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent) };
  } catch {
    try {
      const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`);
      const d = await r.json();
      const t = d.data?.[0];
      const price = parseFloat(t?.last);
      const open = parseFloat(t?.open24h);
      const change = open ? ((price - open) / open) * 100 : 0;
      return { price, change };
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
  if (!p) return 'N/A';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

function fmtChange(c) {
  if (c == null) return '';
  return (c >= 0 ? '▲ +' : '▼ ') + c.toFixed(2) + '%';
}

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Redis env vars missing' });
  }

  const data = await redisGet();
  const { telegram, watchlist = [], alerts = [] } = data || {};
  const { token, chatId } = telegram || {};

  if (!token || !chatId) {
    return res.status(200).json({ sent: false, reason: 'no telegram config' });
  }

  const coins = watchlist.length ? watchlist : ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
  const tickers = await Promise.all(coins.map(async s => ({ s, ...(await getTicker(s) || {}) })));

  const lines = tickers.map(t => {
    const arrow = (t.change || 0) >= 0 ? '🟢' : '🔴';
    return `${arrow} <b>${t.s}</b>: ${fmtPrice(t.price)} <i>(${fmtChange(t.change)})</i>`;
  });

  const pendingAlerts = alerts.filter(a => !a.triggered);
  const alertLine = pendingAlerts.length
    ? `\n⏳ <b>${pendingAlerts.length}</b> cảnh báo đang chờ`
    : '\n✅ Không có cảnh báo nào đang chờ';

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = `📊 <b>Tóm tắt thị trường</b> — ${now}\n\n${lines.join('\n')}${alertLine}`;

  await sendTelegram(token, chatId, msg);
  return res.status(200).json({ sent: true, coins: coins.length });
}
