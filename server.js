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

function defaultState() {
  return {
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
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
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

async function getQuotes(symbols) {
  return Promise.all(symbols.map(async (symbol) => {
    const stock = stockMap.get(symbol);
    if (!stock) return null;
    try {
      return await fetchYahoo(stock);
    } catch {
      return fallbackQuote(stock);
    }
  })).then((quotes) => quotes.filter(Boolean));
}

function feeForOrder(stock, side, amount) {
  if (stock.market === "A") {
    const commission = Math.max(5, amount * 0.00025);
    const stamp = side === "sell" ? amount * 0.0005 : 0;
    const transfer = amount * 0.00001;
    return Number((commission + stamp + transfer).toFixed(2));
  }
  return Number(Math.max(0.01, amount * 0.0005).toFixed(2));
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
  const fee = feeForOrder(stock, side, amount);
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
  if (url.pathname === "/api/stocks") return json(res, 200, { stocks: STOCKS });
  if (url.pathname === "/api/state") return json(res, 200, readState());
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
