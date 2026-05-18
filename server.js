const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { URL } = require("url");

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || "0.0.0.0";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "state.json");

const STOCKS = [
  { symbol: "600519.SH", yahoo: "600519.SS", name: "贵州茅台", market: "A", currency: "CNY", lotSize: 100, base: 1540 },
  { symbol: "300750.SZ", yahoo: "300750.SZ", name: "宁德时代", market: "A", currency: "CNY", lotSize: 100, base: 205 },
  { symbol: "510300.SH", yahoo: "510300.SS", name: "沪深300ETF", market: "A", currency: "CNY", lotSize: 100, base: 3.8 },
  { symbol: "159915.SZ", yahoo: "159915.SZ", name: "创业板ETF", market: "A", currency: "CNY", lotSize: 100, base: 1.9 },
  { symbol: "AAPL", yahoo: "AAPL", name: "Apple", market: "US", currency: "USD", lotSize: 1, base: 190 },
  { symbol: "MSFT", yahoo: "MSFT", name: "Microsoft", market: "US", currency: "USD", lotSize: 1, base: 420 },
  { symbol: "NVDA", yahoo: "NVDA", name: "NVIDIA", market: "US", currency: "USD", lotSize: 1, base: 980 },
  { symbol: "SPY", yahoo: "SPY", name: "S&P 500 ETF", market: "US", currency: "USD", lotSize: 1, base: 520 },
  { symbol: "QQQ", yahoo: "QQQ", name: "Nasdaq 100 ETF", market: "US", currency: "USD", lotSize: 1, base: 445 }
];

const stockMap = new Map(STOCKS.map((stock) => [stock.symbol, stock]));

const DATA_SOURCES = [
  { id: "eastmoney", name: "东方财富", markets: ["A"], usage: "A股现价和K线优先来源，免费接口，可能限流或变化。" },
  { id: "yahoo", name: "Yahoo Finance", markets: ["A", "US"], usage: "A股和美股行情/K线备选来源，免费接口，可能延迟或失败。" },
  { id: "stooq", name: "Stooq", markets: ["US"], usage: "美股日线备选来源，偏历史数据，不适合实时盯盘。" },
  { id: "simulated", name: "仿真行情", markets: ["A", "US"], usage: "所有外部来源失败时启用，保证模拟练习不断档。" }
];

function defaultState() {
  return {
    accounts: {
      A: { opened: true, name: "A股模拟账户", openedAt: new Date().toISOString() },
      US: { opened: true, name: "美股模拟账户", openedAt: new Date().toISOString() }
    },
    settings: {
      aCommissionRate: 0.00025,
      aMinCommission: 5,
      aStampDutyRate: 0.0005,
      aTransferRate: 0.00001,
      usCommissionRate: 0.0005,
      usMinCommission: 0.01,
      usdToCny: 7.2
    },
    cash: { CNY: 100000, USD: 10000 },
    positions: {},
    orders: [],
    journal: [],
    watchlist: ["510300.SH", "159915.SZ", "600519.SH", "AAPL", "MSFT", "NVDA", "SPY"],
    createdAt: new Date().toISOString()
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState(), null, 2));
  }
}

function readState() {
  ensureDataFile();
  return normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}

