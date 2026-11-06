// Hyperliquid-style Perps Simulator
const state = {
  balance: 0,           // available USDC
  positions: [],        // {id, side, size, entry, margin, leverage, liq}
  price: 67500,
  leverage: 10,
  isolated: true,
  side: 'long',
  size: 0,
  chart: null,
  candleSeries: null,
  priceLine: null,
  guideStep: 0
};

const markets = {
  'BTC-USDC': { price: 92900, precision: 1, binance: 'BTCUSDT' },
  'ETH-USDC': { price: 3080, precision: 2, binance: 'ETHUSDT' },
  'XRP-USDC': { price: 2.17, precision: 4, binance: 'XRPUSDT' },
  'HYPE-USDC': { price: 78, precision: 2, binance: 'HYPEUSDT' },
  'ZEC-USDC': { price: 48, precision: 2, binance: 'ZECUSDT' },
  'SOL-USDC': { price: 141, precision: 2, binance: 'SOLUSDT' }
};
let currentMarket = 'BTC-USDC';
let limitOrders = []; // {id, market, side, price, size}
let orderType = 'market';
let candleInterval = 60; // seconds per candle (15m=900, 1h=3600, 4h=14400 for display spacing)

// ---------- Chart ----------
function initChart() {
  const container = document.getElementById('chart');
  state.chart = LightweightCharts.createChart(container, {
    layout: { background: { color: '#12161c' }, textColor: '#e6edf3' },
    grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    rightPriceScale: { borderColor: '#21262d' },
    timeScale: { borderColor: '#21262d', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#00c853', downColor: '#ff5252', borderUpColor: '#00c853', borderDownColor: '#ff5252',
    wickUpColor: '#00c853', wickDownColor: '#ff5252'
  });

  // Generate initial candles
  const candles = generateCandles(state.price, 120);
  state.candleSeries.setData(candles);

  // Resize
  new ResizeObserver(() => {
    state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    repositionLimitXs();
  }).observe(container);

  // Keep limit X buttons on the line when the chart is scrolled or scaled
  state.chart.timeScale().subscribeVisibleLogicalRangeChange(() => repositionLimitXs());
  state.chart.subscribeCrosshairMove(() => repositionLimitXs());

  // Chart click no longer closes — use the X on the position line instead
}

function generateCandles(startPrice, count) {
  const data = [];
  let price = startPrice * 0.97;
  const now = Math.floor(Date.now() / 1000);
  const step = candleInterval;
  for (let i = count; i > 0; i--) {
    const time = now - i * step;
    const open = price;
    const change = (Math.random() - 0.5) * startPrice * 0.004;
    price = Math.max(startPrice * 0.1, price + change);
    const high = Math.max(open, price) + Math.random() * startPrice * 0.001;
    const low = Math.min(open, price) - Math.random() * startPrice * 0.001;
    data.push({ time, open, high, low, close: price });
  }
  return data;
}

function updateChart(newPrice) {
  const last = state.candleSeries.data().slice(-1)[0];
  if (!last) return;
  const now = Math.floor(Date.now() / 1000);
  // Update last candle or add new every ~minute
  if (now - last.time < 60) {
    state.candleSeries.update({
      time: last.time,
      open: last.open,
      high: Math.max(last.high, newPrice),
      low: Math.min(last.low, newPrice),
      close: newPrice
    });
  } else {
    state.candleSeries.update({
      time: now,
      open: last.close,
      high: newPrice,
      low: newPrice,
      close: newPrice
    });
  }
}

function updatePositionLine() {
  if (state.priceLine) { state.candleSeries.removePriceLine(state.priceLine); state.priceLine = null; }
  if (state.tpLine) { state.candleSeries.removePriceLine(state.tpLine); state.tpLine = null; }
  if (state.slLine) { state.candleSeries.removePriceLine(state.slLine); state.slLine = null; }
  const oldX = document.getElementById('posLineX');
  if (oldX) oldX.remove();

  const pos = state.positions.find(p => p.market === currentMarket);
  if (pos) {
    state.priceLine = state.candleSeries.createPriceLine({
      price: pos.entry,
      color: pos.side === 'long' ? '#00c853' : '#ff5252',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `${pos.side.toUpperCase()} @ ${pos.entry.toFixed(1)}`
    });
    if (pos.tp) {
      state.tpLine = state.candleSeries.createPriceLine({
        price: pos.tp, color: '#3fb950', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true, title: `TP @ ${pos.tp.toFixed(1)}`
      });
    }
    if (pos.sl) {
      state.slLine = state.candleSeries.createPriceLine({
        price: pos.sl, color: '#f85149', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true, title: `SL @ ${pos.sl.toFixed(1)}`
      });
    }
    const chartEl = document.getElementById('chart');
    const xBtn = document.createElement('div');
    xBtn.id = 'posLineX';
    xBtn.className = 'pos-line-x';
    xBtn.title = 'Close position';
    xBtn.textContent = '✕';
    xBtn.onclick = (e) => { e.stopPropagation(); openCloseModal(pos.id); };
    chartEl.appendChild(xBtn);
    const y = state.candleSeries.priceToCoordinate(pos.entry);
    xBtn.style.top = (y != null ? y : 50) + 'px';
  }
}

// ---------- Order Book ----------
function updateBook() {
  const asks = document.getElementById('asks');
  const bids = document.getElementById('bids');
  asks.innerHTML = '';
  bids.innerHTML = '';
  const spread = state.price * 0.0002;
  let askPrice = state.price + spread / 2;
  let bidPrice = state.price - spread / 2;

  for (let i = 0; i < 12; i++) {
    const size = (Math.random() * 2 + 0.1).toFixed(3);
    const total = (parseFloat(size) * (i + 1) * 0.8).toFixed(2);
    asks.innerHTML = `<div class="book-row ask"><span>${askPrice.toFixed(1)}</span><span>${size}</span><span>${total}</span></div>` + asks.innerHTML;
    askPrice += state.price * 0.00015;

    bids.innerHTML += `<div class="book-row bid"><span>${bidPrice.toFixed(1)}</span><span>${size}</span><span>${total}</span></div>`;
    bidPrice -= state.price * 0.00015;
  }
  document.getElementById('spread').textContent = `Spread ${spread.toFixed(2)} (${(spread / state.price * 100).toFixed(3)}%)`;
}

// ---------- UI Updates ----------
function updateSizeUnit() {
  const sel = document.getElementById('sizeUnit');
  if (!sel) return;
  const coin = currentMarket.split('-')[0];
  const cur = sel.value;
  sel.innerHTML = `<option>${coin}</option><option>USDC</option>`;
  if (cur === 'USDC') sel.value = 'USDC';
}
function updateUI() {
  document.getElementById('markPrice').textContent = state.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  document.getElementById('available').textContent = state.balance.toFixed(2) + ' USDC';
  document.getElementById('leverageVal').textContent = state.leverage + 'x';

  const pos = state.positions.find(p => p.market === currentMarket);
  document.getElementById('currentPos').textContent = pos ? (pos.side === 'long' ? '+' : '-') + pos.size.toFixed(4) + ' BTC' : '0.00 BTC';

  renderPositions();
  calculateOrder();
  updatePositionLine();
}

function renderPositions() {
  const body = document.getElementById('positionsBody');
  if (state.positions.length === 0) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--muted);">No open positions yet</td></tr>';
    return;
  }
  body.innerHTML = state.positions.map(p => {
    const pnl = (p.side === 'long' ? (state.price - p.entry) : (p.entry - state.price)) * p.size;
    const roe = (pnl / p.margin) * 100;
    const cls = pnl >= 0 ? 'pos' : 'neg';
    return `<tr>
      <td class="${p.side === 'long' ? 'pos' : 'neg'}">${p.side.toUpperCase()}</td>
      <td>${p.market}</td>
      <td>${p.isolated ? 'Isolated' : 'Cross'}</td>
      <td>${p.size.toFixed(4)}</td>
      <td>${p.entry.toFixed(1)}</td>
      <td>${state.price.toFixed(1)}</td>
      <td class="${cls}">${pnl.toFixed(2)} (${roe.toFixed(1)}%)</td>
      <td>${p.liq.toFixed(1)}</td>
      <td>${p.margin.toFixed(2)}</td>
      <td>
        <span class="close-types">
          <button class="close-link" onclick="openCloseModal('${p.id}','limit')">Limit</button>
          <button class="close-link" onclick="openCloseModal('${p.id}','market')">Market</button>
          <button class="close-link" onclick="openCloseModal('${p.id}','trailing')">Trailing</button>
          <button class="close-link" onclick="openCloseModal('${p.id}','reverse')">Reverse</button>
        </span>
      </td>
      <td>
        <button class="tpsl-edit" onclick="editPositionTpsl('${p.id}')" title="Edit TP/SL">✎</button>
        <span class="tpsl-mini">${p.tp ? p.tp.toFixed(0) : '—'} / ${p.sl ? p.sl.toFixed(0) : '—'}</span>
      </td>
    </tr>`;
  }).join('');
}

