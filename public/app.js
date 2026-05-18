let state = null;
let stocks = [];
let quotes = [];
let candles = [];
let chartSource = "";
let sources = [];

const $ = (selector) => document.querySelector(selector);
const money = (value, currency = "CNY") => new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency,
  maximumFractionDigits: currency === "CNY" ? 2 : 2
}).format(Number(value || 0));

const pct = (value) => `${Number(value || 0).toFixed(2)}%`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (response.status === 401) {
    showLogin();
  }
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function showLogin() {
  $("#loginOverlay").hidden = false;
}

function hideLogin() {
  $("#loginOverlay").hidden = true;
}

function quoteBySymbol(symbol) {
  return quotes.find((quote) => quote.symbol === symbol);
}

function setMarketStatus(status) {
  const a = $("#statusA");
  const us = $("#statusUS");
  a.textContent = status.A.label;
  us.textContent = status.US.label;
  a.classList.toggle("open", status.A.open);
  us.classList.toggle("open", status.US.open);
}

function renderSummary() {
  let cnyPositions = 0;
  let usdPositions = 0;
  let pnl = 0;
  for (const position of Object.values(state.positions)) {
    const quote = quoteBySymbol(position.symbol);
    const price = quote ? quote.price : position.avgCost;
    const value = price * position.quantity;
    const cost = position.avgCost * position.quantity;
    pnl += value - cost;
    if (position.currency === "CNY") cnyPositions += value;
    else usdPositions += value;
  }
  const usdToCny = state.settings.usdToCny;
  const total = state.cash.CNY + cnyPositions + (state.cash.USD + usdPositions) * usdToCny;
  $("#totalAsset").textContent = money(total, "CNY");
  $("#cashCny").textContent = money(state.cash.CNY, "CNY");
  $("#cashUsd").textContent = money(state.cash.USD, "USD");
  $("#totalPnl").textContent = money(pnl, "CNY");
  $("#totalPnl").className = pnl >= 0 ? "gain" : "loss";
}

function renderQuotes() {
  const sourceSet = new Set(quotes.map((quote) => quote.source));
  $("#dataSource").textContent = `数据源：${[...sourceSet].join(" / ") || "读取中"}，每 30 秒自动刷新。`;
  $("#quoteList").innerHTML = quotes.map((quote) => {
    const tone = quote.change >= 0 ? "gain" : "loss";
    return `
      <article class="quote-row">
        <div>
          <div class="name">${quote.name}</div>
          <div class="sub">${quote.symbol} · ${quote.market === "A" ? "A股" : "美股"} · ${quote.source}</div>
        </div>
        <div>
          <div class="sub">现价</div>
          <div class="price">${money(quote.price, quote.currency)}</div>
        </div>
        <div>
          <div class="sub">涨跌</div>
          <div class="${tone}">${quote.change >= 0 ? "+" : ""}${quote.change}</div>
        </div>
        <div>
          <div class="sub">涨跌幅</div>
          <div class="${tone}">${quote.changePct >= 0 ? "+" : ""}${pct(quote.changePct)}</div>
        </div>
        <div>
          <div class="sub">规则</div>
          <div>${quote.lotSize} 股/手</div>
        </div>
        <div class="row-actions">
          <button class="secondary" data-chart="${quote.symbol}">图表</button>
          <button class="secondary" data-trade="${quote.symbol}">交易</button>
        </div>
      </article>
    `;
  }).join("");
  document.querySelectorAll("[data-chart]").forEach((button) => {
    button.addEventListener("click", async () => {
      $("#chartSymbol").value = button.dataset.chart;
      activateTab("chart");
      await loadChart();
    });
  });
  document.querySelectorAll("[data-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#symbolInput").value = button.dataset.trade;
      activateTab("trade");
    });
  });
}

function renderAccount() {
  $("#accountAStatus").textContent = state.accounts.A.opened ? "已开通" : "未开通";
  $("#accountUSStatus").textContent = state.accounts.US.opened ? "已开通" : "未开通";
  for (const [key, value] of Object.entries(state.settings)) {
    const input = $(`#${key}`);
    if (input) input.value = value;
  }
}

