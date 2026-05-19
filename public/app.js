let state = null;
let stocks = [];
let quotes = [];
let candles = [];
let sources = [];
let currentUser = null;
let authMode = "login";
let selectedChartQuote = null;

const STORE_USERS = "spl_users_v1";
const STORE_SESSION = "spl_session_v1";
const STORE_GUEST = "spl_guest_state_v1";

const $ = (selector) => document.querySelector(selector);
const money = (value, currency = "CNY") => new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency,
  maximumFractionDigits: 2
}).format(Number(value || 0));
const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
const nowText = () => new Date().toLocaleString("zh-CN");

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(STORE_USERS) || "[]");
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(STORE_USERS, JSON.stringify(users));
}

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
    cash: { CNY: 100000, USD: 15000 },
    positions: {},
    orders: [],
    cashflows: [],
    journal: [],
    tasks: { registered: false, watch: false, order: false, journal: false },
    watchlist: ["510300.SH", "159915.SZ", "600519.SH", "AAPL", "MSFT", "NVDA", "SPY"],
    createdAt: new Date().toISOString()
  };
}

function normalizeState(next) {
  const base = defaultState();
  const merged = { ...base, ...(next || {}) };
  merged.accounts = { ...base.accounts, ...(merged.accounts || {}) };
  merged.settings = { ...base.settings, ...(merged.settings || {}) };
  merged.cash = { ...base.cash, ...(merged.cash || {}) };
  merged.positions = merged.positions || {};
  merged.orders = merged.orders || [];
  merged.cashflows = merged.cashflows || [];
  merged.journal = merged.journal || [];
  merged.tasks = { ...base.tasks, ...(merged.tasks || {}) };
  merged.watchlist = merged.watchlist && merged.watchlist.length ? merged.watchlist : base.watchlist;
  return merged;
}

function loadLocalState() {
  const session = localStorage.getItem(STORE_SESSION);
  const users = getUsers();
  const user = users.find((item) => item.username === session);
  currentUser = user || null;
  if (user) {
    state = normalizeState(user.state);
  } else {
    state = normalizeState(JSON.parse(localStorage.getItem(STORE_GUEST) || "null"));
  }
  persistState();
}

function persistState() {
  state = normalizeState(state);
  if (currentUser) {
    const users = getUsers();
    const index = users.findIndex((item) => item.username === currentUser.username);
    if (index >= 0) {
      users[index].state = state;
      users[index].updatedAt = new Date().toISOString();
      saveUsers(users);
      currentUser = users[index];
    }
  } else {
    localStorage.setItem(STORE_GUEST, JSON.stringify(state));
  }
}

function showLogin() {
  $("#loginOverlay").hidden = false;
}

function hideLogin() {
  $("#loginOverlay").hidden = true;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = authMode === "register";
  $("#loginTitle").textContent = registering ? "注册模拟账户" : "登录模拟账户";
  $("#loginHelp").textContent = registering ? "用手机号或邮箱作为用户名，注册即送 A股10万、美股1.5万模拟金。" : "输入手机号/邮箱和密码，加载你的本地模拟账户。";
  $("#authModeBtn").textContent = registering ? "已有账户，去登录" : "注册新账户";
  const agree = $("#agreeWrap");
  if (agree) agree.hidden = !registering;
  $("#loginMessage").textContent = "";
}

function updateAuthUI() {
  $("#logoutBtn").hidden = !currentUser;
  $("#userPill").hidden = false;
  $("#userPill").textContent = currentUser ? currentUser.username : "游客模式";
  $("#drawerUser").textContent = currentUser ? currentUser.username : "游客模式";
}

