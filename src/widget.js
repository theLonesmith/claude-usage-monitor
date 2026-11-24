// widget.js — renderer for the main widget

// ── State ─────────────────────────────────────────────────────────────────
let cfg              = {};
let chart            = null;
let chartInitialized = false;  // lazy-init: chart only created on first history view
let chartRange       = '8h';
let latestHistory    = [];
let sessionResetsAt  = null;
let weeklyResetsAt   = null;
let fableResetsAt    = null;
let bannerTimer      = null;
let viewMode         = 'bars'; // always starts as 'bars' on every launch
let lastData         = null;   // last successful usage payload — re-rendered when toggles change

// ── DOM refs ──────────────────────────────────────────────────────────────
const sFill       = document.getElementById('s-fill');
const wFill       = document.getElementById('w-fill');
const eFill       = document.getElementById('e-fill');
const fFill       = document.getElementById('f-fill');
const sPct        = document.getElementById('s-pct');
const wPct        = document.getElementById('w-pct');
const ePct        = document.getElementById('e-pct');
const fPct        = document.getElementById('f-pct');
const sReset      = document.getElementById('s-reset');
const wReset      = document.getElementById('w-reset');
const fReset      = document.getElementById('f-reset');
const fName       = document.getElementById('f-name');
const eCredits    = document.getElementById('e-credits');
const barSession  = document.getElementById('bar-session');
const barWeekly   = document.getElementById('bar-weekly');
const barFable    = document.getElementById('bar-fable');
const barExtra    = document.getElementById('bar-extra');
const noBars      = document.getElementById('no-bars');
const limitBanner = document.getElementById('limit-banner');
const statusEl    = document.getElementById('status');
const timeEl      = document.getElementById('last-update');
const ctxMenu     = document.getElementById('ctx');
const ctxBackdrop = document.getElementById('ctx-backdrop');
const acctMenu    = document.getElementById('acct-menu');
const btnAccount  = document.getElementById('btn-account');
const appNameEl   = document.querySelector('.app-name');

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

// Tracked-window toggles flipped in Settings → re-render the bars from the
// last data immediately instead of waiting for the next poll.
window.claude.onConfigChanged(newCfg => {
  cfg = newCfg;
  renderBars();
  renderAccountUI();
});

// Account added / removed / renamed / switched → refresh the switcher UI.
window.claude.onAccountsChanged(({ accounts, active_account }) => {
  cfg.accounts       = accounts;
  cfg.active_account = active_account;
  renderAccountUI();
});

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

  // NOTE: an updateCtxChecks() call removed in 1.0.3 — the function no longer
  // existed and the dangling reference silently aborted the rest of init(),
  // so the saved history never loaded until fresh samples arrived.
  renderAccountUI();
  renderBars();   // apply tracked-window visibility before the first poll lands

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
    s, w, point, updatedAt,
    sessionResetsAt: sRA, weeklyResetsAt: wRA, fable,
  } = d;

  // Main now sends only the single new sample (or null), not the whole array.
  // Append it to our local copy and prune to the 7-day window. The timestamp
  // check dedupes against the brief startup race with init()'s getHistory().
  if (point) {
    const lastTs = latestHistory.length ? latestHistory[latestHistory.length - 1].ts : null;
    if (point.ts !== lastTs) latestHistory.push(point);
    const cutoff = Date.now() - 7 * 86_400_000;
    while (latestHistory.length && latestHistory[0].ts <= cutoff) latestHistory.shift();
  }

  sessionResetsAt = sRA || sessionResetsAt;
  weeklyResetsAt  = wRA || weeklyResetsAt;
  fableResetsAt   = (fable && fable.resetsAt) || fableResetsAt;

  lastData = d;
  renderBars();

  const bothNull = s === null && w === null;
  setStatus(
    bothNull ? 'Connected — data format unknown' : 'Connected ✓',
    bothNull ? 'warn' : 'ok',
  );
  timeEl.textContent = updatedAt ? `↻ ${updatedAt}` : '';

  // Only re-render the history panel when it's actually visible. When the user
  // opens it, setViewMode() re-renders with the latest data, so nothing is lost
  // by skipping these updates while the bars view is showing.
  if (viewMode === 'history') {
    if (chartRange === 'day') {
      try { renderDailyView(latestHistory, weeklyResetsAt); } catch (_) {}
    } else {
      try { renderChart(latestHistory, chartRange); } catch (_) {}
    }
  }
}