function writeState(state) {
  normalizeState(state);
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function normalizeState(state) {
  const defaults = defaultState();
  state.accounts = state.accounts || defaults.accounts;
  state.settings = { ...defaults.settings, ...(state.settings || {}) };
  state.cash = { ...defaults.cash, ...(state.cash || {}) };
  state.positions = state.positions || {};
  state.orders = state.orders || [];
  state.journal = state.journal || [];
  state.watchlist = state.watchlist || defaults.watchlist;
  return state;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function cookieValue(req, name) {
  const cookies = req.headers.cookie || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function sessionToken() {
  const value = "stock-practice";
  return `${value}.${sign(value)}`;
}

function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const token = cookieValue(req, "spl_session");
  const [value, signature] = token.split(".");
  if (!value || !signature) return false;
  const expected = sign(value);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `spl_session=${encodeURIComponent(sessionToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "spl_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function marketStatus(market, now = new Date()) {
  const beijing = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const date = market === "A" ? beijing : ny;
  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (day === 0 || day === 6) return { open: false, label: "周末休市" };
  if (market === "A") {
    if ((minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900)) return { open: true, label: "A股交易中" };
    if (minutes > 690 && minutes < 780) return { open: false, label: "A股午休" };
    return { open: false, label: "A股休市" };
  }
  if (minutes >= 570 && minutes <= 960) return { open: true, label: "美股交易中" };
  return { open: false, label: "美股休市" };
}

function seededNoise(symbol) {
  const day = Math.floor(Date.now() / 86400000);
  let hash = day;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  return (hash / 100000 - 0.5) * 0.08;
}

function fallbackQuote(stock) {
  const minuteWave = Math.sin(Date.now() / 900000 + stock.symbol.length) * 0.012;
  const drift = seededNoise(stock.symbol);
  const previousClose = stock.base * (1 - drift / 2);
  const price = Math.max(0.01, stock.base * (1 + drift + minuteWave));
  const change = price - previousClose;
  return {
    ...stock,
    price: Number(price.toFixed(stock.currency === "CNY" && price < 10 ? 3 : 2)),
    previousClose: Number(previousClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(((change / previousClose) * 100).toFixed(2)),
    time: new Date().toISOString(),
    source: "仿真行情"
  };
}

async function fetchYahoo(stock) {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(stock.yahoo)}?range=1d&interval=1m`;
  const signal = AbortSignal.timeout(4000);
  const response = await fetch(endpoint, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0"
    }
  });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const payload = await response.json();
  const result = payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result || !result.meta) throw new Error("No quote");
  const meta = result.meta;
  const price = Number(meta.regularMarketPrice || meta.previousClose || stock.base);
  const previousClose = Number(meta.previousClose || price);
  const change = price - previousClose;
  return {
    ...stock,
    price: Number(price.toFixed(stock.currency === "CNY" && price < 10 ? 3 : 2)),
    previousClose: Number(previousClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(previousClose ? ((change / previousClose) * 100).toFixed(2) : 0),
    time: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    source: "Yahoo Finance"
  };
}

function eastmoneySecid(stock) {
  const code = stock.symbol.split(".")[0];
  if (stock.symbol.endsWith(".SH")) return `1.${code}`;
  if (stock.symbol.endsWith(".SZ")) return `0.${code}`;
  return "";
}

function eastmoneyPrice(value, stock) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const byHundred = number / 100;
  const byThousand = number / 1000;
  if (stock.base < 20 && byHundred > stock.base * 3 && byThousand < stock.base * 3) return byThousand;
  return byHundred;
}

async function fetchEastmoneyQuote(stock) {
  const secid = eastmoneySecid(stock);
  if (!secid) throw new Error("No Eastmoney secid");
  const endpoint = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f43,f44,f45,f46,f47,f57,f58,f60,f169,f170`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(3500),
    headers: { "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0" }
  });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  const payload = await response.json();
  const data = payload.data;
  if (!data) throw new Error("No Eastmoney quote");
  const price = eastmoneyPrice(data.f43, stock);
  const previousClose = eastmoneyPrice(data.f60, stock);
  if (!price || !previousClose) throw new Error("Invalid Eastmoney quote");
  const change = price - previousClose;
  return {
    ...stock,
    price: Number(price.toFixed(stock.currency === "CNY" && price < 10 ? 3 : 2)),
    previousClose: Number(previousClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(((change / previousClose) * 100).toFixed(2)),
    time: new Date().toISOString(),
    source: "东方财富"
  };
}

function stooqSymbol(stock) {
  if (stock.market !== "US") return "";
  return `${stock.symbol.toLowerCase()}.us`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((item) => item.trim().toLowerCase());
  return lines.map((line) => {
    const values = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    return row;
  });
}

async function fetchStooqQuote(stock) {
  const symbol = stooqSymbol(stock);
  if (!symbol) throw new Error("No Stooq symbol");
  const endpoint = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(3500),
    headers: { "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0" }
  });
  if (!response.ok) throw new Error(`Stooq ${response.status}`);
  const [row] = parseCsv(await response.text());
  const price = Number(row.close);
  const open = Number(row.open);
  if (!Number.isFinite(price) || !Number.isFinite(open) || price <= 0) throw new Error("Invalid Stooq quote");
  const change = price - open;
  return {
    ...stock,
    price: Number(price.toFixed(2)),
    previousClose: Number(open.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePct: Number(((change / open) * 100).toFixed(2)),
    time: new Date().toISOString(),
    source: "Stooq"
  };
}

async function fetchYahooCandles(stock, range = "1mo", interval = "1d") {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(stock.yahoo)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0"
    }
  });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const payload = await response.json();
  const result = payload.chart && payload.chart.result && payload.chart.result[0];
  const timestamps = result && result.timestamp;
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  if (!timestamps || !quote) throw new Error("No candle data");
  return timestamps.map((time, index) => ({
    time: new Date(time * 1000).toISOString(),
    open: quote.open[index],
    high: quote.high[index],
    low: quote.low[index],
    close: quote.close[index],
    volume: quote.volume[index] || 0
  })).filter((item) => [item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value))).map((item) => ({
    time: item.time,
    open: Number(item.open.toFixed(3)),
    high: Number(item.high.toFixed(3)),
    low: Number(item.low.toFixed(3)),
    close: Number(item.close.toFixed(3)),
    volume: item.volume
  }));
}

async function fetchEastmoneyCandles(stock, range = "1mo") {
  const secid = eastmoneySecid(stock);
  if (!secid) throw new Error("No Eastmoney secid");
  const klt = range === "1d" ? "5" : "101";
  const lmt = range === "1y" ? "260" : range === "3mo" ? "90" : range === "1d" ? "80" : "40";
  const endpoint = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=${klt}&fqt=1&beg=0&end=20500000&lmt=${lmt}`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0" }
  });
  if (!response.ok) throw new Error(`Eastmoney ${response.status}`);
  const payload = await response.json();
  const klines = payload.data && payload.data.klines;
  if (!Array.isArray(klines) || !klines.length) throw new Error("No Eastmoney candles");
  return klines.slice(-Number(lmt)).map((line) => {
    const [date, open, close, high, low, volume] = line.split(",");
    return {
      time: new Date(date.replace(" ", "T")).toISOString(),
      open: Number(Number(open).toFixed(3)),
      high: Number(Number(high).toFixed(3)),
      low: Number(Number(low).toFixed(3)),
      close: Number(Number(close).toFixed(3)),
      volume: Number(volume) || 0
    };
  }).filter((item) => [item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value)));
}