function calculateOrder() {
  const sizeInput = parseFloat(document.getElementById('sizeInput').value) || 0;
  const unit = document.getElementById('sizeUnit').value;
  let size = sizeInput;
  if (unit === 'USDC' && state.price > 0) size = sizeInput / state.price;

  const notional = size * state.price;
  const margin = notional / state.leverage;
  let liq = 0;
  if (size > 0) {
    // Simple isolated liq estimate (maintenance ~0.5%)
    const maint = 0.005;
    if (state.side === 'long') liq = state.price * (1 - 1 / state.leverage + maint);
    else liq = state.price * (1 + 1 / state.leverage - maint);
  }

  document.getElementById('notional').textContent = notional > 0 ? '$' + notional.toFixed(2) : '—';
  document.getElementById('marginReq').textContent = margin > 0 ? '$' + margin.toFixed(2) : '—';
  document.getElementById('liqPrice').textContent = liq > 0 ? liq.toFixed(1) : '—';
  document.getElementById('pctVal').textContent = document.getElementById('pctSlider').value + '%';
}

function updateTpslPct() {
  const tp = parseFloat(document.getElementById('tpPrice').value);
  const sl = parseFloat(document.getElementById('slPrice').value);
  const entry = state.price;
  if (tp > 0 && entry > 0) {
    const pct = ((tp - entry) / entry) * 100;
    const marginPct = pct * state.leverage;
    if (document.activeElement.id !== 'tpPctInput') {
      document.getElementById('tpPctInput').value = marginPct.toFixed(1);
    }
  }
  if (sl > 0 && entry > 0) {
    const pct = ((sl - entry) / entry) * 100;
    const marginPct = pct * state.leverage;
    if (document.activeElement.id !== 'slPctInput') {
      document.getElementById('slPctInput').value = marginPct.toFixed(1);
    }
  }
  showTpslArrows();
}

function showTpslArrows() {
  const chart = document.getElementById('chart');
  chart.querySelectorAll('.chart-arrow').forEach(el => el.remove());
  const toggle = document.getElementById('tpslToggle');
  if (!toggle || !toggle.checked) return;
  const tp = parseFloat(document.getElementById('tpPrice').value);
  const sl = parseFloat(document.getElementById('slPrice').value);
  if (!tp && !sl) return;

  const rect = chart.getBoundingClientRect();
  const midY = rect.height * 0.45;

  if (tp > state.price) {
    const a = document.createElement('div');
    a.className = 'chart-arrow tp';
    a.style.left = '20px';
    a.style.top = (midY - 60) + 'px';
    a.innerHTML = `↑ TP @ ${tp.toFixed(0)}<div class="arrow-line" style="height:40px; bottom:-42px;"></div>`;
    chart.appendChild(a);
  }
  if (sl > 0 && sl < state.price) {
    const a = document.createElement('div');
    a.className = 'chart-arrow sl';
    a.style.left = '20px';
    a.style.top = (midY + 20) + 'px';
    a.innerHTML = `↓ SL @ ${sl.toFixed(0)}<div class="arrow-line" style="height:40px; top:-42px;"></div>`;
    chart.appendChild(a);
  }
}
function updateLimitHint() {
  const pct = parseFloat(document.getElementById('limitPct').value);
  const hint = document.getElementById('limitHint');
  const mkt = document.getElementById('limitMkt');
  mkt.textContent = 'Mkt ' + state.price.toFixed(markets[currentMarket]?.precision || 1);
  if (isNaN(pct) || pct === 0) { hint.textContent = '—'; return; }
  const px = state.price * (1 + pct / 100);
  const ok = (state.side === 'long' && pct < 0) || (state.side === 'short' && pct > 0);
  hint.textContent = '@ ' + px.toFixed(markets[currentMarket]?.precision || 1);
  hint.style.color = ok ? '#00c853' : '#ff5252';
}
function placeLimitOrder() {
  const pct = parseFloat(document.getElementById('limitPct').value);
  if (isNaN(pct) || pct === 0) return alert('Enter a % away from market (e.g. -2 for a long limit below).');
  const px = state.price * (1 + pct / 100);
  const size = parseFloat(document.getElementById('sizeInput').value) || 0.01;
  const id = 'lim-' + Date.now();
  limitOrders.push({ id, market: currentMarket, side: state.side, price: px, size });
  drawLimitLine(px, state.side, id);
  showToast(`Limit ${state.side} @ ${px.toFixed(1)} (${pct}%)`);
  hypurrSay(`Limit at ${px.toFixed(1)}. Look at the chart — the line is in the middle. Also check the Open Orders tab.`, 4000);
  // Point the user at the chart and open orders
  const ordersTab = document.querySelector('.tab[data-tab="orders"]');
  if (ordersTab) ordersTab.classList.add('glow');
  setTimeout(() => ordersTab && ordersTab.classList.remove('glow'), 4000);
  window.limitPlaced = true;
  if (typeof checkStepProgress === 'function') checkStepProgress();
}
function refreshLimitLines() {
  // Remove all limit X buttons, then redraw only the current market's
  document.querySelectorAll('[id^="limitX-"]').forEach(x => x.remove());
  limitOrders.filter(o => o.market === currentMarket).forEach(o => {
    drawLimitLine(o.price, o.side, o.id, true);
  });
}
function drawLimitLine(price, side, id, skipStore) {
  if (!state.candleSeries) return;
  state.candleSeries.createPriceLine({
    price,
    color: side === 'long' ? '#42a5f5' : '#ff9800',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted,
    axisLabelVisible: false,
    title: ''
  });
  // Combined label + X in the middle of the chart so the text is readable
  const chartEl = document.getElementById('chart');
  const tag = document.createElement('div');
  tag.className = 'limit-tag';
  tag.id = 'limitX-' + id;
  tag.dataset.price = price;
  tag.innerHTML = `<span>LIMIT ${side.toUpperCase()} @ ${price.toFixed(0)}</span><button class="limit-tag-x">✕</button>`;
  tag.querySelector('.limit-tag-x').onclick = (e) => { e.stopPropagation(); cancelLimit(id); };
  chartEl.appendChild(tag);
  repositionLimitXs();
}
function repositionLimitXs() {
  if (!state.candleSeries) return;
  const chartEl = document.getElementById('chart');
  const w = chartEl.clientWidth;
  document.querySelectorAll('[id^="limitX-"]').forEach(x => {
    const price = parseFloat(x.dataset.price);
    const y = state.candleSeries.priceToCoordinate(price);
    if (y == null) { x.style.display = 'none'; return; }
    x.style.display = 'flex';
    x.style.top = y + 'px';
    x.style.left = Math.max(20, w / 2 - 90) + 'px';
    x.style.right = 'auto';
  });
}
function cancelLimit(id) {
  limitOrders = limitOrders.filter(o => o.id !== id);
  const x = document.getElementById('limitX-' + id);
  if (x) x.remove();
  window.limitCancelled = true;
  showToast('Limit cancelled');
  hypurrSay('Limit cancelled. The line is gone.', 2000);
  if (typeof checkStepProgress === 'function') checkStepProgress();
}
function drawSrScenario() {
  if (!state.candleSeries) return;
  const data = state.candleSeries.data();
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const mid = (hi + lo) / 2;
  // Place zones inside the visible candle range so both show without dragging
  const support = lo + (mid - lo) * 0.25;
  const resistance = hi - (hi - mid) * 0.25;
  for (let i = -2; i <= 2; i++) {
    const band = (hi - lo) * 0.008;
    state.candleSeries.createPriceLine({
      price: support + i * band,
      color: i === 0 ? '#66bb6a' : 'rgba(102,187,106,0.4)',
      lineWidth: i === 0 ? 3 : 6,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: i === 0,
      title: i === 0 ? 'SUPPORT — buy' : ''
    });
    state.candleSeries.createPriceLine({
      price: resistance + i * band,
      color: i === 0 ? '#ef5350' : 'rgba(239,83,80,0.4)',
      lineWidth: i === 0 ? 3 : 6,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: i === 0,
      title: i === 0 ? 'RESISTANCE — sell' : ''
    });
  }
  hypurrSay('Green box = support (buy). Red box = resistance (sell). Both are on screen.', 0);
  return { support, resistance };
}
function placeOrder() {
  if (orderType === 'limit') {
    placeLimitOrder();
    return;
  }
  const sizeInput = parseFloat(document.getElementById('sizeInput').value) || 0;
  if (sizeInput <= 0) return alert('Enter a size');
  const unit = document.getElementById('sizeUnit').value;
  let size = sizeInput;
  if (unit === 'USDC') size = sizeInput / state.price;

  const notional = size * state.price;
  const margin = notional / state.leverage;

  if (margin > state.balance) {
    const mr = document.getElementById('marginReq');
    const av = document.getElementById('available');
    if (mr) { mr.classList.add('glow'); mr.style.color = '#ff5252'; }
    if (av) { av.classList.add('glow'); av.style.color = '#ff5252'; }
    showToast(`Insufficient margin. Need $${margin.toFixed(2)}, available $${state.balance.toFixed(2)}`);
    hypurrSay(`Need $${margin.toFixed(2)} but only $${state.balance.toFixed(2)} available. Lower size or deposit.`, 4000);
    setTimeout(() => {
      if (mr) { mr.classList.remove('glow'); mr.style.color = ''; }
      if (av) { av.classList.remove('glow'); av.style.color = ''; }
    }, 4000);
    return;
  }

  // Close opposite if exists (simple)
  const existing = state.positions.find(p => p.market === currentMarket && p.side !== state.side);
  if (existing) closePosition(existing.id, true);

  state.balance -= margin;
  const id = Date.now().toString();
  const maint = 0.005;
  const liq = state.side === 'long'
    ? state.price * (1 - 1 / state.leverage + maint)
    : state.price * (1 + 1 / state.leverage - maint);

  state.positions.push({
    id, market: currentMarket, side: state.side, size, entry: state.price, margin, leverage: state.leverage, liq,
    isolated: state.isolated
  });

  document.getElementById('sizeInput').value = '';
  updateUI();
  showToast(`${state.side.toUpperCase()} ${size.toFixed(4)} BTC @ ${state.price.toFixed(1)}`);
  orderPlaced = true;
  if (typeof checkStepProgress === 'function') checkStepProgress();
}