// ── Bar rendering ─────────────────────────────────────────────────────────
//
// Single entry point that renders every bar from the last usage payload plus
// the tracked-window toggles, then sizes the window to exactly the bars that
// are showing (130px of chrome + 50px per bar). Called on every poll AND
// whenever a toggle changes in Settings, so flipping a toggle takes effect
// instantly without waiting for the next poll.
function renderBars() {
  const d     = lastData || {};
  const s     = d.s !== undefined ? d.s : null;
  const w     = d.w !== undefined ? d.w : null;
  const fable = d.fable || null;
  const extra = d.extraUsage || null;

  const showS = cfg.track_session !== false;
  const showW = cfg.track_weekly  !== false;
  const showF = cfg.track_fable   !== false && !!fable;

  barSession.classList.toggle('hidden', !showS);
  barWeekly.classList.toggle('hidden',  !showW);
  barFable.classList.toggle('hidden',   !showF);

  if (showS) { setBar('s', s); sReset.textContent = d.resets || ''; }
  if (showW) { setBar('w', w); wReset.textContent = d.weeklyResets || ''; }
  if (showF) {
    fName.textContent  = (fable.label || 'FABLE').toUpperCase();
    setBar('f', fable.frac);
    fReset.textContent = fable.resets || '';
  }

  let showE = false;
  if (cfg.track_extra !== false) {
    showE = updateExtraUsage(extra);
  } else {
    barExtra.classList.add('hidden');
  }

  // Untracked windows shouldn't raise the limit banner either
  updateLimitBanner(showS ? s : null, showW ? w : null, showF ? fable : null);

  const visible = [showS, showW, showF, showE].filter(Boolean).length;
  noBars.classList.toggle('hidden', visible !== 0);
  window.claude.resizeForBars(visible === 0 ? 170 : 130 + 50 * visible);
}