async function fetchStooqCandles(stock) {
  const symbol = stooqSymbol(stock);
  if (!symbol) throw new Error("No Stooq symbol");
  const endpoint = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "Mozilla/5.0 StockPracticeLab/1.0" }
  });
  if (!response.ok) throw new Error(`Stooq ${response.status}`);
  const rows = parseCsv(await response.text()).slice(-260);
  if (!rows.length) throw new Error("No Stooq candles");
  return rows.map((row) => ({
    time: new Date(row.date).toISOString(),
    open: Number(Number(row.open).toFixed(3)),
    high: Number(Number(row.high).toFixed(3)),
    low: Number(Number(row.low).toFixed(3)),
    close: Number(Number(row.close).toFixed(3)),
    volume: Number(row.volume) || 0
  })).filter((item) => [item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value)));
}

function fallbackCandles(stock, points = 40) {
  const candles = [];
  let close = fallbackQuote(stock).previousClose;
  for (let index = points - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 86400000);
    const wave = Math.sin((points - index) / 3 + stock.symbol.length) * 0.018;
    const drift = seededNoise(`${stock.symbol}-${index}`) * 0.4;
    const open = close;
    close = Math.max(0.01, close * (1 + wave + drift));
    const high = Math.max(open, close) * (1 + Math.abs(wave) * 0.7 + 0.004);
    const low = Math.min(open, close) * (1 - Math.abs(drift) * 0.7 - 0.004);
    candles.push({
      time: date.toISOString(),
      open: Number(open.toFixed(3)),
      high: Number(high.toFixed(3)),
      low: Number(low.toFixed(3)),
      close: Number(close.toFixed(3)),
      volume: Math.round(1000000 + Math.abs(wave - drift) * 50000000)
    });
  }
  return candles;
}

async function getQuotes(symbols) {
  return Promise.all(symbols.map(async (symbol) => {
    const stock = stockMap.get(symbol);
    if (!stock) return null;
    if (stock.market === "A") {
      try {
        return await fetchEastmoneyQuote(stock);
      } catch {}
    }
    try {
      return await fetchYahoo(stock);
    } catch {
      if (stock.market === "US") {
        try {
          return await fetchStooqQuote(stock);
        } catch {}
      }
      return fallbackQuote(stock);
    }
  })).then((quotes) => quotes.filter(Boolean));
}

function feeForOrder(stock, side, amount, settings) {
  if (stock.market === "A") {
    const commission = Math.max(settings.aMinCommission, amount * settings.aCommissionRate);
    const stamp = side === "sell" ? amount * settings.aStampDutyRate : 0;
    const transfer = amount * settings.aTransferRate;
    return Number((commission + stamp + transfer).toFixed(2));
  }
  return Number(Math.max(settings.usMinCommission, amount * settings.usCommissionRate).toFixed(2));
}

