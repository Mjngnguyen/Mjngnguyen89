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

async function getDailyCloses(symbol, limit = 210) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=${limit}`);
    const d = await r.json();
    return d.map(k => parseFloat(k[4]));
  } catch {
    try {
      const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT&bar=1D&limit=${limit}`);
      const d = await r.json();
      return d.data.map(row => parseFloat(row[4])).reverse();
    } catch { return null; }
  }
}

function smaTail(arr, p) { if (arr.length < p) return null; return arr.slice(-p).reduce((a, b) => a + b, 0) / p; }
function rsiTail(arr, p = 14) {
  if (arr.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = arr.length - p; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; if (d >= 0) g += d; else l -= d; }
  const ag = g / p, al = l / p; if (al === 0) return 100; return 100 - 100 / (1 + ag / al);
}

// Golden/Death Cross được xác định bằng so sánh MA50 vs MA200 của hôm nay so với hôm qua,
// tính trực tiếp từ dữ liệu nến ngày — không cần lưu trạng thái giữa các lần chạy.
async function getIndicatorData(symbol) {
  const closes = await getDailyCloses(symbol, 210);
  if (!closes || closes.length < 201) return null;
  const rsi14 = rsiTail(closes, 14);
  const prevCloses = closes.slice(0, -1);
  const nowAbove = smaTail(closes, 50) > smaTail(closes, 200);
  const prevAbove = smaTail(prevCloses, 50) > smaTail(prevCloses, 200);
  return {
    rsi14,
    crossedUp: prevAbove === false && nowAbove === true,
    crossedDown: prevAbove === true && nowAbove === false
  };
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

  const priceAlerts = pending.filter(a => (a.type || 'price') === 'price');
  const indicatorAlerts = pending.filter(a => a.type === 'indicator');

  const priceSymbols = [...new Set(priceAlerts.map(a => a.symbol))];
  const prices = {};
  await Promise.all(priceSymbols.map(async s => { prices[s] = await getPrice(s); }));

  const indicatorSymbols = [...new Set(indicatorAlerts.map(a => a.symbol))];
  const indicators = {};
  await Promise.all(indicatorSymbols.map(async s => { indicators[s] = await getIndicatorData(s); }));

  const INDICATOR_LABEL = {
    rsi_oversold: 'RSI(14) &lt; 30 (quá bán)',
    rsi_overbought: 'RSI(14) &gt; 70 (quá mua)',
    golden_cross: 'Golden Cross (MA50 vượt lên MA200)',
    death_cross: 'Death Cross (MA50 xuống dưới MA200)'
  };

  let triggered = 0;
  for (const alert of priceAlerts) {
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

  for (const alert of indicatorAlerts) {
    const ind = indicators[alert.symbol];
    if (!ind) continue;
    let hit = false;
    if (alert.indicator === 'rsi_oversold') hit = ind.rsi14 != null && ind.rsi14 < 30;
    else if (alert.indicator === 'rsi_overbought') hit = ind.rsi14 != null && ind.rsi14 > 70;
    else if (alert.indicator === 'golden_cross') hit = ind.crossedUp;
    else if (alert.indicator === 'death_cross') hit = ind.crossedDown;
    if (hit) {
      alert.triggered = true;
      alert.triggeredAt = Date.now();
      triggered++;
      const label = INDICATOR_LABEL[alert.indicator] || alert.indicator;
      const rsiLine = ind.rsi14 != null ? `\nRSI(14) hiện tại: <b>${ind.rsi14.toFixed(1)}</b>` : '';
      await sendTelegram(token, chatId,
        `📊 <b>${alert.symbol}</b> — ${label}${rsiLine}`
      );
    }
  }

  if (triggered > 0) await redisSet({ ...data, alerts });

  return res.status(200).json({ checked: pending.length, triggered });
}
