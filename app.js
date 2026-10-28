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
  'BTC-USDC': { price: 67500, precision: 1 },
  'ETH-USDC': { price: 3450, precision: 2 },
  'HYPE-USDC': { price: 28.5, precision: 3 }
};
let currentMarket = 'BTC-USDC';

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
  }).observe(container);

  container.addEventListener('click', () => {
    const pos = state.positions.find(p => p.market === currentMarket);
    if (pos && document.getElementById('guideOverlay').classList.contains('active')) {
      const step = guideSteps[state.guideStep];
      if (step && step.require === 'full') {
        closePosition(pos.id);
      }
    }
  });
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
      <td>
        <button class="btn danger small" onclick="closePartial('${p.id}', 0.5)" data-tooltip="Close half of this position. Returns half the margin + any PnL.">Close 50%</button>
        <button class="btn danger small" onclick="closePosition('${p.id}')" data-tooltip="Close the entire position.">Close All</button>
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
  if (tp > 0) {
    const pct = ((tp - entry) / entry) * 100;
    const marginPct = pct * state.leverage;
    document.getElementById('tpPct').textContent = pct.toFixed(2) + '% price / ' + marginPct.toFixed(1) + '% margin';
  }
  if (sl > 0) {
    const pct = ((sl - entry) / entry) * 100;
    const marginPct = pct * state.leverage;
    document.getElementById('slPct').textContent = pct.toFixed(2) + '% price / ' + marginPct.toFixed(1) + '% margin';
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
    id, market: currentMarket, side: state.side, size, entry: state.price, margin, leverage: state.leverage, liq
  });

  document.getElementById('sizeInput').value = '';
  updateUI();
  showToast(`${state.side.toUpperCase()} ${size.toFixed(4)} BTC @ ${state.price.toFixed(1)}`);
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
  document.getElementById('leverageSlider').oninput = (e) => {
    state.leverage = +e.target.value;
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

  document.getElementById('longBtn').onclick = () => { state.side = 'long'; };
  document.getElementById('shortBtn').onclick = () => { state.side = 'short'; };

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

  document.getElementById('placeOrder').onclick = placeOrder;

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
  document.getElementById('guideBtn').onclick = startGuide;
  document.getElementById('hypurrCat').onclick = () => {
    if (!document.getElementById('guideOverlay').classList.contains('active')) {
      const tip = hypurrTips[Math.floor(Math.random() * hypurrTips.length)];
      hypurrSay(tip, 4000);
    } else {
      hypurrSay(guideSteps[state.guideStep]?.cat || "Keep going!", 0);
    }
  };
  document.getElementById('guideNext').onclick = nextGuide;
  document.getElementById('guideBack').onclick = prevGuide;
  document.getElementById('guideSkip').onclick = closeGuide;
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
      hypurrSay(`Bridge done! $${amount} is now available margin.`, 3000);
      setTimeout(() => item.remove(), 3000);
    }
  }, 1000);
}

// Hypurr tips (random when clicked outside guide)
const hypurrTips = [
  "Higher leverage multiplies both gains and losses. Size down when you crank it up.",
  "Isolated only risks the margin on that one trade. Cross shares everything.",
  "A tight stop-loss is your best friend. Define the max loss before you enter.",
  "Partial closes let you take some profit while letting the rest run.",
  "On the real app, click the position line on the chart to close fully.",
  "Bridging takes time for security. Watch the notification — funds arrive after confirmation.",
  "Margin required = notional ÷ leverage. Slide the % bar to commit what you want.",
  "Trading is about minimizing losses and maximizing gains. Risk management first."
];

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
      bubble.textContent = "Click me for a tip, or hit Start Guide to practice again!";
    }, duration);
  }
}
const guideSteps = [
  {
    title: 'Welcome',
    text: 'Hey, I’m Hypurr. This is a safe practice version of the Hyperliquid perps UI. I’ll walk you through deposits, leverage, margin mode, and closing positions.',
    target: null,
    cat: 'Meow. Ready when you are.'
  },
  {
    title: '1. Deposit Margin',
    text: 'Click Deposit in the top-right (same spot as the real app). Bridging takes ~10s for security. Watch the notification circle.',
    target: '#depositHeaderBtn',
    preview: 'Deposit',
    cat: 'Deposit lives top-right. Bridge takes a moment.'
  },
  {
    title: '2. Set Leverage',
    text: 'Slide the leverage bar. Notional = margin × leverage (e.g. $100 margin at 10x = $1,000 position). Higher leverage = less margin needed but closer liquidation. Move the slider — Next unlocks only after you change it.',
    target: '#leverageSlider',
    preview: 'Leverage',
    require: 'leverage',
    cat: 'Higher leverage = less margin, closer liq. Slide it to see the difference.'
  },
  {
    title: '3. Commit Margin',
    text: 'Drag the % Margin slider. The Margin Required number will glow so you see what you’re committing.',
    target: '#pctSlider',
    preview: '% Margin',
    require: 'margin',
    cat: 'Commit some margin. Watch the glowing number.'
  },
  {
    title: '4. Cross vs Isolated',
    text: 'Cross uses your whole balance as shared margin (riskier if other trades lose). Isolated only risks the margin on this single trade. Click the other mode button — Next unlocks once you switch.',
    target: '#modeToggle',
    preview: 'Cross / Isolated',
    require: 'mode',
    cat: 'Flip Cross ↔ Isolated. Feel the difference in risk.'
  },
  {
    title: '5. Demo Position',
    text: 'I’ve opened a fixed 0.05 BTC long for practice. You’ll close part of it from the Positions tab, then the rest from the chart.',
    target: '.bottom',
    preview: 'Positions',
    onEnter: 'seed',
    cat: 'Demo long is open. Let’s close it in two ways.'
  },
  {
    title: '6. Partial Close (Positions tab)',
    text: 'In the Positions table, click “Close 50%” on the demo row. That reduces size and returns half the margin plus any PnL. Next unlocks after you do it.',
    target: '.bottom',
    preview: 'Close 50%',
    require: 'partial',
    cat: 'Close half from the table first. Easy partials.'
  },
  {
    title: '7. Full Close (from Chart)',
    text: 'Click anywhere on the chart while this step is active. That closes the remaining position (same idea as clicking the entry line on the real app).',
    target: '#chart',
    preview: 'Chart click',
    require: 'full',
    cat: 'Now click the chart to close the rest. On real HL you click the line.'
  },
  {
    title: '8. Take Profit & Stop Loss',
    text: 'Check “Take Profit / Stop Loss”. Set a TP above entry and a tight SL below. The chart shows arrows where price must go to hit each. Keep the SL price % small — that limits the loss. Higher leverage multiplies that price % into a larger % of your margin (e.g. 1% price move at 10x = 10% of margin). Trading is about minimizing losses while letting winners run.',
    target: '#tpslBox',
    preview: 'TP / SL',
    require: 'tpsl',
    cat: 'Tight SL protects you. Leverage multiplies the pain if you don’t.',
    onEnter: 'tpslDemo'
  },
  {
    title: 'You’re Ready',
    text: 'You practiced: Deposit → leverage → margin → Cross/Isolated → partial close → full close → TP/SL. Core idea: define risk first (tight SL), size so a stop doesn’t hurt, and let gains run. Same on the real Hyperliquid app.',
    target: null,
    cat: 'Minimize losses, maximize gains. You’re ready.'
  }
];