function renderSources() {
  $("#sourceList").innerHTML = sources.map((source) => `
    <article class="source-card">
      <div class="name">${source.name}</div>
      <div class="sub">${source.markets.join(" / ")}</div>
      <p>${source.usage}</p>
    </article>
  `).join("");
  $("#sourceHitList").innerHTML = quotes.length ? quotes.map((quote) => `
    <article class="position-row">
      <div>
        <div class="name">${quote.name}</div>
        <div class="sub">${quote.symbol}</div>
      </div>
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
        <div>
          <div class="name">${position.name}</div>
          <div class="sub">${position.symbol} · 可卖 ${position.sellable}</div>
        </div>
        <div><div class="sub">数量</div><div>${position.quantity}</div></div>
        <div><div class="sub">成本</div><div>${money(position.avgCost, position.currency)}</div></div>
        <div><div class="sub">现价</div><div>${money(price, position.currency)}</div></div>
        <div><div class="sub">市值</div><div>${money(value, position.currency)}</div></div>
        <div><div class="sub">盈亏</div><div class="${pnl >= 0 ? "gain" : "loss"}">${money(pnl, position.currency)}</div></div>
      </article>
    `;
  }).join("") : `<p class="empty">还没有持仓。可以先从 ETF 开始做小仓位练习。</p>`;

  $("#orderList").innerHTML = state.orders.length ? state.orders.slice(0, 12).map((order) => `
    <article class="history-item">
      <div>
        <div class="name">${order.side === "buy" ? "买入" : "卖出"} ${order.name}</div>
        <div class="sub">${new Date(order.createdAt).toLocaleString("zh-CN")}</div>
      </div>
      <div>${order.quantity} 股 · ${money(order.price, order.currency)} · 费用 ${money(order.fee, order.currency)}</div>
      <div class="sub">${order.reason}</div>
    </article>
  `).join("") : `<p class="empty">暂无订单。</p>`;
}

function renderJournal() {
  $("#journalList").innerHTML = state.journal.length ? state.journal.map((item) => `
    <article class="history-item">
      <div>
        <div class="name">${item.title}</div>
        <div class="sub">${item.symbol} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</div>
      </div>
      <div>${item.content}</div>
      <div class="sub">${journalHint(item.content)}</div>
    </article>
  `).join("") : `<p class="empty">还没有复盘。第一条可以写“我为什么想买这只股票”。</p>`;
}

function journalHint(content) {
  const text = content.toLowerCase();
  if (text.includes("追") || text.includes("涨")) return "提醒：追涨练习要提前写好退出条件。";
  if (text.includes("亏") || text.includes("跌")) return "提醒：先区分计划内回撤和失控亏损。";
  if (text.includes("etf")) return "不错：ETF 适合新手练仓位和波动感。";
  return "复盘重点：理由、仓位、退出条件、结果。";
}

function renderAll() {
  renderSummary();
  renderQuotes();
  renderPositions();
  renderAccount();
  renderSources();
  renderJournal();
}

async function loadAll() {
  const auth = await api("/api/auth/status");
  $("#logoutBtn").hidden = !auth.required;
  if (auth.required && !auth.authed) {
    showLogin();
    return;
  }
  hideLogin();
  const stockPayload = await api("/api/stocks");
  stocks = stockPayload.stocks;
  sources = (await api("/api/sources")).sources;
  $("#symbolInput").innerHTML = stocks.map((stock) => `<option value="${stock.symbol}">${stock.name} · ${stock.symbol}</option>`).join("");
  $("#chartSymbol").innerHTML = stocks.map((stock) => `<option value="${stock.symbol}">${stock.name} · ${stock.symbol}</option>`).join("");
  state = await api("/api/state");
  await refreshQuotes();
  await loadChart();
}

