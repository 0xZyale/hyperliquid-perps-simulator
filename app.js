// Hyperliquid-style Perps Simulator
const state = {
  balance: 0,
  positions: [],
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
  'BTC-USDC': { price: 67500, precision: 1 },
  'ETH-USDC': { price: 3450, precision: 2 },
  'HYPE-USDC': { price: 28.5, precision: 3 }
};
let currentMarket = 'BTC-USDC';

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
  const candles = generateCandles(state.price, 120);
  state.candleSeries.setData(candles);
  new ResizeObserver(() => {
    state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }).observe(container);
}

function generateCandles(startPrice, count) {
  const data = [];
  let price = startPrice * 0.97;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i > 0; i--) {
    const time = now - i * 60;
    const open = price;
    const change = (Math.random() - 0.5) * startPrice * 0.004;
    price = Math.max(100, price + change);
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
  if (state.priceLine) {
    state.candleSeries.removePriceLine(state.priceLine);
    state.priceLine = null;
  }
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
  }
}

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
  if (!body) return;
  if (state.positions.length === 0) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--muted);">No open positions yet</td></tr>';
    return;
  }
  body.innerHTML = state.positions.map(p => {
    const pnl = (p.side === 'long' ? (state.price - p.entry) : (p.entry - state.price)) * p.size;
    const roe = (pnl / p.margin) * 100;
    const cls = pnl >= 0 ? 'pos' : 'neg';
    return `<tr>
      <td class="${p.side === 'long' ? 'pos' : 'neg'}">${p.side.toUpperCase()}</td>
      <td>${p.market}</td>
      <td>${p.size.toFixed(4)}</td>
      <td>${p.entry.toFixed(1)}</td>
      <td>${state.price.toFixed(1)}</td>
      <td class="${cls}">${pnl.toFixed(2)} (${roe.toFixed(1)}%)</td>
      <td>${p.liq.toFixed(1)}</td>
      <td>${p.margin.toFixed(2)}</td>
      <td><button class="btn danger small" onclick="closePosition('${p.id}')">Close</button></td>
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
    const maint = 0.005;
    if (state.side === 'long') liq = state.price * (1 - 1 / state.leverage + maint);
    else liq = state.price * (1 + 1 / state.leverage - maint);
  }
  document.getElementById('notional').textContent = notional > 0 ? '$' + notional.toFixed(2) : '—';
  document.getElementById('marginReq').textContent = margin > 0 ? '$' + margin.toFixed(2) : '—';
  document.getElementById('liqPrice').textContent = liq > 0 ? liq.toFixed(1) : '—';
  document.getElementById('pctVal').textContent = document.getElementById('pctSlider').value + '%';
}

function placeOrder() {
  const sizeInput = parseFloat(document.getElementById('sizeInput').value) || 0;
  if (sizeInput <= 0) return alert('Enter a size');
  const unit = document.getElementById('sizeUnit').value;
  let size = sizeInput;
  if (unit === 'USDC') size = sizeInput / state.price;
  const notional = size * state.price;
  const margin = notional / state.leverage;
  if (margin > state.balance) {
    alert(`Insufficient margin. Need $${margin.toFixed(2)}, available $${state.balance.toFixed(2)}`);
    return;
  }
  const existing = state.positions.find(p => p.market === currentMarket && p.side !== state.side);
  if (existing) closePosition(existing.id, true);
  state.balance -= margin;
  const id = Date.now().toString();
  const maint = 0.005;
  const liq = state.side === 'long'
    ? state.price * (1 - 1 / state.leverage + maint)
    : state.price * (1 + 1 / state.leverage - maint);
  state.positions.push({
    id, market: currentMarket, side: state.side, size, entry: state.price, margin, leverage: state.leverage, liq
  });
  document.getElementById('sizeInput').value = '';
  updateUI();
  showToast(`${state.side.toUpperCase()} ${size.toFixed(4)} BTC @ ${state.price.toFixed(1)}`);
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
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#00d4b1; color:#000; padding:10px 16px; border-radius:6px; z-index:9999; font-weight:600;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function bindEvents() {
  document.getElementById('leverageSlider').oninput = (e) => {
    state.leverage = +e.target.value;
    updateUI();
  };
  document.getElementById('isolatedBtn').onclick = () => {
    state.isolated = true;
    document.getElementById('isolatedBtn').classList.add('btn');
    document.getElementById('isolatedBtn').classList.remove('secondary');
    document.getElementById('crossBtn').classList.add('secondary');
    document.getElementById('crossBtn').classList.remove('btn');
  };
  document.getElementById('crossBtn').onclick = () => {
    state.isolated = false;
    document.getElementById('crossBtn').classList.add('btn');
    document.getElementById('crossBtn').classList.remove('secondary');
    document.getElementById('isolatedBtn').classList.add('secondary');
    document.getElementById('isolatedBtn').classList.remove('btn');
  };
  document.getElementById('longBtn').onclick = () => { state.side = 'long'; };
  document.getElementById('shortBtn').onclick = () => { state.side = 'short'; };
  document.getElementById('sizeInput').oninput = calculateOrder;
  document.getElementById('pctSlider').oninput = (e) => {
    const pct = +e.target.value / 100;
    const maxNotional = state.balance * state.leverage;
    const size = (maxNotional * pct) / state.price;
    document.getElementById('sizeInput').value = size > 0 ? size.toFixed(4) : '';
    calculateOrder();
  };
  document.getElementById('placeOrder').onclick = placeOrder;
  document.getElementById('depositHeaderBtn').onclick = () => {
    document.getElementById('depositModal').style.display = 'flex';
  };
  document.getElementById('depositBtn').onclick = () => {
    document.getElementById('depositModal').style.display = 'flex';
  };
  document.getElementById('closeDeposit').onclick = () => {
    document.getElementById('depositModal').style.display = 'none';
  };
  document.querySelectorAll('.amount-btns button').forEach(btn => {
    btn.onclick = () => {
      const amt = +btn.dataset.amount;
      state.balance += amt;
      showToast(`Deposited $${amt} USDC (simulated)`);
      document.getElementById('depositModal').style.display = 'none';
      updateUI();
    };
  });
  document.getElementById('connectBtn').onclick = () => {
    document.getElementById('connectBtn').textContent = '0x7a3…f2c';
    showToast('Wallet connected (simulated)');
  };
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById('tabContent');
      if (tab.dataset.tab === 'positions') {
        content.innerHTML = `
          <table id="positionsTable">
            <thead>
              <tr>
                <th>Side</th><th>Market</th><th>Size</th><th>Entry</th><th>Mark</th><th>PnL (ROE%)</th><th>Liq.</th><th>Margin</th><th></th>
              </tr>
            </thead>
            <tbody id="positionsBody"></tbody>
          </table>`;
        renderPositions();
      } else if (tab.dataset.tab === 'balances') {
        content.innerHTML = `<table>
          <tr><th>Coin</th><th>Total</th><th>Available</th><th>USD Value</th></tr>
          <tr><td>USDC</td><td>${state.balance.toFixed(2)}</td><td>${state.balance.toFixed(2)}</td><td>$${state.balance.toFixed(2)}</td></tr>
        </table>
        <p style="margin-top:12px; color:var(--muted);">Deposited margin available for trading. In the real app this comes from bridging USDC (typically Arbitrum) or other supported assets.</p>`;
      } else if (tab.dataset.tab === 'orders') {
        content.innerHTML = '<p style="padding:16px; color:var(--muted);">No open orders (market orders fill immediately in this simulator)</p>';
      } else {
        content.innerHTML = '<p style="padding:16px; color:var(--muted);">Trade history will appear here after you close positions</p>';
      }
    };
  });
  document.getElementById('guideBtn').onclick = startGuide;
  document.getElementById('guideNext').onclick = nextGuide;
  document.getElementById('guideBack').onclick = prevGuide;
  document.getElementById('guideSkip').onclick = closeGuide;
}

const guideSteps = [
  {
    title: 'Welcome to the Simulator',
    text: 'This is a safe practice version of a Hyperliquid-style perps interface. Nothing here uses real money or connects to a blockchain. Use the guide to learn margin deposits, leverage, notional size, and how positions appear on the chart and in the Positions tab.',
    target: null
  },
  {
    title: '1. Deposit Margin',
    text: 'On the real Hyperliquid app the Deposit button sits in the top-right header (and also near the bottom of the order panel). Click Deposit to simulate bridging USDC (usually from Arbitrum). The amount becomes your available margin.',
    target: '#depositHeaderBtn',
    preview: 'Deposit'
  },
  {
    title: '2. Leverage & Notional',
    text: 'Use the leverage slider at the top of the order panel. Notional size = Margin used × Leverage. Higher leverage = less margin for the same size but a closer liquidation price. Watch Margin Required and Liq. Price update as you move the slider or change size.',
    target: '#leverageSlider',
    preview: 'Leverage slider'
  },
  {
    title: '3. Size & Place a Long',
    text: 'Enter a size (or drag the % Margin slider). Then click Buy / Long and Place Order. The position will appear in the Positions table and as a dashed entry-price line on the chart. PnL updates live as the simulated price moves.',
    target: '#longBtn',
    preview: 'Buy / Long'
  },
  {
    title: '4. Positions Table',
    text: 'Open positions show up here with size, entry, mark, live PnL (ROE%), liquidation price, and margin. Click Close on a row to exit and realize PnL back into your balance.',
    target: '.bottom',
    preview: 'Positions'
  },
  {
    title: 'You’re Ready',
    text: 'Core flow: Deposit → set leverage → size the trade → Place Order → see it on the chart & Positions tab. On the real Hyperliquid the same ideas apply (plus funding, order-book depth, wallet signatures, and real liquidation risk). Happy practicing!',
    target: null
  }
];

function startGuide() {
  state.guideStep = 0;
  document.getElementById('guideOverlay').classList.add('active');
  showGuideStep();
}
function closeGuide() {
  document.getElementById('guideOverlay').classList.remove('active');
  document.getElementById('spotlight').style.display = 'none';
  document.getElementById('guideArrow').style.display = 'none';
}
function nextGuide() {
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
function showGuideStep() {
  const s = guideSteps[state.guideStep];
  document.getElementById('guideTitle').textContent = s.title;
  document.getElementById('guideText').textContent = s.text;
  document.getElementById('guideNext').textContent = state.guideStep === guideSteps.length - 1 ? 'Finish' : 'Next';
  document.getElementById('guideBack').style.visibility = state.guideStep === 0 ? 'hidden' : 'visible';
  const preview = document.getElementById('guidePreview');
  preview.innerHTML = '';
  if (s.preview) {
    const btn = document.createElement('button');
    btn.className = 'btn preview-btn';
    btn.textContent = s.preview;
    preview.appendChild(btn);
    preview.appendChild(document.createTextNode(' ← look for this'));
  }
  const spot = document.getElementById('spotlight');
  const arrow = document.getElementById('guideArrow');
  if (s.target) {
    const el = document.querySelector(s.target);
    if (el) {
      const r = el.getBoundingClientRect();
      const pad = 6;
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      arrow.style.display = 'block';
      const midX = r.left + r.width / 2;
      arrow.style.left = (midX - 8) + 'px';
      arrow.style.top = (r.bottom + 8) + 'px';
      arrow.style.borderWidth = '8px 8px 0 8px';
      arrow.style.borderColor = '#00d4b1 transparent transparent transparent';
    }
  } else {
    spot.style.display = 'none';
    arrow.style.display = 'none';
  }
}

function tick() {
  const drift = (Math.random() - 0.5) * state.price * 0.0004;
  state.price = Math.max(100, state.price + drift);
  updateChart(state.price);
  updateBook();
  updateUI();
}

window.closePosition = closePosition;
function init() {
  initChart();
  bindEvents();
  updateUI();
  updateBook();
  setInterval(tick, 1000);
  setTimeout(startGuide, 800);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