function openCloseModal(id, type = 'market') {
  closingPositionId = id;
  const p = state.positions.find(x => x.id === id);
  if (!p) return;
  document.getElementById('closeSizeLabel').textContent = p.size.toFixed(4) + ' BTC';
  document.getElementById('closePctSlider').value = 100;
  document.getElementById('closePctVal').textContent = '100%';
  document.getElementById('closeModal').style.display = 'flex';
  document.querySelector('#closeModal h3').textContent = type.charAt(0).toUpperCase() + type.slice(1) + ' Close';
  window.closeType = type;
}
function editPositionTpsl(id) {
  const p = state.positions.find(x => x.id === id);
  if (!p) return;
  window.editingTpslId = id;
  document.getElementById('tpslModalTp').value = p.tp || '';
  document.getElementById('tpslModalSl').value = p.sl || '';
  document.getElementById('tpslModal').style.display = 'flex';
}
function savePositionTpsl() {
  const p = state.positions.find(x => x.id === window.editingTpslId);
  if (!p) return;
  const tp = document.getElementById('tpslModalTp').value;
  const sl = document.getElementById('tpslModalSl').value;
  p.tp = tp ? parseFloat(tp) : null;
  p.sl = sl ? parseFloat(sl) : null;
  document.getElementById('tpslModal').style.display = 'none';
  updateUI();
  showToast('TP/SL updated');
  hypurrSay('TP/SL updated on the position.', 2000);
}
window.editPositionTpsl = editPositionTpsl;
function confirmMarketClose() {
  if (!closingPositionId) return;
  const pct = +document.getElementById('closePctSlider').value / 100;
  const p = state.positions.find(x => x.id === closingPositionId);
  if (!p) return;
  const onPartialStep = document.getElementById('guideOverlay').classList.contains('active') && guideSteps[state.guideStep]?.require === 'partial';
  if (onPartialStep && pct >= 0.99) {
    showToast('Guide wants you to close a partial position — drag the slider below 100%.');
    hypurrSay('This step is a partial close. Move the slider under 100%, then confirm.', 3000);
    return;
  }
  if (pct >= 0.99) {
    closePosition(closingPositionId);
  } else {
    closePartial(closingPositionId, pct);
  }
  document.getElementById('closeModal').style.display = 'none';
  const center = document.getElementById('notifCenter');
  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = `<div class="notif-circle"></div><div class="notif-text"><strong>Position closed</strong><br>${(pct*100).toFixed(0)}% closed at market. PnL realized.</div>`;
  center.appendChild(item);
  setTimeout(() => item.remove(), 5500);
  hypurrSay(`Closed ${(pct*100).toFixed(0)}%. Notification stays up for a few seconds.`, 3000);
}

function closePartial(id, fraction) {
  const idx = state.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = state.positions[idx];
  const closeSize = p.size * fraction;
  const closeMargin = p.margin * fraction;
  const pnl = (p.side === 'long' ? (state.price - p.entry) : (p.entry - state.price)) * closeSize;
  state.balance += closeMargin + pnl;
  p.size -= closeSize;
  p.margin -= closeMargin;
  if (p.size < 0.0001) {
    state.positions.splice(idx, 1);
  }
  showToast(`Closed ${(fraction * 100).toFixed(0)}% | PnL $${pnl.toFixed(2)}`);
  updateUI();
  partialDone = true;
  hypurrSay(`Partial close done. Size reduced, margin + PnL returned.`, 3000);
  if (typeof checkStepProgress === 'function') checkStepProgress();
}

function closePosition(id, silent = false) {
  const idx = state.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = state.positions[idx];
  const pnl = (p.side === 'long' ? (state.price - p.entry) : (p.entry - state.price)) * p.size;
  state.balance += p.margin + pnl;
  state.positions.splice(idx, 1);
  if (!silent) showToast(`Closed ${p.side} | PnL $${pnl.toFixed(2)}`);
  updateUI();
  fullDone = true;
  hypurrSay(`Full close from chart. Position gone, PnL realized.`, 3000);
  if (typeof checkStepProgress === 'function') checkStepProgress();
}

