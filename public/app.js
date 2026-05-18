let state = null;
let stocks = [];
let quotes = [];

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
  const usdToCny = 7.2;
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
        <button class="secondary" data-trade="${quote.symbol}">交易</button>
      </article>
    `;
  }).join("");
  document.querySelectorAll("[data-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#symbolInput").value = button.dataset.trade;
      activateTab("trade");
    });
  });
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
  $("#symbolInput").innerHTML = stocks.map((stock) => `<option value="${stock.symbol}">${stock.name} · ${stock.symbol}</option>`).join("");
  state = await api("/api/state");
  await refreshQuotes();
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
