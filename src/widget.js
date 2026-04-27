// widget.js — renderer for the main widget

// ── State ─────────────────────────────────────────────────────────────────
let cfg              = {};
let chart            = null;
let chartInitialized = false;  // lazy-init: chart only created on first history view
let chartRange       = '8h';
let latestHistory    = [];
let sessionResetsAt  = null;
let weeklyResetsAt   = null;
let bannerTimer      = null;
let viewMode         = 'bars'; // always starts as 'bars' on every launch

// ── DOM refs ──────────────────────────────────────────────────────────────
const sFill       = document.getElementById('s-fill');
const wFill       = document.getElementById('w-fill');
const eFill       = document.getElementById('e-fill');
const sPct        = document.getElementById('s-pct');
const wPct        = document.getElementById('w-pct');
const ePct        = document.getElementById('e-pct');
const sReset      = document.getElementById('s-reset');
const wReset      = document.getElementById('w-reset');
const eCredits    = document.getElementById('e-credits');
const barExtra    = document.getElementById('bar-extra');
const limitBanner = document.getElementById('limit-banner');
const statusEl    = document.getElementById('status');
const timeEl      = document.getElementById('last-update');
const ctxMenu     = document.getElementById('ctx');
const ctxBackdrop = document.getElementById('ctx-backdrop');

// View toggle elements
const viewBarsPanel    = document.getElementById('view-bars');
const viewHistoryPanel = document.getElementById('view-history');
const iconCalendar     = document.getElementById('icon-calendar');
const iconMeter        = document.getElementById('icon-meter');
const btnViewToggle    = document.getElementById('btn-view-toggle');

// ─────────────────────────────────────────────────────────────────────────
//  *** CRITICAL FIX ***
//  Register IPC listeners HERE at the module level — synchronously —
//  BEFORE init() is called and BEFORE any await suspends execution.
//
//  The old code registered these inside init() after two awaits, creating
//  a race condition: did-finish-load fired, startPolling() ran, and
//  poll() sent usage-update before the listener was ever registered.
//  The widget stayed stuck at "Starting…" until the next 60-second poll.
//
//  Placing them here guarantees they're wired up before did-finish-load
//  can fire in the main process.
// ─────────────────────────────────────────────────────────────────────────
window.claude.onUsageUpdate(handleUpdate);
window.claude.onLoginSuccess(() => setStatus('Connected ✓', 'ok'));

// ── Lazy chart initialiser ────────────────────────────────────────────────
// Called only after the history panel has display:flex and the browser has
// computed layout (guaranteed by the double-rAF in fadeToHistory).
// This means Chart.js always gets the real canvas dimensions.
function ensureChart() {
  if (chartInitialized) return;
  try {
    initChart();
    chartInitialized = true;
  } catch (e) {
    console.error('[widget] Chart init failed — is chart.umd.min.js in src/?', e);
    // Show a visible error in the chart area so it's not just blank
    const wrap = document.querySelector('.chart-wrap');
    if (wrap) {
      wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:11px;color:#6e6e6e;">Chart unavailable — run setup.bat again</div>';
    }
  }
}

// ── JS-controlled fade between the two view panels ────────────────────────
//
// Why not pure CSS opacity transition:
//   • With opacity:0 panels still occupy layout. Chart.js can still measure
//     wrong dimensions under some Chromium/asar combinations.
//   • transitionend is unreliable when OS "reduce motion" is enabled.
//
// This approach:
//   1. Fade OUT the current panel via inline style (no class change, no flicker)
//   2. Set the incoming panel to display:flex (removes 'v-hidden')
//   3. Wait TWO requestAnimationFrames — the browser must process layout
//      and produce at least one painted frame so canvas dimensions are real
//   4. Initialize / render chart (canvas is now correctly sized)
//   5. Fade IN the incoming panel
//   6. After fade, set old panel to display:none (add 'v-hidden')
//
function fadeToPanel(outPanel, inPanel, onLayout) {
  // Step 1 — fade out the current panel
  outPanel.style.transition = 'opacity 0.18s ease';
  outPanel.style.opacity    = '0';

  // Step 2 — bring the incoming panel into layout (but still invisible)
  inPanel.classList.remove('v-hidden');
  inPanel.style.opacity    = '0';
  inPanel.style.transition = '';

  // Step 3 — double-rAF: guarantees browser has computed layout and painted
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Step 4 — callback runs with the panel in the DOM and correctly sized
      onLayout();

      // Step 5 — fade in
      inPanel.style.transition = 'opacity 0.18s ease';
      inPanel.style.opacity    = '1';

      // Step 6 — after the incoming fade is done, hide the old panel
      setTimeout(() => {
        outPanel.classList.add('v-hidden');
        outPanel.style.opacity    = '';
        outPanel.style.transition = '';
        inPanel.style.transition  = '';
      }, 200);
    });
  });
}