function seedCrossIsolatedDemo() {
  state.positions = state.positions.filter(p => p.id !== 'iso-win' && p.id !== 'cross-loss');
  const price = state.price;
  // Isolated winner: entry below current price, profit
  const isoEntry = price * 0.97;
  const isoSize = 0.02;
  const isoMargin = (isoSize * isoEntry) / 10;
  state.positions.push({
    id: 'iso-win', market: currentMarket, side: 'long', size: isoSize,
    entry: isoEntry, margin: isoMargin, leverage: 10,
    liq: isoEntry * (1 - 1 / 10 + 0.005), isolated: true
  });
  // Cross loser: entry above current price, loss, whole balance is collateral
  const crossEntry = price * 1.03;
  const crossSize = 0.02;
  const crossMargin = (crossSize * crossEntry) / 10;
  state.positions.push({
    id: 'cross-loss', market: currentMarket, side: 'long', size: crossSize,
    entry: crossEntry, margin: crossMargin, leverage: 10,
    liq: crossEntry * (1 - 1 / 10 + 0.005), isolated: false
  });
  updateUI();
}
function seedDemoPosition() {
  if (state.positions.length > 0) return;
  if (state.balance < 200) state.balance += 2000;
  const size = 0.05;
  const margin = (size * state.price) / 10;
  const maint = 0.005;
  const liq = state.price * (1 - 1 / 10 + maint);
  state.positions.push({
    id: 'demo-' + Date.now(),
    market: currentMarket,
    side: 'long',
    size,
    entry: state.price,
    margin,
    leverage: 10,
    liq
  });
  state.balance -= margin;
  updateUI();
  showToast('Demo position opened: 0.05 BTC long');
  hypurrSay('Demo 0.05 BTC long is open. Entry line is on the chart. Let’s close it next.', 0);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#00d4b1; color:#000; padding:10px 16px; border-radius:6px; z-index:9999; font-weight:600;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ---------- Events ----------
function bindEvents() {
  document.getElementById('leverageBtn').onclick = () => {
    const pop = document.getElementById('leveragePopover');
    pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('leverageSlider').oninput = (e) => {
    state.leverage = +e.target.value;
    document.getElementById('leverageBtn').textContent = state.leverage + 'x';
    updateUI();
    if (typeof checkStepProgress === 'function') checkStepProgress();
    if (document.getElementById('guideOverlay').classList.contains('active') && guideSteps[state.guideStep]?.require === 'leverage') {
      hypurrSay(`Nice — leverage is now ${state.leverage}x. Notional = margin × that.`, 0);
    }
  };
  document.getElementById('isolatedBtn').onclick = () => {
    state.isolated = true;
    document.getElementById('isolatedBtn').classList.add('btn');
    document.getElementById('isolatedBtn').classList.remove('secondary');
    document.getElementById('crossBtn').classList.add('secondary');
    document.getElementById('crossBtn').classList.remove('btn');
    if (typeof checkStepProgress === 'function') checkStepProgress();
    hypurrSay('Isolated mode: only this trade’s margin can be liquidated.', 2500);
  };
  document.getElementById('crossBtn').onclick = () => {
    state.isolated = false;
    document.getElementById('crossBtn').classList.add('btn');
    document.getElementById('crossBtn').classList.remove('secondary');
    document.getElementById('isolatedBtn').classList.add('secondary');
    document.getElementById('isolatedBtn').classList.remove('btn');
    if (typeof checkStepProgress === 'function') checkStepProgress();
    hypurrSay('Cross mode: whole balance backs every position. Bigger risk, bigger capacity.', 2500);
  };

  document.getElementById('longBtn').onclick = () => {
    state.side = 'long';
    document.getElementById('longBtn').classList.add('selected');
    document.getElementById('shortBtn').classList.remove('selected');
  };
  document.getElementById('shortBtn').onclick = () => {
    state.side = 'short';
    document.getElementById('shortBtn').classList.add('selected');
    document.getElementById('longBtn').classList.remove('selected');
  };

  document.getElementById('sizeInput').oninput = calculateOrder;
  document.getElementById('pctSlider').oninput = (e) => {
    const pct = +e.target.value / 100;
    const maxNotional = state.balance * state.leverage;
    const size = (maxNotional * pct) / state.price;
    document.getElementById('sizeInput').value = size > 0 ? size.toFixed(4) : '';
    calculateOrder();
    if (typeof checkStepProgress === 'function') checkStepProgress();
    if (document.getElementById('guideOverlay').classList.contains('active') && guideSteps[state.guideStep]?.require === 'margin' && pct > 0) {
      hypurrSay(`Margin committed. Watch the glowing number — that’s what you’re risking.`, 0);
    }
  };

  document.getElementById('tpslToggle').onchange = (e) => {
    document.getElementById('tpslInputs').style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked && !document.getElementById('tpPrice').value) {
      document.getElementById('tpPrice').value = (state.price * 1.02).toFixed(1);
      document.getElementById('slPrice').value = (state.price * 0.99).toFixed(1);
    }
    updateTpslPct();
    if (typeof checkStepProgress === 'function') checkStepProgress();
  };
  document.getElementById('tpPrice').oninput = () => { updateTpslPct(); showTpslArrows(); };
  document.getElementById('slPrice').oninput = () => { updateTpslPct(); showTpslArrows(); };
  document.getElementById('tpPctInput').oninput = () => {
    const pct = parseFloat(document.getElementById('tpPctInput').value);
    if (!isNaN(pct) && state.leverage > 0) {
      const pricePct = pct / state.leverage;
      document.getElementById('tpPrice').value = (state.price * (1 + pricePct / 100)).toFixed(1);
      updateTpslPct();
    }
  };
  document.getElementById('slPctInput').oninput = () => {
    const pct = parseFloat(document.getElementById('slPctInput').value);
    if (!isNaN(pct) && state.leverage > 0) {
      const pricePct = pct / state.leverage;
      document.getElementById('slPrice').value = (state.price * (1 + pricePct / 100)).toFixed(1);
      updateTpslPct();
    }
  };

  document.getElementById('placeOrder').onclick = placeOrder;

  // Close modal
  document.getElementById('closePctSlider').oninput = (e) => {
    document.getElementById('closePctVal').textContent = e.target.value + '%';
  };
  document.getElementById('confirmClose').onclick = confirmMarketClose;
  document.getElementById('closeModalX').onclick = () => {
    document.getElementById('closeModal').style.display = 'none';
  };

  // Deposit buttons
  document.getElementById('depositHeaderBtn').onclick = openDeposit;
  document.getElementById('depositBtn').onclick = openDeposit;
  document.getElementById('closeDeposit').onclick = () => {
    document.getElementById('depositModal').style.display = 'none';
  };
  document.querySelectorAll('.amount-btns button').forEach(btn => {
    btn.onclick = () => startBridge(+btn.dataset.amount);
  });

  // Guide
  document.getElementById('connectBtn').onclick = () => {
    connected = true;
    document.getElementById('connectBtn').textContent = '0x1a2b…3c4d';
    hypurrSay('Connected via Rabby / MetaMask (simulated). EVM wallet linked.', 3000);
    if (typeof checkStepProgress === 'function') checkStepProgress();
  };
  document.getElementById('pythMode').onchange = (e) => {
    if (e.target.checked) startPyth();
    else stopPyth();
  };
  document.getElementById('hypurrCat').onclick = (e) => {
    if (window.hypurrDidDrag) { window.hypurrDidDrag = false; return; }
    const panel = document.getElementById('faqPanel');
    if (panel.style.display === 'flex') closeFaq();
    else openFaq();
  };
  document.getElementById('faqClose').onclick = closeFaq;
  document.querySelectorAll('.faq-topics button').forEach(btn => {
    btn.onclick = () => showFaqTopic(btn.dataset.topic);
  });
  document.getElementById('faqOther').oninput = (e) => {
    const v = e.target.value.trim();
    if (v.length >= 2) matchFaq(v);
    else showFaqTopic(document.querySelector('.faq-topics button.active')?.dataset.topic || 'order');
  };
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showToast(tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1) + ' (simulated)');
    };
  });
  document.getElementById('tpslModalSave').onclick = savePositionTpsl;
  document.getElementById('tpslModalX').onclick = () => {
    document.getElementById('tpslModal').style.display = 'none';
  };
  document.getElementById('guideBtn').onclick = startGuide;
  document.getElementById('guideNext').onclick = nextGuide;
  document.getElementById('guideBack').onclick = prevGuide;
  // Floating tooltips — only after 1s hover, and only if tooltip mode is on
  const tip = document.getElementById('tooltipFloat');
  let tipTimer = null;
  document.body.addEventListener('mouseover', (e) => {
    clearTimeout(tipTimer);
    tip.style.display = 'none';
    const tipMode = document.getElementById('tooltipMode');
    if (!tipMode || !tipMode.checked) return;
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    const text = el.getAttribute('data-tooltip');
    if (!text) return;
    tipTimer = setTimeout(() => {
      tip.textContent = text;
      tip.style.display = 'block';
      const r = el.getBoundingClientRect();
      let left = r.left + r.width / 2 - tip.offsetWidth / 2;
      let top = r.top - tip.offsetHeight - 8;
      if (top < 8) top = r.bottom + 8;
      if (left < 8) left = 8;
      if (left + tip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tip.offsetWidth - 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }, 1000);
  });
  document.body.addEventListener('mouseout', (e) => {
    clearTimeout(tipTimer);
    if (!e.target.closest('[data-tooltip]')) tip.style.display = 'none';
  });
  document.getElementById('guidePause').onclick = () => {
    guidePaused = !guidePaused;
    const overlay = document.getElementById('guideOverlay');
    const spot = document.getElementById('spotlight');
    if (guidePaused) {
      spot.style.display = 'none';
      overlay.style.pointerEvents = 'none';
      document.getElementById('guidePause').textContent = 'Resume';
      hypurrSay('Paused — blackout removed. Interact freely, then hit Resume.', 0);
    } else {
      overlay.style.pointerEvents = '';
      document.getElementById('guidePause').textContent = 'Pause / Unblackout';
      showGuideStep();
    }
  };
  document.getElementById('guideSkip').onclick = () => {
    // Skip jumps ahead and keeps the guide open. Only a completed sprint closes it.
    state.guideStep = Math.min(state.guideStep + 1, guideSteps.length - 1);
    // Unlock positions once we are past the positions sprint
    if (state.guideStep >= 8) {
      const seal = document.getElementById('positionsSeal');
      if (seal) seal.classList.add('unlocked');
    }
    if (state.guideStep >= 3 && state.balance < 1000) {
      state.balance = 1000;
      updateUI();
    }
    showGuideStep();
  };
  document.getElementById('guideJump').onchange = (e) => {
    const v = e.target.value;
    if (v === '') return;
    state.guideStep = +v;
    e.target.value = '';
    if (+v >= 3 && state.balance < 1000) {
      state.balance = 1000;
      updateUI();
      showToast('Margin topped up to 1000 USDC');
    }
    // Anything past the positions sprint unlocks the table
    if (+v >= 8) {
      const seal = document.getElementById('positionsSeal');
      if (seal) seal.classList.add('unlocked');
    }
    if (!document.getElementById('guideOverlay').classList.contains('active')) {
      document.getElementById('guideOverlay').classList.add('active');
    }
    showGuideStep();
  };
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      candleInterval = +btn.dataset.tf * 60;
      loadCandles(+btn.dataset.tf);
    };
  });
  // Load real candles on start
  loadCandles(60);
  document.getElementById('marketDropdown').onchange = (e) => {
    currentMarket = e.target.value;
    updateSizeUnit();
    const m = markets[currentMarket];
    if (m) {
      state.price = m.price;
      loadCandles(+document.querySelector('.tf-btn.active')?.dataset.tf || 60);
      const pct = +document.getElementById('pctSlider').value / 100;
      if (pct > 0 && state.price > 0) {
        const maxNotional = state.balance * state.leverage;
        const size = (maxNotional * pct) / state.price;
        document.getElementById('sizeInput').value = size > 0 ? size.toFixed(4) : '';
      }
      updateUI();
      updateBook();
      refreshLimitLines();
      fetchPythPrice();
      // Clear stale TP/SL so BTC values don't linger on the new market
      document.getElementById('tpPrice').value = '';
      document.getElementById('slPrice').value = '';
      document.getElementById('tpPctInput').value = '';
      document.getElementById('slPctInput').value = '';
      if (typeof checkStepProgress === 'function') checkStepProgress();
    }
  };
  document.getElementById('orderTypeMarket').onclick = () => {
    orderType = 'market';
    document.getElementById('orderTypeMarket').classList.remove('secondary');
    document.getElementById('orderTypeLimit').classList.add('secondary');
    document.getElementById('limitRow').style.display = 'none';
  };
  document.getElementById('orderTypeLimit').onclick = () => {
    orderType = 'limit';
    document.getElementById('orderTypeLimit').classList.remove('secondary');
    document.getElementById('orderTypeMarket').classList.add('secondary');
    document.getElementById('limitRow').style.display = 'flex';
    updateLimitHint();
    if (typeof checkStepProgress === 'function') checkStepProgress();
  };
  document.getElementById('limitPct').oninput = () => {
    updateLimitHint();
    if (typeof checkStepProgress === 'function') checkStepProgress();
  };

  // Make Hypurr draggable
  const hypurrEl = document.getElementById('hypurr');
  const hypurrImg = document.getElementById('hypurrCat');
  hypurrImg.addEventListener('dragstart', (e) => e.preventDefault());
  let dragging = false, dragOffX = 0, dragOffY = 0, moved = false;
  hypurrEl.addEventListener('mousedown', (e) => {
    if (e.target.id === 'hypurrBubble') return;
    dragging = true;
    moved = false;
    hypurrUserMoved = true;
    const r = hypurrEl.getBoundingClientRect();
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    hypurrEl.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    moved = true;
    window.hypurrDidDrag = true;
    hypurrEl.style.left = (e.clientX - dragOffX) + 'px';
    hypurrEl.style.top = (e.clientY - dragOffY) + 'px';
    hypurrEl.style.right = 'auto';
    hypurrEl.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    hypurrEl.style.cursor = '';
    if (!moved) window.hypurrDidDrag = false;
  });
}