async function refreshQuotes() {
  const payload = await api(`/api/quotes?symbols=${encodeURIComponent(state.watchlist.join(","))}`);
  quotes = payload.quotes;
  setMarketStatus(payload.status);
  renderAll();
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === tabName));
}

async function loadChart() {
  if (!$("#chartSymbol").value && stocks[0]) $("#chartSymbol").value = stocks[0].symbol;
  const symbol = $("#chartSymbol").value || "510300.SH";
  const range = $("#chartRange").value || "1mo";
  const payload = await api(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
  candles = payload.candles;
  chartSource = payload.source;
  $("#chartTitle").textContent = `${payload.stock.name} · ${payload.stock.symbol}`;
  $("#chartMeta").textContent = `数据源：${chartSource}。红涨绿跌，适合观察趋势和波动，不作为投资建议。`;
  drawKline();
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
  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
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
    const top = Math.min(y(item.open), y(item.close));
    const bottom = Math.max(y(item.open), y(item.close));
    ctx.fillRect(x - candleW / 2, top, candleW, Math.max(2, bottom - top));
  });

  const first = candles[0];
  const last = candles[candles.length - 1];
  const change = ((last.close - first.close) / first.close) * 100;
  ctx.fillStyle = change >= 0 ? "#c62828" : "#168457";
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.fillText(`区间涨跌：${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, pad.left, height - 14);
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

$("#refreshBtn").addEventListener("click", refreshQuotes);

$("#orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#orderMessage").textContent = "正在提交模拟订单...";
  try {
    const payload = await api("/api/order", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("#symbolInput").value,
        side: $("#sideInput").value,
        orderType: $("#typeInput").value,
        limitPrice: $("#limitInput").value,
        quantity: Number($("#quantityInput").value),
        reason: $("#reasonInput").value
      })
    });
    state = payload.state;
    $("#reasonInput").value = "";
    $("#orderMessage").textContent = "订单已成交并写入复盘。";
    await refreshQuotes();
    activateTab("positions");
  } catch (error) {
    $("#orderMessage").textContent = error.message;
  }
});

$("#journalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state = await api("/api/journal", {
    method: "POST",
    body: JSON.stringify({
      title: $("#journalTitle").value,
      content: $("#journalContent").value
    })
  });
  $("#journalTitle").value = "";
  $("#journalContent").value = "";
  renderAll();
});

$("#rolloverBtn").addEventListener("click", async () => {
  state = await api("/api/rollover", { method: "POST", body: "{}" });
  renderAll();
});

$("#resetBtn").addEventListener("click", async () => {
  if (!confirm("确定要重置账户、订单和复盘吗？")) return;
  state = await api("/api/reset", { method: "POST", body: "{}" });
  await refreshQuotes();
});

$("#chartSymbol").addEventListener("change", loadChart);
$("#chartRange").addEventListener("change", loadChart);
window.addEventListener("resize", () => {
  if (candles.length) drawKline();
});

$("#depositForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state = await api("/api/deposit", {
      method: "POST",
      body: JSON.stringify({
        currency: $("#depositCurrency").value,
        amount: Number($("#depositAmount").value)
      })
    });
    $("#accountMessage").textContent = "模拟入金成功。";
    renderAll();
  } catch (error) {
    $("#accountMessage").textContent = error.message;
  }
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {};
  for (const key of Object.keys(state.settings)) body[key] = Number($(`#${key}`).value);
  try {
    state = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(body)
    });
    $("#accountMessage").textContent = "费用参数已保存。";
    renderAll();
  } catch (error) {
    $("#accountMessage").textContent = error.message;
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginMessage").textContent = "正在登录...";
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#passwordInput").value })
    });
    $("#passwordInput").value = "";
    $("#loginMessage").textContent = "";
    await loadAll();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  state = null;
  showLogin();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

loadAll().catch((error) => {
  document.body.innerHTML = `<main class="shell"><p class="empty">启动失败：${error.message}</p></main>`;
});

setInterval(() => {
  if (state) refreshQuotes().catch(() => {});
}, 30000);