function canSellToday(state, symbol, quantity) {
  const position = state.positions[symbol];
  if (!position) return false;
  return quantity <= (position.sellable || 0);
}

async function placeOrder(body) {
  const state = readState();
  const stock = stockMap.get(body.symbol);
  if (!stock) return { status: 400, body: { error: "不支持的股票代码" } };
  const side = body.side === "sell" ? "sell" : "buy";
  const quantity = Number(body.quantity);
  const reason = String(body.reason || "").trim();
  if (!Number.isFinite(quantity) || quantity <= 0) return { status: 400, body: { error: "数量不正确" } };
  if (quantity % stock.lotSize !== 0) return { status: 400, body: { error: `${stock.market === "A" ? "A股" : "美股"}需要按 ${stock.lotSize} 股单位交易` } };
  if (reason.length < 4) return { status: 400, body: { error: "先写一句下单理由，训练纪律比猜涨跌更重要" } };

  const [quote] = await getQuotes([stock.symbol]);
  const price = Number(body.orderType === "limit" && body.limitPrice ? body.limitPrice : quote.price);
  if (!Number.isFinite(price) || price <= 0) return { status: 400, body: { error: "价格不正确" } };
  const amount = price * quantity;
  const fee = feeForOrder(stock, side, amount, state.settings);
  const now = new Date().toISOString();

  if (stock.market === "A") {
    const dailyLimit = quote.previousClose * 1.1;
    const dailyFloor = quote.previousClose * 0.9;
    if (price > dailyLimit || price < dailyFloor) {
      return { status: 400, body: { error: "价格超过 A 股涨跌停模拟范围" } };
    }
  }

  if (side === "buy") {
    const total = amount + fee;
    if (state.cash[stock.currency] < total) return { status: 400, body: { error: "现金不足" } };
    state.cash[stock.currency] = Number((state.cash[stock.currency] - total).toFixed(2));
    const current = state.positions[stock.symbol] || {
      symbol: stock.symbol,
      quantity: 0,
      avgCost: 0,
      sellable: 0,
      currency: stock.currency
    };
    const newQuantity = current.quantity + quantity;
    current.avgCost = Number(((current.avgCost * current.quantity + amount + fee) / newQuantity).toFixed(4));
    current.quantity = newQuantity;
    current.sellable += stock.market === "A" ? 0 : quantity;
    current.name = stock.name;
    current.market = stock.market;
    state.positions[stock.symbol] = current;
  } else {
    const current = state.positions[stock.symbol];
    if (!current || current.quantity < quantity) return { status: 400, body: { error: "持仓不足" } };
    if (stock.market === "A" && !canSellToday(state, stock.symbol, quantity)) {
      return { status: 400, body: { error: "A 股模拟 T+1：今天买入的股票明天才能卖出" } };
    }
    current.quantity -= quantity;
    current.sellable = Math.max(0, current.sellable - quantity);
    state.cash[stock.currency] = Number((state.cash[stock.currency] + amount - fee).toFixed(2));
    if (current.quantity === 0) delete state.positions[stock.symbol];
  }

  const order = {
    id: crypto.randomUUID(),
    symbol: stock.symbol,
    name: stock.name,
    market: stock.market,
    currency: stock.currency,
    side,
    quantity,
    price,
    fee,
    amount: Number(amount.toFixed(2)),
    reason,
    orderType: body.orderType || "market",
    createdAt: now
  };
  state.orders.unshift(order);
  state.journal.unshift({
    id: crypto.randomUUID(),
    createdAt: now,
    symbol: stock.symbol,
    title: `${side === "buy" ? "买入" : "卖出"} ${stock.name}`,
    content: reason
  });
  writeState(state);
  return { status: 200, body: { order, state } };
}

