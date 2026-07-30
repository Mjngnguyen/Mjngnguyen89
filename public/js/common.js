/* Dùng chung cho index.html / backtest.html / alert.html — fetch có timeout + fallback Binance->OKX, và các chỉ báo kỹ thuật cơ bản */

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchTicker(sym) {
  try {
    const r = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym.binance}`);
    return {
      exchange: 'BINANCE',
      last: parseFloat(r.lastPrice),
      chg24h: parseFloat(r.priceChangePercent),
      volume24h: parseFloat(r.quoteVolume)
    };
  } catch (e) {
    if (typeof log === 'function') log(`Binance ticker lỗi (${sym.id}): ${e.message} → chuyển sang OKX`);
    const r = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${sym.okx}`);
    const d = r.data[0];
    const last = parseFloat(d.last), open = parseFloat(d.open24h);
    return {
      exchange: 'OKX',
      last,
      chg24h: open ? (last - open) / open * 100 : 0,
      volume24h: parseFloat(d.volCcy24h)
    };
  }
}

async function fetchKlines(sym, tf) {
  try {
    const r = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${sym.binance}&interval=${tf.binance}&limit=300`);
    return {
      exchange: 'BINANCE',
      candles: r.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    };
  } catch (e) {
    if (typeof log === 'function') log(`Binance klines lỗi (${sym.id}): ${e.message} → chuyển sang OKX`);
    const r = await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${sym.okx}&bar=${tf.okx}&limit=300`);
    const candles = r.data
      .map(k => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
      .reverse();
    return { exchange: 'OKX', candles };
  }
}

/* ===== chỉ báo — tính trên toàn mảng, trả về giá trị mới nhất ===== */
function sma(arr, p) { if (arr.length < p) return null; return arr.slice(-p).reduce((a, b) => a + b, 0) / p; }
function emaSeries(arr, p) {
  if (arr.length < p) return [];
  const k = 2 / (p + 1); const out = []; let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p; out.push(e);
  for (let i = p; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); } return out;
}
function ema(arr, p) { const s = emaSeries(arr, p); return s.length ? s[s.length - 1] : null; }
function rsi(arr, p = 14) {
  if (arr.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = arr.length - p; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; if (d >= 0) g += d; else l -= d; }
  const ag = g / p, al = l / p; if (al === 0) return 100; return 100 - 100 / (1 + ag / al);
}
function sharpeRatio(prices, days = 30) {
  if (!prices || prices.length < days + 1) return null;
  const slice = prices.slice(-(days + 1));
  const returns = [];
  for (let i = 1; i < slice.length; i++) returns.push((slice[i] - slice[i - 1]) / slice[i - 1]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return (mean / std) * Math.sqrt(365);
}
function macd(arr) {
  if (arr.length < 35) return null;
  const e12 = emaSeries(arr, 12), e26 = emaSeries(arr, 26);
  const off = e12.length - e26.length;
  const line = e26.map((v, i) => e12[i + off] - v);
  const sig = ema(line, 9);
  const now = line[line.length - 1];
  return { macd: now, signal: sig, hist: now - sig };
}

/* ===== chỉ báo — tính tại 1 mốc thời gian bất kỳ trong quá khứ (dùng cho backtest) ===== */
function smaAt(arr, i, p) { if (i < p - 1) return null; let s = 0; for (let j = i - p + 1; j <= i; j++) s += arr[j]; return s / p; }
function rsiAt(arr, i, p = 14) {
  if (i < p) return null;
  let g = 0, l = 0;
  for (let j = i - p + 1; j <= i; j++) { const d = arr[j] - arr[j - 1]; if (d >= 0) g += d; else l -= d; }
  const ag = g / p, al = l / p; if (al === 0) return 100; return 100 - 100 / (1 + ag / al);
}