function setBar(which, frac) {
  const fill = which === 's' ? sFill : which === 'w' ? wFill : fFill;
  const pct  = which === 's' ? sPct  : which === 'w' ? wPct  : fPct;

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
// Renders the extra-usage bar's content and visibility; returns true when the
// bar is showing. Window sizing is renderBars()'s job — no resize calls here.
function updateExtraUsage(extra) {
  if (!extra) {
    barExtra.classList.add('hidden');
    return false;
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
    return true;
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
    return true;
  }

  if (extra.utilization === null || extra.utilization === undefined) {
    barExtra.classList.add('hidden');
    return false;
  }

  barExtra.classList.remove('hidden');

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
  return true;
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

function renderLimitBanner(sMaxed, wMaxed, fMaxed, fLabel) {
  if (!sMaxed && !wMaxed && !fMaxed) {
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
  if (fMaxed) {
    const cd = countdownStr(fableResetsAt);
    lines.push(`⚠  ${fLabel} limit reached${cd ? ' — resets in ' + cd : ''}`);
  }
  limitBanner.textContent = lines.join('   •   ');
  limitBanner.classList.remove('hidden');
}

function updateLimitBanner(s, w, fable) {
  const sMaxed = s !== null && s >= 1.0;
  const wMaxed = w !== null && w >= 1.0;
  const fMaxed = !!(fable && fable.frac !== null && fable.frac >= 1.0);
  const fLabel = (fable && fable.label) || 'Fable';
  renderLimitBanner(sMaxed, wMaxed, fMaxed, fLabel);
  if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
  if (sMaxed || wMaxed || fMaxed) {
    bannerTimer = setInterval(() => renderLimitBanner(sMaxed, wMaxed, fMaxed, fLabel), 30_000);
  }
}

function resetBars() {
  lastData = null;
  renderBars();   // clears every tracked bar to '—' and hides fable/extra
  timeEl.textContent = '';
  if (viewMode === 'history') {
    if (chartRange === 'day') {
      try { renderDailyView([], weeklyResetsAt); } catch (_) {}
    } else {
      try { renderChart([], chartRange); } catch (_) {}
    }
  }
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className   = 'status' + (type ? ` ${type}` : '');
}

// ── Chart ─────────────────────────────────────────────────────────────────

// Inline Chart.js plugin: draws a dashed vertical line wherever the weekly
// utilization DROPPED inside the visible window. The weekly number only ever
// climbs within a billing week, so a drop means Anthropic reset or re-baselined
// the limits (it happens at model launches — e.g. Fable 5, June 2026). Without
// the marker, the line just plunges and looks like a glitch. renderChart
// computes the positions and stashes them on the chart as $resetMarkers.
const resetMarkerPlugin = {
  id: 'resetMarkers',
  afterDatasetsDraw(c) {
    const marks = c.$resetMarkers;
    if (!marks || !marks.length) return;
    const { ctx, chartArea, scales } = c;
    ctx.save();
    ctx.strokeStyle = 'rgba(201,114,72,0.65)';   // weekly-line orange
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.fillStyle   = 'rgba(201,114,72,0.9)';
    ctx.font        = '8px sans-serif';
    ctx.textAlign   = 'center';
    for (const x of marks) {
      const px = scales.x.getPixelForValue(x);
      if (px < chartArea.left - 1 || px > chartArea.right + 1) continue;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top + 9);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.fillText('reset', px, chartArea.top + 7);
    }
    ctx.restore();
  },
};

function initChart() {
  const ctx = document.getElementById('chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    plugins: [resetMarkerPlugin],
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

  // Past 8 hours — eight rolling 1-hour buckets going back from now. Each bucket
  // holds its most recent sample. We make a single chronological pass over the
  // history (instead of filtering the whole array once per bucket): the bucket
  // index is just the number of whole hours between the sample and the window
  // start, and because samples are in time order the last write to each bucket
  // wins. spanGaps:true on each dataset connects across empty buckets.
  const windowStart = now - 8 * 3_600_000;
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const bucketEnd = now - i * 3_600_000;
    buckets.push({
      label: new Date(bucketEnd).toLocaleTimeString([], { hour: 'numeric', hour12: true }),
      s: null, w: null,
    });
  }
  // Reset markers: a drop in the weekly value between consecutive samples means
  // Anthropic reset the limits mid-window. Record where it happened so the
  // resetMarkers plugin can draw a dashed line there. Bucket i's plotted point
  // represents (i+1) hours after windowStart, so a sample at `hours` maps to
  // the fractional category position hours - 1. The 2-point threshold ignores
  // rounding jitter.
  const resetMarks = [];
  let prevChartW = null;
  for (const h of history) {
    if (h.ts >= now) continue;
    if (h.ts < windowStart) {
      if (h.w !== null && h.w !== undefined) prevChartW = h.w;
      continue;
    }
    let idx = Math.floor((h.ts - windowStart) / 3_600_000);
    if (idx < 0) idx = 0; else if (idx > 7) idx = 7;
    buckets[idx].s = h.s ?? null;
    buckets[idx].w = h.w ?? null;
    if (h.w !== null && h.w !== undefined) {
      if (prevChartW !== null && prevChartW - h.w > 0.02) {
        const fIdx = (h.ts - windowStart) / 3_600_000 - 1;
        resetMarks.push(Math.max(0, Math.min(7, fIdx)));
      }
      prevChartW = h.w;
    }
  }
  chart.$resetMarkers = resetMarks;
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
  const weekEnd   = weekStart + 7 * 86_400_000;
  const now       = Date.now();

  // Day buckets, anchored to the weekly reset time (≈10 PM → 10 PM windows)
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = weekStart + i * 86_400_000;
    const dayEnd   = dayStart  + 86_400_000;
    const isToday  = dayStart <= now && now < dayEnd;
    const isFuture = dayStart > now;
    const label    = DAY_NAMES[new Date(dayStart + 43_200_000).getDay()];
    days.push({ label, isToday, isFuture, dayStart, dayEnd, used: 0 });
  }

  // ── Per-day usage = sum of positive sample-to-sample increases ─────────────
  //
  // The weekly utilization % normally only climbs during a week and resets to 0
  // exactly at the window boundary. But Anthropic can reset or re-baseline it
  // MID-week (e.g. a model launch), dropping the value partway through a day.
  // The old "today's peak minus yesterday's peak" math broke on that: a
  // post-reset day whose peak sat below the pre-reset peak produced a negative
  // delta that clamped to 0%, hiding a whole day of real usage (the "Wednesday
  // 0%" bug).
  //
  // Instead we walk every sample in time order and add only the positive steps
  // (max(0, w - prevW)) to whichever day the sample lands in. The weekly window
  // starts at 0 by definition, so prevW starts at 0 and the first sample's value
  // counts as real usage. A reset is one big negative step that contributes
  // nothing (correct — a reset isn't usage), and every climb after it is counted
  // from the new baseline (correct — that's real usage in the new window). An
  // empty day contributes 0% and can't inflate the next day, because the carried
  // value is the last KNOWN sample, never an artificial zero.
  const samples = history
    .filter(h => h.w !== null && h.w !== undefined && h.ts >= weekStart && h.ts < weekEnd)
    .sort((a, b) => a.ts - b.ts);

  let prevW   = 0;
  let latestW = 0;
  for (const samp of samples) {
    const step = samp.w - prevW;
    if (step > 0) {
      for (const day of days) {
        if (samp.ts >= day.dayStart && samp.ts < day.dayEnd) { day.used += step; break; }
      }
    }
    prevW   = samp.w;
    latestW = samp.w;
  }

  // "Left" reflects the CURRENT window position (latest sample), so a stale
  // pre-reset peak can't pollute it.
  const remaining = Math.max(0, 1 - latestW);

  const rowsHtml = days.map(day => {
    const delta   = day.isFuture ? null : day.used;
    // Absolute scaling: bar width = actual % of weekly allowance used that day
    const barPct  = delta !== null ? Math.min(100, Math.round(delta * 100)) : 0;
    const pctText = day.isFuture ? '—' : `${Math.round((delta ?? 0) * 100)}%`;

    const todayCls  = day.isToday  ? ' today'  : '';
    const futureCls = day.isFuture ? ' future' : '';

    return `<div class="day-row">
        <span class="day-label${todayCls}${futureCls}">${day.label}</span>
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

// ── Account switcher ──────────────────────────────────────────────────────
// Header shows the active account's name when more than one account exists;
// the person icon opens a dropdown listing every account (active one checked)
// plus Add / Manage entries.
function renderAccountUI() {
  const accounts = cfg.accounts || [];
  const active   = accounts.find(a => a.id === cfg.active_account) || accounts[0];
  if (accounts.length > 1 && active) {
    appNameEl.textContent = active.label;
    appNameEl.title       = active.email || '';
  } else {
    appNameEl.textContent = 'Claude Usage Monitor';
    appNameEl.title       = '';
  }
  buildAcctMenu();
}

// Built with createElement/textContent (not innerHTML) — labels and emails
// are user/API data and must never be parsed as markup.
function buildAcctMenu() {
  acctMenu.innerHTML = '';
  for (const a of (cfg.accounts || [])) {
    const isActive = a.id === cfg.active_account;

    const item  = document.createElement('div');
    item.className = 'ctx-item acct-item' + (isActive ? ' acct-active' : '');

    const check = document.createElement('span');
    check.className   = 'acct-check';
    check.textContent = isActive ? '✓' : '';

    const col = document.createElement('div');
    col.className = 'acct-col';
    const lbl = document.createElement('div');
    lbl.className   = 'acct-label';
    lbl.textContent = a.label;
    col.appendChild(lbl);
    if (a.email) {
      const em = document.createElement('div');
      em.className   = 'acct-email';
      em.textContent = a.email;
      col.appendChild(em);
    }

    item.appendChild(check);
    item.appendChild(col);
    item.addEventListener('click', () => {
      hideCtx();
      if (!isActive) {
        setStatus('Switching account…');
        window.claude.switchAccount(a.id);
      }
    });
    acctMenu.appendChild(item);
  }

  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  acctMenu.appendChild(sep);

  const add = document.createElement('div');
  add.className   = 'ctx-item';
  add.textContent = '＋ Add Account';
  add.addEventListener('click', () => { hideCtx(); window.claude.addAccount(); });
  acctMenu.appendChild(add);

  const manage = document.createElement('div');
  manage.className   = 'ctx-item';
  manage.textContent = '⚙ Manage Accounts';
  manage.addEventListener('click', () => { hideCtx(); window.claude.openSettings(); });
  acctMenu.appendChild(manage);
}

btnAccount.addEventListener('click', () => {
  const wasOpen = !acctMenu.classList.contains('hidden');
  hideCtx();
  if (wasOpen) return;
  acctMenu.classList.remove('hidden');
  ctxBackdrop.classList.remove('hidden');
  const r    = btnAccount.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - acctMenu.offsetWidth - 8));
  acctMenu.style.left = `${left}px`;
  acctMenu.style.top  = `${r.bottom + 6}px`;
});

// ── Context menu ──────────────────────────────────────────────────────────
function hideCtx() {
  ctxMenu.classList.add('hidden');
  acctMenu.classList.add('hidden');
  ctxBackdrop.classList.add('hidden');
}

function showCtx(x, y) {
  acctMenu.classList.add('hidden');   // the two menus never show together
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