function registerOrLogin(event) {
  event.preventDefault();
  const username = normalizeLogin($("#usernameInput").value);
  const password = String($("#passwordInput").value || "").trim();
  const users = getUsers();
  if (!username || password.length < 6) {
    $("#loginMessage").textContent = "请输入用户名，并设置至少 6 位密码。";
    return;
  }
  if (authMode === "register") {
    const agreed = $("#agreeInput") ? $("#agreeInput").checked : true;
    if (!agreed) {
      $("#loginMessage").textContent = "注册前请先勾选用户协议和风险提示。";
      return;
    }
    if (users.some((item) => item.username === username)) {
      $("#loginMessage").textContent = "这个账号已经注册，请直接登录。";
      return;
    }
    const user = {
      username,
      password,
      state: normalizeState({ ...defaultState(), tasks: { registered: true, watch: false, order: false, journal: false } }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);
    localStorage.setItem(STORE_SESSION, username);
    currentUser = user;
    state = user.state;
    hideLogin();
    loadAfterAuth();
    return;
  }
  const user = users.find((item) => normalizeLogin(item.username) === username && String(item.password).trim() === password);
  if (!user) {
    $("#loginMessage").textContent = "用户名或密码不正确。";
    return;
  }
  localStorage.setItem(STORE_SESSION, user.username);
  currentUser = user;
  state = normalizeState(user.state);
  hideLogin();
  loadAfterAuth();
}

function guestMode() {
  localStorage.removeItem(STORE_SESSION);
  currentUser = null;
  loadLocalState();
  hideLogin();
  loadAfterAuth();
}

function quoteBySymbol(symbol) {
  return quotes.find((quote) => quote.symbol === symbol);
}

function stockBySymbol(symbol) {
  return stocks.find((stock) => stock.symbol === symbol);
}

function setMarketStatus(status) {
  $("#statusA").textContent = status.A.label;
  $("#statusUS").textContent = status.US.label;
  $("#statusA").classList.toggle("open", status.A.open);
  $("#statusUS").classList.toggle("open", status.US.open);
}

function marketTimeText() {
  return "A股 北京时间 9:30-11:30 / 13:00-15:00；美股夏令 北京时间 21:30-次日04:00，冬令 22:30-次日05:00，美国当地 09:30-16:00。";
}

function marketOpen(market) {
  const now = new Date();
  const zone = market === "A" ? "Asia/Shanghai" : "America/New_York";
  const local = new Date(now.toLocaleString("en-US", { timeZone: zone }));
  const day = local.getDay();
  const minutes = local.getHours() * 60 + local.getMinutes();
  if (day === 0 || day === 6) return false;
  if (market === "A") return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
  return minutes >= 570 && minutes <= 960;
}

function renderSummary() {
  let aValue = 0;
  let usValue = 0;
  let aPnl = 0;
  let usPnl = 0;
  for (const position of Object.values(state.positions)) {
    const quote = quoteBySymbol(position.symbol);
    const price = quote ? quote.price : position.avgCost;
    const value = price * position.quantity;
    const pnl = value - position.avgCost * position.quantity;
    if (position.currency === "CNY") {
      aValue += value;
      aPnl += pnl;
    } else {
      usValue += value;
      usPnl += pnl;
    }
  }
  const usdToCny = state.settings.usdToCny;
  const total = state.cash.CNY + aValue + (state.cash.USD + usValue) * usdToCny;
  $("#totalAsset").textContent = money(total, "CNY");
  $("#cashCny").textContent = money(state.cash.CNY, "CNY");
  $("#cashUsd").textContent = money(state.cash.USD, "USD");
  $("#totalPnl").textContent = money(aPnl + usPnl * usdToCny, "CNY");
  $("#totalPnl").className = aPnl + usPnl * usdToCny >= 0 ? "gain" : "loss";
}

function renderQuotes(sortMode = $("#quoteSort") ? $("#quoteSort").value : "default") {
  const sorted = [...quotes];
  if (sortMode === "gain") sorted.sort((a, b) => b.changePct - a.changePct);
  if (sortMode === "loss") sorted.sort((a, b) => a.changePct - b.changePct);
  $("#dataSource").textContent = `数据源：${[...new Set(quotes.map((quote) => quote.source))].join(" / ") || "读取中"}。${marketTimeText()}`;
  $("#quoteList").innerHTML = sorted.length ? sorted.map((quote) => {
    const tone = quote.change >= 0 ? "gain" : "loss";
    return `
      <article class="quote-row">
        <div>
          <div class="name">${quote.name}</div>
          <div class="sub">${quote.symbol} · ${quote.market === "A" ? "A股" : "美股"} · ${quote.source}</div>
        </div>
        <div><div class="sub">现价</div><div class="price">${money(quote.price, quote.currency)}</div></div>
        <div><div class="sub">涨跌</div><div class="${tone}">${quote.change >= 0 ? "+" : ""}${Number(quote.change || 0).toFixed(2)}</div></div>
        <div><div class="sub">涨跌幅</div><div class="${tone}">${quote.changePct >= 0 ? "+" : ""}${pct(quote.changePct)}</div></div>
        <div><div class="sub">今开/高/低</div><div>${Number(quote.open || 0).toFixed(2)} / ${Number(quote.high || 0).toFixed(2)} / ${Number(quote.low || 0).toFixed(2)}</div></div>
        <div><div class="sub">成交量</div><div>${Number(quote.volume || 0).toLocaleString("zh-CN")}</div></div>
        <div class="row-actions">
          <button class="secondary" data-chart="${quote.symbol}">图表</button>
          <button class="secondary" data-trade="${quote.symbol}">交易</button>
          <button class="secondary danger" data-remove-watch="${quote.symbol}">移除</button>
        </div>
      </article>
    `;
  }).join("") : `<p class="empty">暂无自选。搜索股票后加入自选开始观察。</p>`;

  document.querySelectorAll("[data-chart]").forEach((button) => button.addEventListener("click", async () => {
    $("#chartSymbol").value = button.dataset.chart;
    activateTab("chart");
    await loadChart();
  }));
  document.querySelectorAll("[data-trade]").forEach((button) => button.addEventListener("click", () => {
    $("#symbolInput").value = button.dataset.trade;
    activateTab("trade");
    updateOrderPreview();
  }));
  document.querySelectorAll("[data-remove-watch]").forEach((button) => button.addEventListener("click", async () => {
    state.watchlist = state.watchlist.filter((symbol) => symbol !== button.dataset.removeWatch);
    persistState();
    await refreshQuotes();
  }));
}

function renderStockOptions() {
  const optionHtml = stocks.map((stock) => `<option value="${stock.symbol}">${stock.name} · ${stock.symbol}</option>`).join("");
  $("#symbolInput").innerHTML = optionHtml;
  $("#chartSymbol").innerHTML = optionHtml;
  $("#watchSymbol").innerHTML = optionHtml;
}

function renderAccount() {
  $("#accountAStatus").textContent = "已开通";
  $("#accountUSStatus").textContent = "已开通";
  for (const [key, value] of Object.entries(state.settings)) {
    const input = $(`#${key}`);
    if (input) input.value = value;
  }
}

function renderSources() {
  $("#sourceList").innerHTML = sources.map((source) => `
    <article class="source-card"><div class="name">${source.name}</div><div class="sub">${source.markets.join(" / ")}</div><p>${source.usage}</p></article>
  `).join("");
  $("#sourceHitList").innerHTML = quotes.length ? quotes.map((quote) => `
    <article class="position-row">
      <div><div class="name">${quote.name}</div><div class="sub">${quote.symbol}</div></div>
      <div><div class="sub">市场</div><div>${quote.market === "A" ? "A股" : "美股"}</div></div>
      <div><div class="sub">当前来源</div><div>${quote.source}</div></div>
      <div><div class="sub">更新时间</div><div>${new Date(quote.time).toLocaleTimeString("zh-CN")}</div></div>
      <div><div class="sub">现价</div><div>${money(quote.price, quote.currency)}</div></div>
      <div><div class="sub">涨跌幅</div><div class="${quote.changePct >= 0 ? "gain" : "loss"}">${quote.changePct >= 0 ? "+" : ""}${pct(quote.changePct)}</div></div>
    </article>
  `).join("") : `<p class="empty">行情读取后会显示每只股票实际命中的来源。</p>`;
}

function renderPositions() {
  const positions = Object.values(state.positions);
  $("#positionList").innerHTML = positions.length ? positions.map((position) => {
    const quote = quoteBySymbol(position.symbol);
    const price = quote ? quote.price : position.avgCost;
    const value = price * position.quantity;
    const pnl = value - position.avgCost * position.quantity;
    return `
      <article class="position-row">
        <div><div class="name">${position.name}</div><div class="sub">${position.symbol} · ${position.market === "A" ? "A股" : "美股"} · 可卖 ${position.sellable}</div></div>
        <div><div class="sub">数量</div><div>${position.quantity}</div></div>
        <div><div class="sub">成本</div><div>${money(position.avgCost, position.currency)}</div></div>
        <div><div class="sub">现价</div><div>${money(price, position.currency)}</div></div>
        <div><div class="sub">市值</div><div>${money(value, position.currency)}</div></div>
        <div><div class="sub">盈亏</div><div class="${pnl >= 0 ? "gain" : "loss"}">${money(pnl, position.currency)}</div></div>
        <div class="row-actions"><button class="secondary" data-chart="${position.symbol}">图表</button><button class="secondary" data-sell="${position.symbol}">卖出</button></div>
      </article>
    `;
  }).join("") : `<p class="empty">还没有持仓。可以先从 ETF 开始做小仓位练习。</p>`;
  document.querySelectorAll("[data-sell]").forEach((button) => button.addEventListener("click", () => {
    $("#symbolInput").value = button.dataset.sell;
    $("#sideInput").value = "sell";
    activateTab("trade");
    updateOrderPreview();
  }));
  document.querySelectorAll("[data-chart]").forEach((button) => button.addEventListener("click", async () => {
    $("#chartSymbol").value = button.dataset.chart;
    activateTab("chart");
    await loadChart();
  }));
  renderOrders();
  renderCashflows();
}

function renderOrders() {
  const orderSelect = $("#journalOrder");
  if (orderSelect) {
    orderSelect.innerHTML = `<option value="">不关联订单</option>` + state.orders.slice(0, 20).map((order) => `<option value="${order.id}">${order.name} · ${order.side === "buy" ? "买入" : "卖出"} · ${order.statusLabel || order.status}</option>`).join("");
  }
  $("#orderList").innerHTML = state.orders.length ? state.orders.map((order) => `
    <article class="history-item">
      <div><div class="name">${order.side === "buy" ? "买入" : "卖出"} ${order.name}</div><div class="sub">${new Date(order.createdAt).toLocaleString("zh-CN")}</div></div>
      <div>${order.quantity} 股 · ${money(order.price, order.currency)} · ${order.statusLabel || order.status || "已成交"} · 费用 ${money(order.fee, order.currency)}</div>
      <div class="sub">${order.status === "pending" ? `<button class="secondary danger" data-cancel-order="${order.id}">撤单</button>` : order.reason}</div>
    </article>
  `).join("") : `<p class="empty">暂无订单。</p>`;
  document.querySelectorAll("[data-cancel-order]").forEach((button) => button.addEventListener("click", () => {
    const order = state.orders.find((item) => item.id === button.dataset.cancelOrder);
    if (order) {
      order.status = "cancelled";
      order.statusLabel = "已撤单";
      order.cancelledAt = new Date().toISOString();
      persistState();
      renderAll();
    }
  }));
}

function renderCashflows(filter = "all") {
  const flows = (state.cashflows || []).filter((flow) => filter === "all" || flow.type === filter);
  $("#cashflowList").innerHTML = flows.length ? flows.map((flow) => `
    <article class="history-item">
      <div><div class="name">${flow.type === "deposit" ? "入金" : flow.type === "fee" ? "费用" : flow.type === "buy" ? "买入支出" : "卖出收入"}</div><div class="sub">${new Date(flow.createdAt).toLocaleString("zh-CN")}</div></div>
      <div class="${flow.amount >= 0 ? "gain" : "loss"}">${money(flow.amount, flow.currency)}</div>
      <div class="sub">${flow.memo}</div>
    </article>
  `).join("") : `<p class="empty">暂无资金流水。</p>`;
}

function renderJournal() {
  const tag = $("#journalFilter") ? $("#journalFilter").value : "all";
  const items = state.journal.filter((item) => tag === "all" || item.tag === tag);
  $("#journalList").innerHTML = items.length ? items.map((item) => `
    <article class="history-item">
      <div><div class="name">${item.title}</div><div class="sub">${item.symbol || "NOTE"} · ${item.tag || "未标记"} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</div></div>
      <div>${item.content}</div>
      <div class="sub"><button class="secondary danger" data-delete-journal="${item.id}">删除</button></div>
    </article>
  `).join("") : `<p class="empty">还没有复盘。第一条可以写“我为什么想买这只股票”。</p>`;
  document.querySelectorAll("[data-delete-journal]").forEach((button) => button.addEventListener("click", () => {
    state.journal = state.journal.filter((item) => item.id !== button.dataset.deleteJournal);
    persistState();
    renderJournal();
  }));
}

function renderTasks() {
  const tasks = [
    ["registered", "完成注册", currentUser ? "已完成" : "游客中"],
    ["watch", "添加自选", state.tasks.watch ? "已完成" : "待完成"],
    ["order", "完成下单", state.tasks.order ? "已完成" : "待完成"],
    ["journal", "写一篇复盘", state.tasks.journal ? "已完成" : "待完成"]
  ];
  const target = $("#taskList");
  if (!target) return;
  target.innerHTML = tasks.map(([key, label, status]) => `<article class="source-card"><div class="name">${label}</div><p>${status}</p></article>`).join("");
}

function renderAll() {
  updateAuthUI();
  renderSummary();
  renderQuotes();
  renderPositions();
  renderAccount();
  renderSources();
  renderJournal();
  renderTasks();
  updateOrderPreview();
}

async function loadAll() {
  loadLocalState();
  const [stockPayload, sourcePayload] = await Promise.all([api("/api/stocks"), api("/api/sources")]);
  stocks = stockPayload.stocks;
  sources = sourcePayload.sources;
  renderStockOptions();
  await refreshQuotes();
  await loadChart();
}

async function loadAfterAuth() {
  renderStockOptions();
  await refreshQuotes();
  await loadChart();
  renderAll();
}

async function refreshQuotes() {
  if (!state.watchlist.length) {
    quotes = [];
    renderAll();
    return;
  }
  const payload = await api(`/api/quotes?symbols=${encodeURIComponent(state.watchlist.join(","))}`);
  quotes = payload.quotes;
  setMarketStatus(payload.status);
  renderAll();
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === tabName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadChart() {
  if (!$("#chartSymbol").value && stocks[0]) $("#chartSymbol").value = stocks[0].symbol;
  const symbol = $("#chartSymbol").value || "510300.SH";
  const range = $("#chartRange").value || "1mo";
  const payload = await api(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
  candles = payload.candles;
  selectedChartQuote = quoteBySymbol(symbol);
  $("#chartTitle").textContent = `${payload.stock.name} · ${payload.stock.symbol}`;
  $("#chartMeta").textContent = `数据源：${payload.source}。红涨绿跌，适合观察趋势和波动，不作为投资建议。`;
  renderChartStats(payload.stock);
  drawKline();
}

function renderChartStats(stock) {
  const quote = selectedChartQuote || quoteBySymbol(stock.symbol);
  const position = state.positions[stock.symbol];
  const target = $("#chartStats");
  if (!target || !quote) return;
  target.innerHTML = `
    <article><span>现价</span><strong>${money(quote.price, quote.currency)}</strong></article>
    <article><span>涨跌</span><strong class="${quote.change >= 0 ? "gain" : "loss"}">${quote.change >= 0 ? "+" : ""}${Number(quote.change || 0).toFixed(2)}</strong></article>
    <article><span>涨跌幅</span><strong class="${quote.changePct >= 0 ? "gain" : "loss"}">${quote.changePct >= 0 ? "+" : ""}${pct(quote.changePct)}</strong></article>
    <article><span>估值参考</span><strong>${quote.market === "A" ? "观察行业/指数对比" : "观察PE/成长性"}</strong></article>
    <article><span>持仓成本</span><strong>${position ? money(position.avgCost, position.currency) : "--"}</strong></article>
    <article><span>日内高低</span><strong>${Number(quote.high || 0).toFixed(2)} / ${Number(quote.low || 0).toFixed(2)}</strong></article>
  `;
}

function drawKline() {
  const canvas = $("#klineCanvas");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(420 * ratio);
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffefa";
  ctx.fillRect(0, 0, width, height);
  if (!candles.length) return;
  const pad = { left: 54, right: 18, top: 22, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...candles.map((item) => item.high));
  const min = Math.min(...candles.map((item) => item.low));
  const span = max - min || 1;
  const y = (price) => pad.top + (max - price) / span * plotH;
  const candleW = Math.max(4, Math.min(16, plotW / candles.length * 0.62));
  ctx.strokeStyle = "#ece4d5";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#68736f";
  ctx.font = "12px system-ui, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const yy = pad.top + plotH * i / 4;
    const price = max - span * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    ctx.fillText(price.toFixed(price < 10 ? 3 : 2), 8, yy + 4);
  }
  candles.forEach((item, index) => {
    const x = pad.left + plotW * (index + 0.5) / candles.length;
    const up = item.close >= item.open;
    ctx.strokeStyle = up ? "#c62828" : "#168457";
    ctx.fillStyle = up ? "#c62828" : "#168457";
    ctx.beginPath();
    ctx.moveTo(x, y(item.high));
    ctx.lineTo(x, y(item.low));
    ctx.stroke();
    ctx.fillRect(x - candleW / 2, Math.min(y(item.open), y(item.close)), candleW, Math.max(2, Math.abs(y(item.open) - y(item.close))));
  });
}

function orderFee(stock, side, amount) {
  if (stock.market === "A") {
    return Math.max(state.settings.aMinCommission, amount * state.settings.aCommissionRate) + (side === "sell" ? amount * state.settings.aStampDutyRate : 0) + amount * state.settings.aTransferRate;
  }
  return Math.max(state.settings.usMinCommission, amount * state.settings.usCommissionRate);
}

function updateOrderPreview() {
  const target = $("#orderPreview");
  if (!target || !stocks.length) return;
  const stock = stockBySymbol($("#symbolInput").value);
  const quote = quoteBySymbol(stock && stock.symbol);
  if (!stock || !quote) {
    target.textContent = "等待行情加载后显示费用预估。";
    return;
  }
  const side = $("#sideInput").value;
  const quantity = Number($("#quantityInput").value || 0);
  const limit = Number($("#limitInput").value || quote.price);
  const amount = limit * quantity;
  const fee = orderFee(stock, side, amount);
  const open = marketOpen(stock.market);
  target.textContent = `${stock.market === "A" ? "A股100股/手、T+1、±10%涨跌停" : "美股1股起、无T+1/涨跌停"}；${open ? "当前模拟为交易时段" : "当前非交易时段，下单将挂为委托"}；预计费用 ${money(fee, stock.currency)}。`;
}

function placeOrder(event) {
  event.preventDefault();
  if (!currentUser) {
    showLogin();
    $("#loginMessage").textContent = "下单需要先注册或登录；游客可以查看行情和试填订单。";
    return;
  }
  const stock = stockBySymbol($("#symbolInput").value);
  const quote = quoteBySymbol(stock.symbol);
  const side = $("#sideInput").value;
  const orderType = $("#typeInput").value;
  const quantity = Number($("#quantityInput").value);
  const reason = $("#reasonInput").value.trim();
  const price = Number(orderType === "limit" && $("#limitInput").value ? $("#limitInput").value : quote.price);
  if (!reason) return showMessage("#orderMessage", "请先写下单理由。");
  if (!quantity || quantity <= 0 || quantity % stock.lotSize !== 0) return showMessage("#orderMessage", `${stock.market === "A" ? "A股" : "美股"}需要按 ${stock.lotSize} 股单位交易。`);
  if (stock.market === "A" && (price > quote.previousClose * 1.1 || price < quote.previousClose * 0.9)) return showMessage("#orderMessage", "价格超过 A 股 ±10% 涨跌停模拟范围。");
  const amount = price * quantity;
  const fee = orderFee(stock, side, amount);
  const now = new Date().toISOString();
  const isOpen = marketOpen(stock.market);
  const pendingLimit = orderType === "limit" && ((side === "buy" && price < quote.price) || (side === "sell" && price > quote.price));
  const pending = !isOpen || pendingLimit;
  const position = state.positions[stock.symbol];
  if (side === "buy" && !pending && state.cash[stock.currency] < amount + fee) return showMessage("#orderMessage", "现金不足。");
  if (side === "sell") {
    if (!position || position.quantity < quantity) return showMessage("#orderMessage", "持仓不足。");
    if (stock.market === "A" && quantity > position.sellable) return showMessage("#orderMessage", "A股 T+1：今天买入的股票下个交易日才可卖。");
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
    fee: pending ? 0 : Number(fee.toFixed(2)),
    amount: Number(amount.toFixed(2)),
    reason,
    orderType,
    status: pending ? "pending" : "filled",
    statusLabel: pending ? "已委托" : "已成交",
    createdAt: now
  };
  state.orders.unshift(order);
  if (!pending) {
    if (side === "buy") {
      state.cash[stock.currency] = Number((state.cash[stock.currency] - amount - fee).toFixed(2));
      const current = position || { symbol: stock.symbol, name: stock.name, market: stock.market, currency: stock.currency, quantity: 0, avgCost: 0, sellable: 0 };
      const newQty = current.quantity + quantity;
      current.avgCost = Number(((current.avgCost * current.quantity + amount + fee) / newQty).toFixed(4));
      current.quantity = newQty;
      current.sellable += stock.market === "A" ? 0 : quantity;
      state.positions[stock.symbol] = current;
    } else {
      position.quantity -= quantity;
      position.sellable = Math.max(0, position.sellable - quantity);
      state.cash[stock.currency] = Number((state.cash[stock.currency] + amount - fee).toFixed(2));
      if (position.quantity === 0) delete state.positions[stock.symbol];
    }
    state.cashflows.unshift({ id: crypto.randomUUID(), createdAt: now, currency: stock.currency, type: side, amount: Number((side === "buy" ? -(amount + fee) : amount - fee).toFixed(2)), memo: `${side === "buy" ? "买入" : "卖出"} ${stock.name}，费用 ${fee.toFixed(2)}` });
  }
  state.tasks.order = true;
  persistState();
  $("#reasonInput").value = "";
  showMessage("#orderMessage", pending ? "已提交委托，可在持仓页撤单。" : "订单已成交。");
  renderAll();
  activateTab("positions");
}

function showMessage(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

function saveJournal(event) {
  event.preventDefault();
  const title = $("#journalTitle").value.trim();
  const content = $("#journalContent").value.trim();
  if (!title || !content) return;
  state.journal.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), title, content, tag: $("#journalTag").value, orderId: $("#journalOrder").value || "", symbol: $("#journalOrder").value || "NOTE" });
  state.tasks.journal = true;
  persistState();
  $("#journalTitle").value = "";
  $("#journalContent").value = "";
  renderAll();
}