function resetNextTradingDay(state) {
  for (const symbol of Object.keys(state.positions)) {
    const position = state.positions[symbol];
    position.sellable = position.quantity;
  }
  state.lastRollover = new Date().toISOString();
  writeState(state);
  return state;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/auth/status") {
    return json(res, 200, { required: Boolean(APP_PASSWORD), authed: isAuthed(req) });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    if (!APP_PASSWORD || String(body.password || "") === APP_PASSWORD) {
      setSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    return json(res, 401, { error: "密码不正确" });
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }
  if (!isAuthed(req)) return json(res, 401, { error: "请先登录" });
  if (url.pathname === "/api/sources") return json(res, 200, { sources: DATA_SOURCES });
  if (url.pathname === "/api/stocks") return json(res, 200, { stocks: STOCKS });
  if (url.pathname === "/api/state") return json(res, 200, readState());
  if (url.pathname === "/api/history") {
    const symbol = url.searchParams.get("symbol") || "510300.SH";
    const range = url.searchParams.get("range") || "1mo";
    const interval = range === "1d" ? "5m" : "1d";
    const stock = stockMap.get(symbol);
    if (!stock) return json(res, 400, { error: "不支持的股票代码" });
    if (stock.market === "A") {
      try {
        const candles = await fetchEastmoneyCandles(stock, range);
        return json(res, 200, { stock, candles, source: "东方财富" });
      } catch {}
    }
    try {
      const candles = await fetchYahooCandles(stock, range, interval);
      return json(res, 200, { stock, candles, source: "Yahoo Finance" });
    } catch {
      if (stock.market === "US" && range !== "1d") {
        try {
          const candles = await fetchStooqCandles(stock);
          return json(res, 200, { stock, candles, source: "Stooq" });
        } catch {}
      }
      return json(res, 200, { stock, candles: fallbackCandles(stock), source: "仿真K线" });
    }
  }
  if (url.pathname === "/api/quotes") {
    const symbols = (url.searchParams.get("symbols") || "").split(",").filter(Boolean);
    const quotes = await getQuotes(symbols.length ? symbols : readState().watchlist);
    return json(res, 200, { quotes, status: { A: marketStatus("A"), US: marketStatus("US") } });
  }
  if (url.pathname === "/api/order" && req.method === "POST") {
    try {
      const result = await placeOrder(await readBody(req));
      return json(res, result.status, result.body);
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }
  if (url.pathname === "/api/watchlist" && req.method === "POST") {
    const state = readState();
    const body = await readBody(req);
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!stockMap.has(symbol)) return json(res, 400, { error: "暂不支持这个代码" });
    if (body.action === "remove") state.watchlist = state.watchlist.filter((item) => item !== symbol);
    else if (!state.watchlist.includes(symbol)) state.watchlist.push(symbol);
    writeState(state);
    return json(res, 200, state);
  }
  if (url.pathname === "/api/journal" && req.method === "POST") {
    const state = readState();
    const body = await readBody(req);
    state.journal.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      symbol: body.symbol || "NOTE",
      title: String(body.title || "复盘记录").slice(0, 40),
      content: String(body.content || "").slice(0, 800)
    });
    writeState(state);
    return json(res, 200, state);
  }
  if (url.pathname === "/api/deposit" && req.method === "POST") {
    const state = readState();
    const body = await readBody(req);
    const currency = body.currency === "USD" ? "USD" : "CNY";
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
      return json(res, 400, { error: "入金金额不正确" });
    }
    state.cash[currency] = Number((state.cash[currency] + amount).toFixed(2));
    state.journal.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      symbol: "CASH",
      title: `${currency === "CNY" ? "人民币" : "美元"}模拟入金`,
      content: `模拟入金 ${currency === "CNY" ? "¥" : "$"}${amount.toFixed(2)}。`
    });
    writeState(state);
    return json(res, 200, state);
  }
  if (url.pathname === "/api/settings" && req.method === "POST") {
    const state = readState();
    const body = await readBody(req);
    for (const key of Object.keys(state.settings)) {
      if (body[key] !== undefined) {
        const value = Number(body[key]);
        if (Number.isFinite(value) && value >= 0) state.settings[key] = value;
      }
    }
    writeState(state);
    return json(res, 200, state);
  }
  if (url.pathname === "/api/rollover" && req.method === "POST") {
    return json(res, 200, resetNextTradingDay(readState()));
  }
  if (url.pathname === "/api/reset" && req.method === "POST") {
    const state = defaultState();
    writeState(state);
    return json(res, 200, state);
  }
  return json(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
  } else {
    serveStatic(req, res, url);
  }
});

function localNetworkUrls() {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${PORT}`);
      }
    }
  }
  return urls;
}

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("模拟炒股训练场已经启动");
  console.log(`电脑打开：http://localhost:${PORT}`);
  const lanUrls = localNetworkUrls();
  if (lanUrls.length) {
    console.log("手机打开下面这个地址，前提是手机和电脑在同一个 Wi-Fi：");
    for (const url of lanUrls) console.log(url);
  }
  console.log("");
  console.log("保持这个窗口打开；关闭窗口后网页服务会停止。");
});