let leverageStart = 10;
let modeStart = true;
let partialDone = false;
let fullDone = false;

function startGuide() {
  state.guideStep = 0;
  leverageStart = +document.getElementById('leverageSlider').value;
  modeStart = state.isolated;
  partialDone = false;
  fullDone = false;
  document.getElementById('guideOverlay').classList.add('active');
  showGuideStep();
}
function closeGuide() {
  document.getElementById('guideOverlay').classList.remove('active');
  document.getElementById('spotlight').style.display = 'none';
  document.getElementById('guideArrow').style.display = 'none';
  const mr = document.getElementById('marginReq');
  if (mr) mr.classList.remove('glow');
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
function checkStepProgress() {
  const s = guideSteps[state.guideStep];
  const nextBtn = document.getElementById('guideNext');
  if (!s || !s.require) {
    nextBtn.disabled = false;
    nextBtn.style.opacity = '1';
    nextBtn.textContent = state.guideStep === guideSteps.length - 1 ? 'Finish' : 'Next';
    return;
  }
  let ok = false;
  if (s.require === 'leverage') {
    ok = +document.getElementById('leverageSlider').value !== leverageStart;
  } else if (s.require === 'margin') {
    ok = +document.getElementById('pctSlider').value > 0;
  } else if (s.require === 'mode') {
    ok = state.isolated !== modeStart;
  } else if (s.require === 'partial') {
    ok = partialDone || state.positions.every(p => p.size < 0.04);
  } else if (s.require === 'full') {
    ok = fullDone || state.positions.length === 0;
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
function showGuideStep() {
  const s = guideSteps[state.guideStep];
  document.getElementById('guideTitle').textContent = s.title;
  document.getElementById('guideText').textContent = s.text;
  document.getElementById('guideBack').style.visibility = state.guideStep === 0 ? 'hidden' : 'visible';
  hypurrSay(s.cat || s.text);

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
  const mr = document.getElementById('marginReq');
  if (mr) mr.classList.remove('glow');

  if (s.onEnter === 'seed') seedDemoPosition();
  if (s.onEnter === 'tpslDemo') {
    document.getElementById('tpslToggle').checked = true;
    document.getElementById('tpslInputs').style.display = 'block';
    if (!document.getElementById('tpPrice').value) {
      document.getElementById('tpPrice').value = (state.price * 1.015).toFixed(1);
      document.getElementById('slPrice').value = (state.price * 0.995).toFixed(1);
    }
    updateTpslPct();
  }

  if (s.target) {
    const el = document.querySelector(s.target);
    if (el) {
      const r = el.getBoundingClientRect();
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

  if (s.require === 'margin' && mr) mr.classList.add('glow');
  checkStepProgress();
}

// ---------- Price Simulation ----------
function tick() {
  const drift = (Math.random() - 0.5) * state.price * 0.0004;
  state.price = Math.max(100, state.price + drift);
  updateChart(state.price);
  updateBook();
  updateUI();
}

// ---------- Init ----------
window.closePosition = closePosition;
window.closePartial = closePartial;

function init() {
  initChart();
  bindEvents();
  updateUI();
  updateBook();
  setInterval(tick, 1000);
  // Auto-start guide after a short delay
  setTimeout(startGuide, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