async function loadCandles(interval) {
  const m = markets[currentMarket];
  const symbol = m?.binance || 'BTCUSDT';
  const map = { 15: '15m', 60: '1h', 240: '4h' };
  const tf = map[interval] || '1h';
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=120`);
    if (!res.ok) throw new Error('klines');
    const raw = await res.json();
    const candles = raw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4]
    }));
    state.candleSeries.setData(candles);
    if (candles.length) state.price = candles[candles.length - 1].close;
    updateUI();
  } catch (err) {
    console.warn('klines failed', err);
    const candles = generateCandles(state.price, 120);
    state.candleSeries.setData(candles);
  }
}

function openDeposit() {
  document.getElementById('depositModal').style.display = 'flex';
}

function startBridge(amount) {
  document.getElementById('depositModal').style.display = 'none';
  const center = document.getElementById('notifCenter');
  const id = 'bridge-' + Date.now();
  const item = document.createElement('div');
  item.className = 'notif-item';
  item.id = id;
  item.innerHTML = `<div class="notif-circle"></div><div class="notif-text"><strong>Bridging $${amount}</strong><br>Securing transfer… funds arrive shortly.</div>`;
  center.appendChild(item);
  hypurrSay(`Bridging $${amount} — security checks take ~10s. Watch the pulsing circle.`, 0);

  let remaining = 10;
  const timer = setInterval(() => {
    remaining--;
    const text = item.querySelector('.notif-text');
    if (remaining > 0) {
      text.innerHTML = `<strong>Bridging $${amount}</strong><br>Security confirmation… ${remaining}s remaining.`;
    } else {
      clearInterval(timer);
      state.balance += amount;
      text.innerHTML = `<strong>Bridge complete</strong><br>$${amount} USDC now available as margin.`;
      updateUI();
      bridgeDone = true;
      hypurrSay(`Bridge done! $${amount} is now available margin.`, 3000);
      if (typeof checkStepProgress === 'function') checkStepProgress();
      setTimeout(() => item.remove(), 3000);
    }
  }, 1000);
}

// Hypurr tips (random when clicked outside guide)
const faqBank = {
  order: [
    { q: 'Where is the order form?', a: 'Right side of the screen — Size, Type, % Margin, Place Order.', action: null },
    { q: 'What is the point of the order form?', a: 'It is where you set size, leverage, and side, then open a position.', action: null },
    { q: 'Start order form guide', a: 'Jumping to Sprint 2: Order Form.', action: 3 },
    { q: 'List all order form guides', a: 'Sprint 2 covers Leverage, Commit Margin, Cross vs Isolated, and Place the Trade.', action: null }
  ],
  positions: [
    { q: 'Where is the positions table?', a: 'Bottom of the screen. It unlocks after the order form sprint.', action: null },
    { q: 'How do I close a position?', a: 'Use Limit, Market, Trailing, or Reverse in the row, or the ✕ on the chart line.', action: 8 },
    { q: 'Start positions guide', a: 'Jumping to Sprint 3: Positions.', action: 8 }
  ],
  bridge: [
    { q: 'How do I get funds?', a: 'Click Deposit (top-right). Bridging takes ~10s for security.', action: 1 },
    { q: 'Start bridge guide', a: 'Jumping to Sprint 1: Bridge.', action: 1 }
  ],
  limit: [
    { q: 'What is a limit order?', a: 'It fills only at your price or better. Must be away from the market.', action: null },
    { q: 'How do I set a limit?', a: 'Switch Type to Limit, enter a % away (negative for long, positive for short), then Place Order.', action: 12 },
    { q: 'Start limit guide', a: 'Jumping to Limit Orders.', action: 12 }
  ],
  sr: [
    { q: 'What is support and resistance?', a: 'Support is where price tends to hold (buy). Resistance is where it stalls (sell).', action: null },
    { q: 'Start support/resistance guide', a: 'Jumping to Sprint 5.', action: 16 }
  ],
  mission: [
    { q: 'What is the multi-market mission?', a: 'Open an ETH short and a HYPE long to complete Sprint 4.', action: 15 },
    { q: 'Start ETH/HYPE mission', a: 'Jumping to Sprint 4.', action: 15 }
  ]
};
function openFaq() {
  document.getElementById('faqPanel').style.display = 'flex';
  showFaqTopic('order');
}
function closeFaq() {
  document.getElementById('faqPanel').style.display = 'none';
}
function showFaqTopic(topic) {
  document.querySelectorAll('.faq-topics button').forEach(b => b.classList.toggle('active', b.dataset.topic === topic));
  const list = document.getElementById('faqList');
  const items = faqBank[topic] || [];
  list.innerHTML = items.map((it, i) => `<div class="faq-item" data-topic="${topic}" data-i="${i}"><div>${it.q}</div><div class="faq-answer">${it.a}</div></div>`).join('');
  list.querySelectorAll('.faq-item').forEach(el => {
    el.onclick = () => {
      const it = faqBank[el.dataset.topic][el.dataset.i];
      if (it.action != null) {
        closeFaq();
        state.guideStep = it.action;
        if (!document.getElementById('guideOverlay').classList.contains('active')) {
          document.getElementById('guideOverlay').classList.add('active');
        }
        showGuideStep();
      } else {
        hypurrSay(it.a, 5000);
      }
    };
  });
}
function matchFaq(query) {
  const q = query.toLowerCase();
  const hits = [];
  Object.entries(faqBank).forEach(([topic, items]) => {
    items.forEach((it, i) => {
      if (it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q) || topic.includes(q)) {
        hits.push({ ...it, topic, i });
      }
    });
  });
  const list = document.getElementById('faqList');
  if (!hits.length) { list.innerHTML = '<div class="faq-answer">No match. Try order form, positions, bridge, limit, support.</div>'; return; }
  list.innerHTML = hits.map(it => `<div class="faq-item" data-topic="${it.topic}" data-i="${it.i}"><div>${it.q}</div><div class="faq-answer">${it.a}</div></div>`).join('');
  list.querySelectorAll('.faq-item').forEach(el => {
    el.onclick = () => {
      const it = faqBank[el.dataset.topic][el.dataset.i];
      if (it.action != null) {
        closeFaq();
        state.guideStep = it.action;
        if (!document.getElementById('guideOverlay').classList.contains('active')) {
          document.getElementById('guideOverlay').classList.add('active');
        }
        showGuideStep();
      } else {
        hypurrSay(it.a, 5000);
      }
    };
  });
}
function hypurrSay(text, duration = 0) {
  const bubble = document.getElementById('hypurrBubble');
  if (!bubble) return;
  bubble.style.animation = 'none';
  void bubble.offsetWidth; // reflow
  bubble.style.animation = 'bubblePop 0.3s ease-out';
  bubble.textContent = text;
  if (duration > 0) {
    setTimeout(() => {
      if (document.getElementById('guideOverlay').classList.contains('active')) return;
      bubble.textContent = "I’m Hypurr, your assistant. Drag me anywhere. Click me for tips or Start Guide.";
    }, duration);
  }
}
const guideSteps = [
  {
    title: 'Sprint 0: Connect Wallet',
    text: 'Hyperliquid is an EVM app. Click Connect to link a Rabby or MetaMask wallet (simulated). This is not a Solana site — no Jupiter.',
    target: '#connectBtn',
    preview: 'Connect',
    require: 'connect',
    cat: 'Connect Rabby or MetaMask first. EVM only.'
  },
  {
    title: 'Sprint 1: Bridge Funds',
    text: 'Wallet is connected. Click Deposit (top-right) to bridge USDC. Bridging takes ~10s for security. Next stays locked until funds arrive. Hypurr is your assistant — you can drag me anywhere.',
    target: '#depositHeaderBtn',
    preview: 'Deposit',
    require: 'bridge',
    cat: 'Bridge next. No funds = no trade. Drag me if I get in the way.'
  },
  {
    title: 'Bridge complete — nice work',
    text: 'Sprint 1 is done. Funds are in. Take a break and look around. When you’re ready for the order form, use Jump to… or Start Guide.',
    target: null,
    cat: 'Sprint 1 complete. Take a break, then jump to Sprint 2.',
    endSprint: true
  },
  {
    title: 'Sprint 2: Order Form — Leverage',
    text: 'Funds are in. Click the Leverage box. Different perps have different max leverage (BTC up to 50x, most alts lower). Move the slider — Next unlocks after you change it. Stay on Market for now.',
    target: '#leverageBox',
    preview: 'Leverage',
    require: 'leverage',
    cat: 'Set leverage. Stay on Market.',
    onEnter: 'forceMarket'
  },
  {
    title: 'Sprint 2: Commit Margin',
    text: 'Drag the % Margin slider. The Margin Required number glows so you see what you’re committing. Next unlocks once you’ve set a size. Stay on Market.',
    target: '#pctSlider',
    preview: '% Margin',
    require: 'margin',
    cat: 'Commit some margin. Watch the glowing number.',
    onEnter: 'forceMarket'
  },
  {
    title: 'Sprint 2: Cross vs Isolated',
    text: 'Cross uses your whole balance as shared margin. Isolated only risks the margin on this trade. Switch modes — Next unlocks once you do.',
    target: '#modeToggle',
    preview: 'Cross / Isolated',
    require: 'mode',
    cat: 'Flip Cross ↔ Isolated.'
  },
  {
    title: 'Sprint 2: Place the Trade',
    text: 'Make sure Type is Market (not Limit). Then click Place Order. This opens the position you’ll manage next. (You already have margin from the bridge.)',
    target: '#placeOrder',
    preview: 'Place Order',
    require: 'order',
    cat: 'Confirm Market, then Place Order.',
    onEnter: 'forceMarket'
  },
  {
    title: 'Order form done — nice work',
    text: 'Sprint 2 is done. Review the position you opened. When you’re ready for position management, use Jump to… Sprint 3.',
    target: null,
    cat: 'Sprint 2 complete. Take a break, then jump to Sprint 3.',
    endSprint: true
  },
  {
    title: 'Sprint 3: Partial Close',
    text: 'In the Positions table, use the close links: Limit, Market, Trailing, or Reverse (same as Hyperliquid). Click Market for a market close popup. Drag the size slider and confirm. Next unlocks after you close.',
    target: '.bottom',
    preview: 'Market',
    require: 'partial',
    precondition: 'hasPosition',
    cat: 'Use Limit / Market / Trailing / Reverse to close.',
    onEnter: 'unlockPositions'
  },
  {
    title: 'Sprint 3: Full Close (Chart)',
    text: 'Click the ✕ on the green entry line (right side of the chart). That opens the Market Close popup. Choose the size and confirm. Clicking the line itself does not close.',
    target: '#chart',
    preview: 'lineX',
    previewHtml: true,
    require: 'full',
    precondition: 'hasPosition',
    cat: 'Click the ✕ on the position line to open Market Close.'
  },
  {
    title: 'Sprint 3: Set TP/SL from Positions',
    text: 'In the Positions table, click the pencil ✎ on your position. Enter TP and SL, then Save. The lines appear on the chart.',
    target: '.bottom',
    preview: 'pencil',
    previewHtml: true,
    require: 'posTpsl',
    precondition: 'hasPosition',
    cat: 'Click the pencil ✎, set TP and SL, Save.',
    onEnter: 'unlockPositions'
  },
  {
    title: 'Sprint 3: TP / SL + Support / Resistance',
    text: 'The chart shows support (green) and resistance (red). Place TP at or just under resistance, and SL just beneath support.',
    target: '#tpslBox',
    preview: 'TP / SL',
    require: 'tpsl',
    cat: 'TP at resistance, SL under support.',
    onEnter: 'srDemo',
    showChart: true
  },
  {
    title: 'Select an Asset',
    text: 'Use the market dropdown (top-left) to switch perps: BTC, ETH, XRP, HYPE, ZEC, SOL. Each has its own price, leverage limit, and volatility. Pick the one you want to trade.',
    target: '#marketDropdown',
    preview: 'Market',
    cat: 'Switch markets. Alts move more than BTC.'
  },
  {
    title: 'Market → Limit',
    text: 'Switch the order type from Market to Limit. A limit order only fills at your price or better — it must be away from the current market. For a long, set the limit below the market; for a short, above it.',
    target: '#orderTypeLimit',
    preview: 'Limit',
    require: 'limitType',
    cat: 'Switch to Limit. Price must be away from market.'
  },
  {
    title: 'Place the Limit',
    text: 'Enter a % away from market and click Place Order. The limit appears as a dotted line on the chart with an ✕. Next unlocks only after Place Order.',
    target: '#limitPct',
    preview: '% away',
    require: 'limitPlaced',
    cat: 'Enter % away, then Place Order. Watch the line.'
  },
  {
    title: 'Cancel the Limit',
    text: 'Click the ✕ on the limit line on the chart to cancel it. The line disappears.',
    target: '#chart',
    preview: '✕ on limit',
    require: 'limitCancel',
    cat: 'Click the ✕ on the limit line to cancel.'
  },
  {
    title: 'Sprint 3 done',
    text: 'Position management is done. Take a break. When you’re ready for the ETH short and HYPE long mission, click Resume Guide.',
    target: null,
    cat: 'Sprint 3 complete. Resume when ready for Sprint 4.',
    endSprint: true
  },
  {
    title: 'Sprint 4a: Find ETH',
    text: 'Subquest 1. Open the market dropdown (top-left) and select ETH-USDC. There is no single ETH-short button — first find the market.',
    target: '#marketDropdown',
    preview: 'ETH-USDC',
    require: 'selectEth',
    cat: 'Select ETH-USDC from the market dropdown.',
    noBlackout: true
  },
  {
    title: 'Sprint 4a: Short ETH',
    text: 'Subquest 2. ETH is selected. Confirm Type is Market, click Sell / Short, set a size, and Place Order. Next unlocks when the ETH short is open.',
    target: '#shortBtn',
    preview: 'Sell / Short',
    require: 'ethShort',
    cat: 'Market order. Click Sell / Short and Place Order.',
    noBlackout: true,
    onEnter: 'forceMarket'
  },
  {
    title: 'Sprint 4b: Find HYPE',
    text: 'Subquest 1. Open the market dropdown and select HYPE-USDC.',
    target: '#marketDropdown',
    preview: 'HYPE-USDC',
    require: 'selectHype',
    cat: 'Select HYPE-USDC from the market dropdown.',
    noBlackout: true
  },
  {
    title: 'Sprint 4b: Long HYPE',
    text: 'Subquest 2. HYPE is selected. Confirm Type is Market, click Buy / Long, set a size, and Place Order. Next unlocks when the HYPE long is open.',
    target: '#longBtn',
    preview: 'Buy / Long',
    require: 'hypeLong',
    cat: 'Market order. Click Buy / Long and Place Order.',
    noBlackout: true,
    onEnter: 'forceMarket'
  },
  {
    title: 'Sprint 5: Support & Resistance',
    text: 'Green box = support (buy). Red box = resistance (sell). Drag the chart if a zone is off-screen.',
    target: '#chart',
    preview: 'Support / Resistance',
    cat: 'Buy support, sell resistance. Drag to see both zones.',
    onEnter: 'srScenario',
    showChart: true
  },
  {
    title: 'Place with TP / SL',
    text: 'Place any order (Market or Limit) with TP and SL on. Check the TP/SL box, set both, then Place Order.',
    target: '#tpslBox',
    preview: 'TP / SL',
    require: 'orderWithTpsl',
    cat: 'Any order type. TP and SL both set, then Place Order.',
    onEnter: 'tpslDemo',
    noBlackout: true
  },
  {
    title: 'Cross vs Isolated: the winner',
    text: 'Congrats — the isolated long went according to plan. Close it. Available to Trade goes up by the margin plus profit. The rest of your balance never backed this trade.',
    target: '.bottom',
    preview: 'Close isolated',
    require: 'closedIsolated',
    cat: 'Close the isolated winner. Available margin rises. Balance did not back it.',
    onEnter: 'seedModes',
    noBlackout: true
  },
  {
    title: 'Cross vs Isolated: the loser',
    text: 'Now close the cross long. It is losing. The whole Available to Trade was collateral — if the loss had eaten the margin required to hold it, the trade would have been closed for you.',
    target: '.bottom',
    preview: 'Close cross',
    require: 'closedCross',
    cat: 'Close the cross loser. Whole balance was collateral.',
    noBlackout: true
  },
  {
    title: 'Done',
    text: 'Sprint 3 is done. You finished Bridge → Order form → Position management. Same flow on the real Hyperliquid app. Jump to… anytime to revisit.',
    target: null,
    cat: 'Sprint 3 complete. Minimize losses, maximize gains.',
    endSprint: true
  }
];

let leverageStart = 10;
let modeStart = true;
let partialDone = false;
let fullDone = false;
let orderPlaced = false;
let bridgeDone = false;
let connected = false;
let guidePaused = false;
let hypurrUserMoved = false;
let closingPositionId = null;

let guideBegun = false;
function startGuide() {
  if (!guideBegun) {
    state.guideStep = 0;
    guideBegun = true;
  }
  // If resuming after a finished sprint, advance to the next one
  const s = guideSteps[state.guideStep];
  if (s && s.endSprint && !document.getElementById('guideOverlay').classList.contains('active')) {
    state.guideStep = Math.min(state.guideStep + 1, guideSteps.length - 1);
  }
  leverageStart = +document.getElementById('leverageSlider').value;
  modeStart = state.isolated;
  partialDone = false;
  fullDone = false;
  orderPlaced = state.positions.length > 0;
  document.getElementById('guideOverlay').classList.add('active');
  document.getElementById('guideBtn').textContent = 'Resume Guide';
  showGuideStep();
}
function closeGuide() {
  document.getElementById('guideOverlay').classList.remove('active');
  document.getElementById('spotlight').style.display = 'none';
  document.getElementById('guideArrow').style.display = 'none';
  const mr = document.getElementById('marginReq');
  if (mr) mr.classList.remove('glow');
  const hypurr = document.getElementById('hypurr');
  hypurr.classList.remove('with-guide');
  // Only reset position if the user never dragged it
  if (!hypurrUserMoved) {
    hypurr.style.left = '';
    hypurr.style.top = '';
    hypurr.style.right = '20px';
    hypurr.style.bottom = '20px';
  }
}
function nextGuide() {
  const s = guideSteps[state.guideStep];
  if (s && s.endSprint) {
    closeGuide();
    showToast(s.cat || 'Sprint complete. Take a break.');
    document.getElementById('guideBtn').textContent = 'Resume Guide';
    return;
  }
  if (state.guideStep >= guideSteps.length - 1) {
    closeGuide();
    return;
  }
  state.guideStep++;
  showGuideStep();
}
function prevGuide() {
  if (state.guideStep <= 0) return;
  state.guideStep--;
  showGuideStep();
}
function checkStepProgress() {
  const s = guideSteps[state.guideStep];
  const nextBtn = document.getElementById('guideNext');
  if (!s || !s.require) {
    nextBtn.disabled = false;
    nextBtn.style.opacity = '1';
    nextBtn.textContent = s && s.endSprint ? 'Finished' : (state.guideStep === guideSteps.length - 1 ? 'Finished' : 'Next');
    return;
  }
  let ok = false;
  if (s.require === 'connect') {
    ok = connected;
  } else if (s.require === 'bridge') {
    ok = bridgeDone || state.balance > 0;
  } else if (s.require === 'leverage') {
    ok = +document.getElementById('leverageSlider').value !== leverageStart;
  } else if (s.require === 'margin') {
    ok = +document.getElementById('pctSlider').value > 0;
  } else if (s.require === 'mode') {
    ok = state.isolated !== modeStart;
  } else if (s.require === 'order') {
    ok = (orderPlaced || state.positions.length > 0) && orderType === 'market';
  } else if (s.require === 'partial') {
    ok = partialDone;
  } else if (s.require === 'full') {
    ok = fullDone || state.positions.length === 0;
  } else if (s.require === 'limitType') {
    ok = orderType === 'limit';
  } else if (s.require === 'limitPlaced') {
    ok = window.limitPlaced === true;
  } else if (s.require === 'limitCancel') {
    ok = window.limitCancelled === true;
  } else if (s.require === 'selectEth') {
    ok = currentMarket === 'ETH-USDC';
  } else if (s.require === 'ethShort') {
    ok = state.positions.some(p => p.market === 'ETH-USDC' && p.side === 'short') && orderType === 'market';
  } else if (s.require === 'selectHype') {
    ok = currentMarket === 'HYPE-USDC';
  } else if (s.require === 'hypeLong') {
    ok = state.positions.some(p => p.market === 'HYPE-USDC' && p.side === 'long') && orderType === 'market';
  } else if (s.require === 'posTpsl') {
    const pos = state.positions.find(p => p.market === currentMarket);
    ok = pos && pos.tp > 0 && pos.sl > 0;
  } else if (s.require === 'orderWithTpsl') {
    const tp = parseFloat(document.getElementById('tpPrice').value);
    const sl = parseFloat(document.getElementById('slPrice').value);
    const on = document.getElementById('tpslToggle').checked;
    ok = on && tp > 0 && sl > 0 && (orderPlaced || state.positions.length > 0);
  } else if (s.require === 'closedIsolated') {
    ok = !state.positions.some(p => p.id === 'iso-win');
  } else if (s.require === 'closedCross') {
    ok = !state.positions.some(p => p.id === 'cross-loss');
  } else if (s.require === 'tpsl') {
    const tp = parseFloat(document.getElementById('tpPrice').value);
    const sl = parseFloat(document.getElementById('slPrice').value);
    const on = document.getElementById('tpslToggle').checked;
    ok = on && tp > state.price && sl > 0 && sl < state.price;
  }
  nextBtn.disabled = !ok;
  nextBtn.style.opacity = ok ? '1' : '0.5';
  nextBtn.textContent = ok ? 'Next' : 'Do the action first';
}
function checkPrecondition(s) {
  if (!s || !s.precondition) return true;
  if (s.precondition === 'hasPosition') return state.positions.length > 0;
  return true;
}
function showGuideStep() {
  const s = guideSteps[state.guideStep];
  // Precondition gate: if not met, redirect to opening a position first
  if (s && !checkPrecondition(s)) {
    document.getElementById('guideTitle').textContent = 'Open a position first';
    document.getElementById('guideText').textContent = 'This step needs an open perp. Set Type to Market, set a size, and click Place Order. Once a position is in the table, this step continues.';
    document.getElementById('guidePreview').innerHTML = '<button class="btn preview-btn">Place Order</button> ← look for this';
    hypurrSay('No open position. Place one first, then we continue.');
    const nextBtn = document.getElementById('guideNext');
    nextBtn.disabled = true;
    nextBtn.style.opacity = '0.5';
    nextBtn.textContent = 'Open a position first';
    // Point at Place Order, no blackout so they can use the form
    document.getElementById('spotlight').style.display = 'none';
    document.getElementById('guideArrow').style.display = 'none';
    if (state.balance < 1000) { state.balance = 1000; updateUI(); }
    // Watch for a position, then resume
    const watcher = setInterval(() => {
      if (state.positions.length > 0) {
        clearInterval(watcher);
        showGuideStep();
      }
    }, 500);
    return;
  }
  document.getElementById('guideTitle').textContent = s.title;
  document.getElementById('guideText').textContent = s.text;
  document.getElementById('guideBack').style.visibility = state.guideStep === 0 ? 'hidden' : 'visible';
  hypurrSay(s.cat || s.text);

  const preview = document.getElementById('guidePreview');
  preview.innerHTML = '';
  if (s.preview) {
    if (s.previewHtml && s.preview === 'lineX') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex; align-items:center; gap:6px; background:#12161c; padding:6px 10px; border-radius:6px; border:1px solid #21262d;';
      wrap.innerHTML = `
        <div style="width:80px; height:0; border-top:2px dashed #00c853;"></div>
        <span style="background:#00c853; color:#000; font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px;">LONG @ ${state.price.toFixed(0)}</span>
        <div style="width:20px; height:20px; background:#ff5252; color:#fff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700;">✕</div>
      `;
      preview.appendChild(wrap);
      preview.appendChild(document.createTextNode(' ← look for this'));
    } else if (s.previewHtml && s.preview === 'pencil') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex; align-items:center; gap:6px; background:#12161c; padding:6px 10px; border-radius:6px; border:1px solid #21262d;';
      wrap.innerHTML = `<span style="color:#00d4b1; font-size:16px;">✎</span><span style="font-size:11px; color:#8b949e;">— / —</span>`;
      preview.appendChild(wrap);
      preview.appendChild(document.createTextNode(' ← click the pencil'));
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn preview-btn';
      btn.textContent = s.preview;
      preview.appendChild(btn);
      preview.appendChild(document.createTextNode(' ← look for this'));
    }
  }

  const spot = document.getElementById('spotlight');
  const arrow = document.getElementById('guideArrow');
  const mr = document.getElementById('marginReq');
  const guideBox = document.querySelector('.guide-box');
  const hypurr = document.getElementById('hypurr');
  if (mr) mr.classList.remove('glow');

  if (s.onEnter === 'forceMarket') {
    orderType = 'market';
    document.getElementById('orderTypeMarket')?.classList.remove('secondary');
    document.getElementById('orderTypeLimit')?.classList.add('secondary');
    document.getElementById('limitRow').style.display = 'none';
  }
  if (s.onEnter === 'unlockPositions') {
    const seal = document.getElementById('positionsSeal');
    if (seal) seal.classList.add('unlocked');
  }
  if (s.onEnter === 'seedModes') {
    seedCrossIsolatedDemo();
    hypurrSay('Isolated winner and cross loser are in the table. Close the isolated one first.', 0);
  }
  if (s.onEnter === 'srScenario') {
    drawSrScenario();
  }
  if (s.onEnter === 'srDemo') {
    document.getElementById('tpslToggle').checked = true;
    document.getElementById('tpslInputs').style.display = 'block';
    const levels = drawSrScenario();
    if (levels) {
      document.getElementById('tpPrice').value = levels.resistance.toFixed(1);
      document.getElementById('slPrice').value = (levels.support * 0.998).toFixed(1);
    }
    updateTpslPct();
  }
  if (s.onEnter === 'tpslDemo') {
    document.getElementById('tpslToggle').checked = true;
    document.getElementById('tpslInputs').style.display = 'block';
    if (!document.getElementById('tpPrice').value) {
      document.getElementById('tpPrice').value = (state.price * 1.015).toFixed(1);
      document.getElementById('slPrice').value = (state.price * 0.995).toFixed(1);
    }
    updateTpslPct();
  }

  // Position guide near the target (or order panel as fallback)
  let leftPos = 40, topPos = 80;

  if (s.target) {
    const el = document.querySelector(s.target);
    if (el) {
      const r = el.getBoundingClientRect();
      const boxW = 360, boxH = 220;
      // Prefer placing the guide just left of the target, or above if near bottom
      // Order panel targets: keep the guide left of the panel so it never covers the form
      const panel = document.querySelector('.order-panel');
      if (panel && el.closest('.order-panel')) {
        const pr = panel.getBoundingClientRect();
        leftPos = Math.max(20, pr.left - boxW - 40);
        topPos = Math.max(70, Math.min(r.top - 40, window.innerHeight - boxH - 40));
      } else if (r.left > boxW + 40) {
        leftPos = r.left - boxW - 16;
        topPos = Math.max(70, Math.min(r.top, window.innerHeight - boxH - 20));
      } else if (r.top > boxH + 80) {
        leftPos = Math.max(20, r.left);
        topPos = r.top - boxH - 16;
      } else {
        leftPos = Math.max(20, r.right + 16);
        topPos = Math.max(70, r.top);
      }
      // Chart step: keep guide on the right so chart stays free
      if (s.target === '#chart') {
        leftPos = window.innerWidth - boxW - 40;
        topPos = 80;
      }
      // Bottom panel (positions): place guide above it
      if (s.target === '.bottom') {
        leftPos = Math.max(20, r.left + 20);
        topPos = Math.max(70, r.top - boxH - 16);
      }
    }
  }
  guideBox.style.left = leftPos + 'px';
  guideBox.style.top = topPos + 'px';
  guideBox.style.right = 'auto';
  guideBox.style.bottom = 'auto';

  // Hypurr: place one guide-length below the guide, unless the user has dragged it
  if (!hypurrUserMoved) {
    const guideH = 220;
    hypurr.classList.add('with-guide');
    hypurr.style.left = Math.max(20, leftPos) + 'px';
    hypurr.style.top = Math.min(topPos + guideH + 24, window.innerHeight - 140) + 'px';
    hypurr.style.right = 'auto';
    hypurr.style.bottom = 'auto';
  }

  // Close any open leverage popover so it doesn't cover the guide
  const pop = document.getElementById('leveragePopover');
  if (pop) pop.style.display = 'none';

  if (s.target && !s.noBlackout) {
    const el = document.querySelector(s.target);
    if (el) {
      let r = el.getBoundingClientRect();
      // On margin step, expand the hole to also cover the Margin Required box
      if (s.showChart) {
        const chart = document.getElementById('chart');
        if (chart) {
          const chr = chart.getBoundingClientRect();
          r = {
            left: Math.min(r.left, chr.left),
            top: Math.min(r.top, chr.top),
            right: Math.max(r.right, chr.right),
            bottom: Math.max(r.bottom, chr.bottom),
            width: Math.max(r.right, chr.right) - Math.min(r.left, chr.left),
            height: Math.max(r.bottom, chr.bottom) - Math.min(r.top, chr.top)
          };
        }
      }
      if (s.require === 'limitPlaced') {
        const place = document.getElementById('placeOrder');
        if (place) {
          const pr = place.getBoundingClientRect();
          r = {
            left: Math.min(r.left, pr.left),
            top: Math.min(r.top, pr.top),
            right: Math.max(r.right, pr.right),
            bottom: Math.max(r.bottom, pr.bottom),
            width: Math.max(r.right, pr.right) - Math.min(r.left, pr.left),
            height: Math.max(r.bottom, pr.bottom) - Math.min(r.top, pr.top)
          };
        }
      }
      if (s.require === 'margin') {
        const calc = document.getElementById('calcBox');
        if (calc) {
          const cr = calc.getBoundingClientRect();
          r = {
            left: Math.min(r.left, cr.left),
            top: Math.min(r.top, cr.top),
            right: Math.max(r.right, cr.right),
            bottom: Math.max(r.bottom, cr.bottom),
            width: Math.max(r.right, cr.right) - Math.min(r.left, cr.left),
            height: Math.max(r.bottom, cr.bottom) - Math.min(r.top, cr.top)
          };
        }
      }
      const pad = 8;
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      arrow.style.display = 'block';
      arrow.style.left = (r.left + r.width / 2 - 12) + 'px';
      arrow.style.top = (r.bottom + 12) + 'px';
      arrow.style.borderWidth = '12px 12px 0 12px';
      arrow.style.borderColor = '#00d4b1 transparent transparent transparent';
    }
  } else {
    spot.style.display = 'none';
    arrow.style.display = 'none';
  }

  if (s.require === 'margin' && mr) {
    mr.classList.add('glow');
    const calc = document.getElementById('calcBox');
    if (calc) calc.classList.add('margin-standout');
  } else {
    const calc = document.getElementById('calcBox');
    if (calc) calc.classList.remove('margin-standout');
  }
  checkStepProgress();
}

// ---------- Pyth prices ----------
const PYTH_BTC = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
let pythTimer = null;

async function fetchPythPrice() {
  const m = markets[currentMarket];
  const symbol = m?.binance || 'BTCUSDT';
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error('binance');
    const data = await res.json();
    const price = Number(data.price);
    if (price > 0) {
      if (m) m.price = price;
      applyLivePrice(price);
      return;
    }
  } catch (err) {
    console.warn('Live price failed', err);
  }
}
function applyLivePrice(price) {
  state.price = price;
  updateChart(state.price);
  updateUI();
}
function startPyth() {
  stopPyth();
  fetchPythPrice();
  pythTimer = setInterval(fetchPythPrice, 5000);
}
function stopPyth() {
  if (pythTimer) clearInterval(pythTimer);
  pythTimer = null;
}

function tick() {
  if (document.getElementById('pythMode') && document.getElementById('pythMode').checked) return;
  const drift = (Math.random() - 0.5) * state.price * 0.0004;
  state.price = Math.max(100, state.price + drift);
  updateChart(state.price);
  updateBook();
  updateUI();
}

// ---------- Init ----------
window.closePosition = closePosition;
window.closePartial = closePartial;
window.openCloseModal = openCloseModal;

function init() {
  initChart();
  bindEvents();
  updateUI();
  updateBook();
  setInterval(tick, 1000);
  if (document.getElementById('pythMode') && document.getElementById('pythMode').checked) startPyth();
  // Guide starts only when the user clicks Start Guide or Jump to…
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