// ── View toggle ───────────────────────────────────────────────────────────
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;

  const toHistory = (mode === 'history');

  // Swap the icon and tooltip
  iconCalendar.classList.toggle('v-gone', toHistory);
  iconMeter.classList.toggle('v-gone',   !toHistory);
  btnViewToggle.title = toHistory ? 'Show Usage Bars' : 'Show Usage History';

  if (toHistory) {
    fadeToPanel(viewBarsPanel, viewHistoryPanel, () => {
      if (chartRange === 'day') {
        try { renderDailyView(latestHistory, weeklyResetsAt); } catch (_) {}
      } else {
        // Canvas is now display:flex, layout computed, dimensions are real
        ensureChart();
        if (chart) {
          chart.resize();
          renderChart(latestHistory, chartRange);
        }
      }
    });
  } else {
    fadeToPanel(viewHistoryPanel, viewBarsPanel, () => {
      // Nothing special needed when switching back to bars
    });
  }
}

btnViewToggle.addEventListener('click', () => {
  setViewMode(viewMode === 'bars' ? 'history' : 'bars');
});

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  cfg        = await window.claude.getConfig();
  chartRange = cfg.history_view || '8h';

  document.querySelectorAll('.tog').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === chartRange);
  });

  // Set up initial visibility of chart vs. daily subviews inside the history panel.
  // The history panel itself starts hidden (v-hidden); this just ensures the correct
  // subview is ready for when the user first opens it.
  const chartWrapEl = document.getElementById('chart-wrap');
  const legendEl    = document.getElementById('graph-legend');
  const dailyWrapEl = document.getElementById('daily-wrap');
  if (chartRange === 'day') {
    chartWrapEl.classList.add('v-gone');
    legendEl.classList.add('v-gone');
    dailyWrapEl.classList.remove('v-gone');
  }

  updateCtxChecks();

  const hist = await window.claude.getHistory();
  latestHistory = hist;
  // NOTE: chart is NOT initialized here. It is lazy-initialized the first time
  // the user opens the history panel (setViewMode → ensureChart), guaranteeing
  // Chart.js measures the canvas while it is fully visible and correctly sized.

  // Belt-and-suspenders: request a fresh poll now that init is complete.
  window.claude.manualRefresh();
}

// ── Update handler ────────────────────────────────────────────────────────
function handleUpdate(d) {
  if (d.status === 'no_session') {
    setStatus('Not logged in — open Settings to connect', 'warn');
    resetBars();
    return;
  }
  if (d.status === 'connecting') {
    setStatus('Connecting…');
    return;
  }
  if (d.status === 'error') {
    const msg = d.message || 'Unknown error';
    // Network errors are transient — the poll interval will retry automatically.
    // Session-expired errors need user action, so don't add the retry hint there.
    const needsAction = /expired|log in/i.test(msg);
    setStatus(needsAction ? msg : `${msg} — retrying…`, 'error');
    resetBars();
    return;
  }

  const {
    s, w, resets, weeklyResets, extraUsage,
    sessionResetsAt: sRA, weeklyResetsAt: wRA, updatedAt, history,
  } = d;
  latestHistory   = history || latestHistory;
  sessionResetsAt = sRA || sessionResetsAt;
  weeklyResetsAt  = wRA || weeklyResetsAt;

  setBar('s', s);
  setBar('w', w);
  updateExtraUsage(extraUsage);
  updateLimitBanner(s, w);

  sReset.textContent = resets       || '';
  wReset.textContent = weeklyResets || '';

  const bothNull = s === null && w === null;
  setStatus(
    bothNull ? 'Connected — data format unknown' : 'Connected ✓',
    bothNull ? 'warn' : 'ok',
  );
  timeEl.textContent = updatedAt ? `↻ ${updatedAt}` : '';

  if (chartRange === 'day' && viewMode === 'history') {
    try { renderDailyView(latestHistory, weeklyResetsAt); } catch (_) {}
  } else {
    try { renderChart(latestHistory, chartRange); } catch (_) {}
  }
}