function deposit(event) {
  event.preventDefault();
  const currency = $("#depositCurrency").value;
  const amount = Number($("#depositAmount").value);
  const step = currency === "CNY" ? 100 : 10;
  if (!amount || amount < step || amount % step !== 0) return showMessage("#accountMessage", `入金最小 ${step}，并按 ${step} 递增。`);
  state.cash[currency] = Number((state.cash[currency] + amount).toFixed(2));
  state.cashflows.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), currency, type: "deposit", amount, memo: `${currency === "CNY" ? "人民币" : "美元"}模拟入金` });
  persistState();
  showMessage("#accountMessage", "模拟入金成功。");
  renderAll();
}

function resetAccount() {
  if (!confirm("确定重置账户吗？这会清空持仓、订单、复盘和资金流水。")) return;
  state = defaultState();
  persistState();
  renderAll();
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
document.querySelectorAll("[data-mobile-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.mobileTab)));
document.querySelectorAll("[data-drawer-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.drawerTab)));
$("#drawerLogout").addEventListener("click", () => {
  localStorage.removeItem(STORE_SESSION);
  guestMode();
});
$("#loginForm").addEventListener("submit", registerOrLogin);
$("#authModeBtn").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("#guestBtn").addEventListener("click", guestMode);
$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(STORE_SESSION);
  guestMode();
});
$("#refreshBtn").addEventListener("click", refreshQuotes);
$("#quoteSort").addEventListener("change", () => renderQuotes($("#quoteSort").value));
$("#addWatchBtn").addEventListener("click", async () => {
  const symbol = $("#watchSymbol").value;
  if (!state.watchlist.includes(symbol)) state.watchlist.push(symbol);
  state.tasks.watch = true;
  persistState();
  await refreshQuotes();
});
$("#stockSearch").addEventListener("input", () => {
  const keyword = $("#stockSearch").value.trim().toLowerCase();
  const filtered = stocks.filter((stock) => `${stock.name}${stock.symbol}`.toLowerCase().includes(keyword));
  $("#watchSymbol").innerHTML = filtered.map((stock) => `<option value="${stock.symbol}">${stock.name} · ${stock.symbol}</option>`).join("");
});
$("#chartSymbol").addEventListener("change", loadChart);
$("#chartRange").addEventListener("change", loadChart);
$("#orderForm").addEventListener("submit", placeOrder);
["symbolInput", "sideInput", "typeInput", "limitInput", "quantityInput"].forEach((id) => $(`#${id}`).addEventListener("input", updateOrderPreview));
$("#depositForm").addEventListener("submit", deposit);
$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  for (const key of Object.keys(state.settings)) state.settings[key] = Number($(`#${key}`).value);
  persistState();
  showMessage("#accountMessage", "费用参数已保存。");
});
$("#resetBtn").addEventListener("click", resetAccount);
$("#rolloverBtn").addEventListener("click", () => {
  Object.values(state.positions).forEach((position) => {
    position.sellable = position.quantity;
  });
  persistState();
  renderAll();
});
$("#journalForm").addEventListener("submit", saveJournal);
$("#journalFilter").addEventListener("change", renderJournal);
$("#cashflowFilter").addEventListener("change", () => renderCashflows($("#cashflowFilter").value));
window.addEventListener("resize", () => {
  if (candles.length) drawKline();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

setAuthMode("login");
loadAll().catch((error) => {
  document.body.innerHTML = `<main class="shell"><p class="empty">启动失败：${error.message}</p></main>`;
});
setInterval(() => {
  if (state) refreshQuotes().catch(() => {});
}, 30000);