// ── Bar helpers ───────────────────────────────────────────────────────────
function setBar(which, frac) {
  const fill = which === 's' ? sFill : wFill;
  const pct  = which === 's' ? sPct  : wPct;

  if (frac === null || frac === undefined) {
    fill.style.width = '0%';
    fill.className   = 'fill';
    pct.textContent  = '—';
    pct.style.color  = '';
    return;
  }

  const pctVal = Math.round(frac * 100);
  fill.style.width = `${Math.min(100, Math.max(0, pctVal))}%`;
  fill.className   = 'fill' + (pctVal >= 90 ? ' danger' : pctVal >= 75 ? ' warn' : pctVal >= 1 ? ' normal' : '');
  pct.textContent  = `${pctVal}%`;
  pct.style.color  = pctVal >= 90 ? 'var(--danger)' : pctVal >= 75 ? 'var(--warn)' : '';
}

// ── Extra usage bar ───────────────────────────────────────────────────────
function updateExtraUsage(extra) {
  if (!extra) {
    barExtra.classList.add('hidden');
    window.claude.resizeForBars(230);
    return;
  }

  // ── Feature disabled in Claude settings ──────────────────────────────────
  if (extra.isOff) {
    barExtra.classList.remove('hidden');
    eFill.className      = 'fill';
    eFill.style.width    = '0%';
    ePct.textContent     = 'OFF';
    ePct.style.color     = 'var(--muted)';
    ePct.style.fontSize  = '';
    eCredits.textContent = 'Extra usage currently turned off.';
    window.claude.resizeForBars(280);
    return;
  }

  // ── Unlimited spend limit ────────────────────────────────────────────────
  if (extra.isUnlimited) {
    barExtra.classList.remove('hidden');
    eFill.className      = 'fill unlimited';
    eFill.style.width    = '100%';
    ePct.textContent     = '∞';
    ePct.style.color     = '';
    ePct.style.fontSize  = '20px';
    eCredits.textContent = 'Unlimited Spend Limit Enabled';
    window.claude.resizeForBars(280);
    return;
  }

  if (extra.utilization === null || extra.utilization === undefined) {
    barExtra.classList.add('hidden');
    window.claude.resizeForBars(230);
    return;
  }

  barExtra.classList.remove('hidden');
  window.claude.resizeForBars(280);

  const pctVal = Math.round(extra.utilization * 100);
  eFill.style.width   = `${Math.min(100, pctVal)}%`;
  eFill.className     = 'fill' + (pctVal >= 90 ? ' danger' : pctVal >= 75 ? ' warn' : pctVal >= 1 ? ' normal' : '');
  ePct.textContent    = `${pctVal}%`;
  ePct.style.fontSize = '';   // clear any override set by unlimited/off mode
  ePct.style.color    = pctVal >= 90 ? 'var(--danger)' : pctVal >= 75 ? 'var(--warn)' : '';

  if (extra.used !== null && extra.used !== undefined &&
      extra.limit !== null && extra.limit !== undefined) {
    try {
      const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: extra.currency || 'USD', minimumFractionDigits: 2,
      });
      eCredits.textContent = `${fmt.format(extra.used)} / ${fmt.format(extra.limit)}`;
    } catch (_) {
      eCredits.textContent = `${extra.used} / ${extra.limit} ${extra.currency}`;
    }
  } else {
    eCredits.textContent = '';
  }
}

// ── Limit-reached banner ──────────────────────────────────────────────────
function countdownStr(isoTs) {
  if (!isoTs) return '';
  const diffMs = new Date(isoTs) - Date.now();
  if (diffMs <= 0) return 'soon';
  const totalMins = Math.round(diffMs / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderLimitBanner(sMaxed, wMaxed) {
  if (!sMaxed && !wMaxed) {
    limitBanner.classList.add('hidden');
    limitBanner.textContent = '';
    return;
  }
  const lines = [];
  if (sMaxed) {
    const cd = countdownStr(sessionResetsAt);
    lines.push(`⚠  Session limit reached${cd ? ' — resets in ' + cd : ''}`);
  }
  if (wMaxed) {
    const cd = countdownStr(weeklyResetsAt);
    lines.push(`⚠  Weekly limit reached${cd ? ' — resets in ' + cd : ''}`);
  }
  limitBanner.textContent = lines.join('   •   ');
  limitBanner.classList.remove('hidden');
}

function updateLimitBanner(s, w) {
  const sMaxed = s !== null && s >= 1.0;
  const wMaxed = w !== null && w >= 1.0;
  renderLimitBanner(sMaxed, wMaxed);
  if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
  if (sMaxed || wMaxed) {
    bannerTimer = setInterval(() => renderLimitBanner(sMaxed, wMaxed), 30_000);
  }
}

function resetBars() {
  setBar('s', null);
  setBar('w', null);
  updateExtraUsage(null);
  limitBanner.classList.add('hidden');
  sReset.textContent = '';
  wReset.textContent = '';
  timeEl.textContent = '';
  if (chartRange === 'day') {
    try { renderDailyView([], weeklyResetsAt); } catch (_) {}
  } else {
    try { renderChart([], chartRange); } catch (_) {}
  }
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className   = 'status' + (type ? ` ${type}` : '');
}

// ── Chart ─────────────────────────────────────────────────────────────────
function initChart() {
  const ctx = document.getElementById('chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Session', data: [], fill: true, spanGaps: true,
          borderColor: '#3a88e3', backgroundColor: 'rgba(58,136,227,0.10)',
          borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 4, tension: 0.3,
        },
        {
          label: 'Weekly', data: [], fill: true, spanGaps: true,
          borderColor: '#c97248', backgroundColor: 'rgba(201,114,72,0.08)',
          borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 4, tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#252525', borderColor: '#3a3a3a', borderWidth: 1,
          titleColor: '#aaa', bodyColor: '#eee', padding: 8,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.raw * 100)}%` },
        },
      },
      scales: {
        x: {
          grid:   { color: 'rgba(255,255,255,0.04)' },
          ticks:  { color: '#555', font: { size: 9 }, maxTicksLimit: 6, maxRotation: 0 },
          border: { color: '#2d2d2d' },
        },
        y: {
          min: 0, max: 1,
          grid:   { color: 'rgba(255,255,255,0.04)' },
          ticks:  { color: '#555', font: { size: 9 }, maxTicksLimit: 5, callback: v => `${Math.round(v * 100)}%` },
          border: { color: '#2d2d2d' },
        },
      },
    },
  });
}

function renderChart(history, range) {
  if (!chart || !Array.isArray(history)) return;
  const now = Date.now();

  // Past 8 hours — rolling 1-hour buckets going back from now.
  // spanGaps:true on each dataset draws a thin connecting line across empty
  // buckets instead of leaving a confusing visual gap.
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const bucketEnd   = now - i * 3_600_000;
    const bucketStart = bucketEnd - 3_600_000;
    const pts  = history.filter(h => h.ts >= bucketStart && h.ts < bucketEnd);
    const last = pts[pts.length - 1];
    const label = new Date(bucketEnd).toLocaleTimeString([], { hour: 'numeric', hour12: true });
    buckets.push({ label, s: last?.s ?? null, w: last?.w ?? null });
  }
  chart.options.scales.x.ticks.maxTicksLimit = 9;

  chart.data.labels           = buckets.map(b => b.label);
  chart.data.datasets[0].data = buckets.map(b => b.s);
  chart.data.datasets[1].data = buckets.map(b => b.w);

  const hasAnyData = buckets.some(b => b.s !== null || b.w !== null);
  const emptyEl = document.getElementById('chart-empty');
  if (emptyEl) emptyEl.classList.toggle('visible', !hasAnyData);

  chart.update('none');
}

// ── Daily breakdown view ──────────────────────────────────────────────────
//
// Shows 7 horizontal bars — one per day of the current billing week — each
// representing the incremental weekly-usage fraction consumed that day.
// Days are anchored to the actual weekly reset time (not calendar midnight).
//
// Bar widths use ABSOLUTE scaling: a bar showing 4% is 4% of the track width,
// not scaled to the busiest day. This prevents a light-usage day from looking
// full. A "Remaining" bar at the bottom counts down from 100% as the week
// progresses, giving instant context for how much allowance is left.
//
function renderDailyView(history, weeklyResetsAtISO) {
  const wrap = document.getElementById('daily-wrap');
  if (!wrap) return;

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (!weeklyResetsAtISO || !Array.isArray(history) || history.length === 0) {
    wrap.innerHTML = '<div class="daily-empty">No data yet — history will appear as you use Claude</div>';
    return;
  }

  const resetMs   = new Date(weeklyResetsAtISO).getTime();
  const weekStart = resetMs - 7 * 86_400_000;
  const now       = Date.now();

  // Build one entry per day
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = weekStart + i * 86_400_000;
    const dayEnd   = dayStart  + 86_400_000;
    const isToday  = dayStart <= now && now < dayEnd;
    const isFuture = dayStart > now;
    const label    = DAY_NAMES[new Date(dayStart + 43_200_000).getDay()];

    const pts  = history.filter(h => h.ts >= dayStart && h.ts < dayEnd && h.w !== null);
    const maxW = pts.length > 0 ? Math.max(...pts.map(h => h.w)) : null;

    days.push({ label, isToday, isFuture, maxW });
  }

  // Incremental usage per day = increase in weekly fraction that day
  const rows = days.map((day, i) => {
    if (day.isFuture) return { ...day, delta: null };
    const prevMax = i === 0 ? 0 : (days[i - 1].maxW ?? 0);
    const curMax  = day.maxW ?? prevMax;
    return { ...day, delta: Math.max(0, curMax - prevMax) };
  });

  // Total used this week = highest weekly fraction seen across all days
  const weeklyUsed = Math.max(...days.map(d => d.maxW ?? 0), 0);
  const remaining  = Math.max(0, 1 - weeklyUsed);

  const rowsHtml = rows.map(row => {
    // Absolute scaling: bar width = actual % of weekly allowance used that day
    const barPct  = row.delta !== null ? Math.min(100, Math.round(row.delta * 100)) : 0;
    const pctText = row.isFuture ? '—' : `${Math.round((row.delta ?? 0) * 100)}%`;

    const todayCls  = row.isToday  ? ' today'  : '';
    const futureCls = row.isFuture ? ' future' : '';

    return `<div class="day-row">
        <span class="day-label${todayCls}${futureCls}">${row.label}</span>
        <div class="day-bar-track">
          <div class="day-bar-fill${todayCls}${futureCls}" style="width:${barPct}%"></div>
        </div>
        <span class="day-pct${todayCls}${futureCls}">${pctText}</span>
      </div>`;
  }).join('');

  const remainingHtml = `<div class="day-divider"></div>
    <div class="day-row">
      <span class="day-label">Left</span>
      <div class="day-bar-track">
        <div class="day-bar-fill remaining" style="width:${Math.round(remaining * 100)}%"></div>
      </div>
      <span class="day-pct">${Math.round(remaining * 100)}%</span>
    </div>`;

  wrap.innerHTML = rowsHtml + remainingHtml;
}

// ── Context menu ──────────────────────────────────────────────────────────
function hideCtx() {
  ctxMenu.classList.add('hidden');
  ctxBackdrop.classList.add('hidden');
}

function showCtx(x, y) {
  ctxMenu.classList.remove('hidden');
  ctxBackdrop.classList.remove('hidden');
  const clampedX = Math.min(x, window.innerWidth  - ctxMenu.offsetWidth  - 8);
  const clampedY = Math.min(y, window.innerHeight - ctxMenu.offsetHeight - 8);
  ctxMenu.style.left = `${clampedX}px`;
  ctxMenu.style.top  = `${clampedY}px`;
}

// ── Event listeners ───────────────────────────────────────────────────────
document.querySelectorAll('.tog').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tog').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartRange = btn.dataset.range;
    window.claude.saveConfig({ history_view: chartRange });

    const chartWrapEl = document.getElementById('chart-wrap');
    const legendEl    = document.getElementById('graph-legend');
    const dailyWrapEl = document.getElementById('daily-wrap');

    if (chartRange === 'day') {
      chartWrapEl.classList.add('v-gone');
      legendEl.classList.add('v-gone');
      dailyWrapEl.classList.remove('v-gone');
      try { renderDailyView(latestHistory, weeklyResetsAt); } catch (_) {}
    } else {
      chartWrapEl.classList.remove('v-gone');
      legendEl.classList.remove('v-gone');
      dailyWrapEl.classList.add('v-gone');
      try { renderChart(latestHistory, chartRange); } catch (_) {}
    }
  });
});

document.getElementById('btn-settings').addEventListener('click', () => window.claude.openSettings());
document.getElementById('btn-hide').addEventListener('click',     () => window.claude.hideWidget());

// ── Clickable refresh timestamp ───────────────────────────────────────────
// Clicking the "↻ HH:MM" timestamp in the footer triggers an immediate
// refresh — same as "Refresh Now" in the tray context menu.
timeEl.addEventListener('click', () => {
  window.claude.manualRefresh();
  setStatus('Refreshing…');
});

window.addEventListener('contextmenu', e => {
  e.preventDefault();
  showCtx(e.clientX, e.clientY);
});

// Close menu when clicking the backdrop (covers whole window incl. drag region)
ctxBackdrop.addEventListener('click', hideCtx);

window.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });

// Close menu when the window loses focus (e.g. clicking the desktop)
window.claude.onHideCtx(() => hideCtx());

ctxMenu.addEventListener('click', async e => {
  const item = e.target.closest('.ctx-item');
  if (!item) return;
  hideCtx();
  switch (item.dataset.action) {
    case 'refresh':
      window.claude.manualRefresh();
      setStatus('Refreshing…');
      break;
    case 'check-updates':
      window.claude.checkForUpdates();
      break;
    case 'settings':
      window.claude.openSettings();
      break;
    case 'hide':
      window.claude.hideWidget();
      break;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
init();
