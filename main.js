// ─────────────────────────────────────────────────────────────────────────────
//  Claude Usage Monitor — main.js  (single-window login build)
// ─────────────────────────────────────────────────────────────────────────────

const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  Notification, shell, nativeImage, session, dialog,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

// ── Single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ── Paths ──────────────────────────────────────────────────────────────────
const USER_DATA    = app.getPath('userData');
const CONFIG_FILE  = path.join(USER_DATA, 'config.json');
const HISTORY_FILE = path.join(USER_DATA, 'history.json');
const SRC          = path.join(__dirname, 'src');
const ASSETS       = path.join(__dirname, 'assets');

// ── Config defaults ────────────────────────────────────────────────────────
const DEFAULTS = {
  org_id:                '',
  win_x:                 null,
  win_y:                 null,
  win_w:                 340,
  win_h:                 480,
  always_on_top:         true,
  launch_on_startup:     false,
  start_minimized:       false,   // NEW — only meaningful when launch_on_startup is true
  notifications_enabled: true,
  session_warn_pct:      75,
  session_danger_pct:    95,
  weekly_warn_pct:       75,
  weekly_danger_pct:     95,
  refresh_interval:      60,
  history_view:          '8h',    // renamed from '24h' (the label was always "8h")
  check_for_updates:     true,    // check GitHub releases on startup
  coffee_url:            'https://buymeacoffee.com/lonesmith',
  onboarding_shown:      false,   // one-time welcome screen after first login
};

// ─────────────────────────────────────────────────────────────────────────────
//  Window fade helper
//
//  Animates a BrowserWindow's opacity from `from` to `to` over `durationMs`.
//  Resolves when the animation completes or the window is destroyed mid-fade.
//  All fade calls are ~60fps using 16ms intervals.
// ─────────────────────────────────────────────────────────────────────────────

function fadeWindow(win, from, to, durationMs = 300) {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) { resolve(); return; }
    const steps = Math.max(1, Math.round(durationMs / 16));
    const delta = (to - from) / steps;
    let step = 0;
    win.setOpacity(Math.max(0, Math.min(1, from)));
    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(timer); resolve(); return; }
      step++;
      win.setOpacity(Math.max(0, Math.min(1, from + delta * step)));
      if (step >= steps) { clearInterval(timer); win.setOpacity(to); resolve(); }
    }, 16);
  });
}

// ── Runtime state ──────────────────────────────────────────────────────────
let cfg             = {};
let widgetWin       = null;
let settingsWin     = null;
let loginWin        = null;
let onboardingWin   = null;
let tray            = null;
let pollTimer       = null;
let notified        = {};
let isInLoginFlow   = false;
let savePosTimer    = null;  // debounce for widget-position saves during drag

// ─────────────────────────────────────────────────────────────────────────────
//  Config & History I/O
//
//  All writes are atomic: we write to <file>.tmp and rename it over the real
//  file, which NTFS performs as a single atomic operation. Before the rename,
//  we snapshot the current good file to <file>.bak. If the main file ever
//  fails to parse on load (e.g. was truncated by a hard shutdown mid-write
//  in a pre-atomic-write version of the app), we transparently fall back to
//  the .bak copy.
// ─────────────────────────────────────────────────────────────────────────────

function atomicWriteJSON(filePath, obj, pretty = false) {
  const tmp  = filePath + '.tmp';
  const bak  = filePath + '.bak';
  const data = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, data, 'utf8');
    // Snapshot the previous good file before overwriting it
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, bak); } catch (_) {}
    }
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error('[Claude Usage Monitor] Atomic write failed for', filePath, '—', e.message);
    // Clean up any leftover .tmp so it doesn't masquerade as valid on next load
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

function safeReadJSON(filePath, defaultVal) {
  // Try the main file, then .bak, then fall back to default
  for (const p of [filePath, filePath + '.bak']) {
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, 'utf8');
      if (!content.trim()) throw new Error('empty file');
      const parsed = JSON.parse(content);
      if (p !== filePath) {
        console.warn('[Claude Usage Monitor] Recovered data from .bak:', p);
      }
      return parsed;
    } catch (e) {
      console.error('[Claude Usage Monitor] Failed to parse', p, '—', e.message);
    }
  }
  return defaultVal;
}

// Clean up any orphaned .tmp files left behind from an interrupted write.
// Called once at startup.
function cleanupStaleTmpFiles() {
  for (const f of [CONFIG_FILE, HISTORY_FILE]) {
    const tmp = f + '.tmp';
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
}

function loadConfig() {
  const loaded = safeReadJSON(CONFIG_FILE, null);
  cfg = loaded ? { ...DEFAULTS, ...loaded } : { ...DEFAULTS };

  // ── Developer-controlled constants — never let saved config override ─────
  // coffee_url is a developer constant, not a user preference. If an older
  // build wrote a placeholder (e.g. 'YOUR_USERNAME') into config.json, we
  // overwrite it here so the correct URL is always used.
  cfg.coffee_url = DEFAULTS.coffee_url;

  // ── One-time migrations ───────────────────────────────────────────────────
  if (cfg.history_view === '24h') cfg.history_view = '8h';   // old internal key
  if (cfg.history_view === '7d')  cfg.history_view = 'day';  // 7d tab removed
}

function saveConfig() {
  atomicWriteJSON(CONFIG_FILE, cfg, /* pretty */ true);
}

function loadHistory() {
  const arr = safeReadJSON(HISTORY_FILE, []);
  return Array.isArray(arr) ? arr : [];
}

function saveHistory(arr) {
  atomicWriteJSON(HISTORY_FILE, arr);
}

function appendHistory(s, w) {
  if (s === null && w === null) return loadHistory();
  const now    = Date.now();
  const hist   = loadHistory();
  hist.push({ ts: now, s: s !== null ? +s.toFixed(4) : null, w: w !== null ? +w.toFixed(4) : null });
  const pruned = hist.filter(h => h.ts > now - 7 * 864e5);
  saveHistory(pruned);
  return pruned;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Startup
// ─────────────────────────────────────────────────────────────────────────────

function applyStartup(enable) {
  if (process.platform === 'win32') {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

    // ── Remove legacy/duplicate entries left by older builds ────────────────
    const legacyNames = [
      'com.yourname.claude-usage-monitor',
      'com.thelonesmith.claude-usage-monitor',
      'com.lonesmith.claude-usage-monitor',
    ];
    for (const legacy of legacyNames) {
      try {
        spawnSync('reg', ['delete', regKey, '/v', legacy, '/f'], {
          windowsHide: true,
        });
      } catch (_) {}
    }

    if (enable) {
      // spawnSync passes args directly to reg.exe — no cmd.exe shell involved,
      // so quote characters in the value are written literally to the registry
      // without any shell escaping ambiguity. This was the root cause of the
      // previous startup-not-working bug (path written unquoted, spaces caused
      // Windows to fail silently).
      const exePath = app.getPath('exe');
      const value   = `"${exePath}" --autostart`;
      const result  = spawnSync(
        'reg', ['add', regKey, '/v', 'Claude Usage Monitor', '/t', 'REG_SZ', '/d', value, '/f'],
        { windowsHide: true },
      );
      if (result.status === 0) return;
      console.error('[Startup] Registry write failed:', result.stderr?.toString());
    } else {
      spawnSync(
        'reg', ['delete', regKey, '/v', 'Claude Usage Monitor', '/f'],
        { windowsHide: true },
      );
      return;
    }
  }

  // Fallback (non-Windows, or if spawnSync threw unexpectedly)
  app.setLoginItemSettings({
    openAtLogin: enable,
    name:        'Claude Usage Monitor',
    path:        app.getPath('exe'),
    args:        enable ? ['--autostart'] : [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Session helpers  (persist:claude = shared session across widget + API calls)
// ─────────────────────────────────────────────────────────────────────────────

function claudeSes() { return session.fromPartition('persist:claude'); }

async function isLoggedIn() {
  try {
    const cookies = await claudeSes().cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
    return cookies.length > 0;
  } catch (_) { return false; }
}

async function doLogout() {
  try {
    await claudeSes().clearStorageData({ storages: ['cookies', 'localstorage'] });
    cfg.org_id = '';
    saveConfig();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  API helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  Error message sanitiser
//
//  Chromium surfaces raw net::ERR_* codes in e.message when a fetch fails.
//  These are correct but alarming to end users (e.g. "net::ERR_CONNECTION_CLOSED"
//  → the user thinks the app is broken). This helper converts them to calm,
//  plain-English equivalents. (Issue: Error: net::ERR_CONNECTION_CLOSED)
// ─────────────────────────────────────────────────────────────────────────────

function friendlyNetError(rawMsg) {
  const s = String(rawMsg || '');
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(s))      return 'No internet connection';
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(s))   return 'No internet connection';
  if (/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i.test(s))             return 'Connection timed out';
  if (/net::/i.test(s))                                               return 'Disconnected';
  // Non-network errors (unexpected API response, JSON parse failure, etc.)
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

const BASE_HDR = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`,
  'Accept':     'application/json',
  'Referer':    'https://claude.ai/',
};

async function apiFetch(url) {
  return claudeSes().fetch(url, { headers: BASE_HDR, signal: AbortSignal.timeout(12000) });
}

async function fetchOrgId() {
  try {
    const r = await apiFetch('https://claude.ai/api/organizations');
    if (r.status === 403) return { orgId: null, err: '403' };
    const d = await r.json();
    if (Array.isArray(d) && d.length) return { orgId: d[0].uuid, err: null };
    return { orgId: null, err: 'No organizations found' };
  } catch (e) { return { orgId: null, err: e.message }; }
}

async function fetchUsage(orgId) {
  try {
    const r = await apiFetch(`https://claude.ai/api/organizations/${orgId}/usage`);
    if (r.status === 403) return { data: null, err: '403' };
    return { data: await r.json(), err: null };
  } catch (e) { return { data: null, err: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Usage parser
// ─────────────────────────────────────────────────────────────────────────────

function localTimeStr(isoStr) {
  if (!isoStr) return '';
  try {
    const dt     = new Date(isoStr);
    const diffMs = dt - Date.now();
    if (diffMs <= 0) return 'soon';
    const time   = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffMs < 24 * 3_600_000) return `at ${time}`;
    const day    = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day}, ${time}`;
  } catch (_) { return ''; }
}

function parseUsage(raw) {
  if (!raw || typeof raw !== 'object') {
    return { s: null, w: null, resets: '', weeklyResets: '', extraUsage: null };
  }

  let s = null, w = null, resets = '', weeklyResets = '';
  let sessionResetsAt = null, weeklyResetsAt = null;

  // ── PRIMARY: confirmed API format ─────────────────────────────────────────
  if (raw.five_hour && typeof raw.five_hour === 'object') {
    const u = raw.five_hour.utilization;
    if (u !== null && u !== undefined) s = u / 100;

    if (raw.five_hour.resets_at) {
      sessionResetsAt = raw.five_hour.resets_at;
      try {
        const diffMs = new Date(raw.five_hour.resets_at) - Date.now();
        const atStr  = localTimeStr(raw.five_hour.resets_at);
        if (s !== null && s >= 1.0) {
          resets = atStr ? `Limit reached  (resets ${atStr})` : 'Limit reached';
        } else if (diffMs > 0) {
          const h  = Math.floor(diffMs / 3_600_000);
          const m  = Math.floor((diffMs % 3_600_000) / 60_000);
          const cd = h > 0 ? `${h}h ${m}m` : `${m}m`;
          resets   = atStr ? `Resets in ${cd}  (${atStr})` : `Resets in ${cd}`;
        } else {
          resets = 'Resetting soon';
        }
      } catch (_) {}
    }
  }

  if (raw.seven_day && typeof raw.seven_day === 'object') {
    const u = raw.seven_day.utilization;
    if (u !== null && u !== undefined) w = u / 100;

    if (raw.seven_day.resets_at) {
      weeklyResetsAt = raw.seven_day.resets_at;
      try {
        const diffMs  = new Date(raw.seven_day.resets_at) - Date.now();
        const atStr   = localTimeStr(raw.seven_day.resets_at);
        if (w !== null && w >= 1.0) {
          weeklyResets = atStr ? `Limit reached  (resets ${atStr})` : 'Limit reached';
        } else if (diffMs > 0) {
          const totalH = Math.floor(diffMs / 3_600_000);
          const d      = Math.floor(totalH / 24);
          const h      = totalH % 24;
          const cd     = d > 0 ? `${d}d ${h}h` : `${h}h`;
          weeklyResets = atStr ? `Resets in ${cd}  (${atStr})` : `Resets in ${cd}`;
        } else {
          weeklyResets = 'Resetting soon';
        }
      } catch (_) {}
    }
  }

  // ── FALLBACKS ─────────────────────────────────────────────────────────────
  if (s === null) {
    for (const k of ['session_fraction', 'session_used_fraction', 'raw_session_fraction']) {
      if (k in raw) { s = +raw[k]; break; }
    }
    if (s === null && 'session_remaining_fraction' in raw) s = 1 - +raw.session_remaining_fraction;
  }
  if (w === null) {
    for (const k of ['weekly_fraction', 'weekly_used_fraction', 'raw_weekly_fraction']) {
      if (k in raw) { w = +raw[k]; break; }
    }
    if (w === null && 'weekly_remaining_fraction' in raw) w = 1 - +raw.weekly_remaining_fraction;
  }
  if (raw.usage && typeof raw.usage === 'object') {
    const u = raw.usage;
    if (s === null && u.session) s = +(u.session.fraction ?? u.session.used ?? 0);
    if (w === null && u.weekly)  w = +(u.weekly.fraction  ?? u.weekly.used  ?? 0);
  }
  if (raw.message_limit && typeof raw.message_limit === 'object') {
    const ml = raw.message_limit;
    if (s === null && 'fraction' in ml) s = +ml.fraction;
  }

  // ── Extra usage (pay-per-use) ─────────────────────────────────────────────
  let extraUsage = null;
  if (raw.extra_usage && raw.extra_usage.is_enabled === true) {
    const eu = raw.extra_usage;
    extraUsage = {
      utilization: eu.utilization !== null && eu.utilization !== undefined ? eu.utilization / 100 : null,
      used:        eu.used_credits  != null ? eu.used_credits  / 100 : null,
      limit:       eu.monthly_limit != null ? eu.monthly_limit / 100 : null,
      isUnlimited: eu.monthly_limit === null || eu.monthly_limit === undefined,
      currency:    eu.currency || 'USD',
    };
  } else if (raw.extra_usage && raw.extra_usage.is_enabled === false) {
    // Feature exists on the account but the user has turned it off in Claude settings.
    // Show an "OFF" placeholder so the widget doesn't shrink.
    extraUsage = { isOff: true };
  }

  // Clamp
  if (s !== null) s = Math.max(0, Math.min(1, s));
  if (w !== null) w = Math.max(0, Math.min(1, w));

  return { s, w, resets, weeklyResets, extraUsage, sessionResetsAt, weeklyResetsAt };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Onboarding window
//
//  Shown exactly once after the user's first successful login. Frameless,
//  always-on-top, centered over the widget. Fades in on open, fades out when
//  the user clicks "Got it", then fades in the widget underneath.
// ─────────────────────────────────────────────────────────────────────────────

function createOnboardingWindow() {
  if (onboardingWin && !onboardingWin.isDestroyed()) { onboardingWin.focus(); return; }

  const [wx, wy] = widgetWin?.getPosition() || [0, 0];
  const [ww, wh] = widgetWin?.getSize()     || [340, 230];
  const OW = 480, OH = 590;

  onboardingWin = new BrowserWindow({
    width:       OW,
    height:      OH,
    x:           Math.round(wx + (ww - OW) / 2),
    y:           Math.round(wy + (wh - OH) / 2),
    resizable:   false,
    frame:       false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show:        false,
    opacity:     0,
    icon:        path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  onboardingWin.loadFile(path.join(SRC, 'onboarding.html'));

  onboardingWin.once('ready-to-show', async () => {
    onboardingWin.show();
    await fadeWindow(onboardingWin, 0, 1, 400);
  });

  onboardingWin.on('closed', () => { onboardingWin = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Notifications
// ─────────────────────────────────────────────────────────────────────────────

function maybeNotify(s, w) {
  if (!cfg.notifications_enabled || !Notification.isSupported()) return;
  const checks = [
    { key: `s_${cfg.session_danger_pct}`, frac: s, pct: cfg.session_danger_pct, label: 'Session' },
    { key: `s_${cfg.session_warn_pct}`,   frac: s, pct: cfg.session_warn_pct,   label: 'Session' },
    { key: `w_${cfg.weekly_danger_pct}`,  frac: w, pct: cfg.weekly_danger_pct,  label: 'Weekly'  },
    { key: `w_${cfg.weekly_warn_pct}`,    frac: w, pct: cfg.weekly_warn_pct,    label: 'Weekly'  },
  ];
  for (const c of checks) {
    if (c.frac === null) continue;
    const over = c.frac * 100 >= c.pct;
    if (over && !notified[c.key]) {
      new Notification({
        title: 'Claude Usage Monitor',
        body:  `${c.label} usage reached ${c.pct}% (now at ${Math.round(c.frac * 100)}%)`,
        // Large icon shown inside the toast body. The small top-bar icon is
        // resolved by Windows from the Start Menu shortcut whose AppUserModelId
        // matches app.setAppUserModelId(...) below — this only works when the
        // app is installed via the NSIS build, not in `npm start` dev mode.
        icon:  path.join(ASSETS, 'icon.png'),
      }).show();
      notified[c.key] = true;
    } else if (!over) {
      notified[c.key] = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Update check
//
//  Hits the GitHub Releases API on startup (when enabled). Completely silent
//  if there's no update, no internet, or GitHub is unreachable — never bothers
//  the user unless there's actually something to download.
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_RELEASES_API = 'https://api.github.com/repos/theLonesmith/claude-usage-monitor/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/theLonesmith/claude-usage-monitor/releases/latest';

async function checkForUpdates(silent = true) {
  // silent = true  → auto-check at startup: only show dialog if update found
  // silent = false → manual check from tray: always show a result
  if (silent && !cfg.check_for_updates) return;

  const iconImg = nativeImage.createFromPath(path.join(ASSETS, 'icon.ico'));

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { 'User-Agent': 'claude-usage-monitor' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (!silent) {
        await dialog.showMessageBox(widgetWin, {
          type:    'warning',
          title:   'Check for Updates',
          message: 'Could not reach the update server.',
          detail:  'Check your internet connection and try again.',
          buttons: ['OK'],
          icon:    iconImg,
        });
      }
      return;
    }

    const data    = await res.json();
    const latest  = data.tag_name?.replace(/^v/, '');
    const current = app.getVersion();
    if (!latest) return;

    const toNum = v => v.split('.').reduce((acc, n, i) => acc + (parseInt(n, 10) || 0) * Math.pow(1000, 2 - i), 0);

    if (toNum(latest) <= toNum(current)) {
      // Already up to date — only tell the user if they asked manually
      if (!silent) {
        await dialog.showMessageBox(widgetWin, {
          type:    'info',
          title:   'Check for Updates',
          message: 'You\'re running the latest version.',
          detail:  `Claude Usage Monitor v${current} is up to date.`,
          buttons: ['OK'],
          icon:    iconImg,
        });
      }
      return;
    }

    // Newer version available — always show regardless of silent flag
    const { response } = await dialog.showMessageBox(widgetWin, {
      type:      'info',
      title:     'Update Available',
      message:   `Claude Usage Monitor v${latest} is available`,
      detail:    `You're running v${current}. Would you like to open the download page?`,
      buttons:   ['Download Update', 'Not Now'],
      defaultId: 0,
      cancelId:  1,
      icon:      iconImg,
    });
    if (response === 0) {
      shell.openExternal(GITHUB_RELEASES_URL);
    }
  } catch (_) {
    // Network down, timeout, malformed response — never surface to user on
    // auto-check. Show a brief message on manual check.
    if (!silent) {
      await dialog.showMessageBox(widgetWin, {
        type:    'warning',
        title:   'Check for Updates',
        message: 'Could not check for updates.',
        detail:  'Check your internet connection and try again.',
        buttons: ['OK'],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core poll
// ─────────────────────────────────────────────────────────────────────────────

async function poll() {
  if (isInLoginFlow) return;

  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    widgetWin?.webContents.send('usage-update', { status: 'no_session' });
    return;
  }

  if (!cfg.org_id) {
    widgetWin?.webContents.send('usage-update', { status: 'connecting' });
    const { orgId, err } = await fetchOrgId();
    if (orgId) { cfg.org_id = orgId; saveConfig(); }
    else {
      if (err === '403') await doLogout();
      widgetWin?.webContents.send('usage-update', {
        status: 'error',
        message: err === '403' ? 'Session expired — please log in again' : friendlyNetError(err),
      });
      return;
    }
  }

  const { data, err } = await fetchUsage(cfg.org_id);
  if (err) {
    if (err === '403') { await doLogout(); cfg.org_id = ''; saveConfig(); }
    widgetWin?.webContents.send('usage-update', {
      status:  'error',
      message: err === '403' ? 'Session expired — please log in again' : friendlyNetError(err),
    });
    return;
  }

  const { s, w, resets, weeklyResets, extraUsage, sessionResetsAt, weeklyResetsAt } = parseUsage(data);

  if (s === null && w === null) {
    console.log('[Claude Usage Monitor] Could not parse usage. Raw response:');
    console.log(JSON.stringify(data, null, 2));
  }

  const history = appendHistory(s, w);
  maybeNotify(s, w);

  widgetWin?.webContents.send('usage-update', {
    status: 'ok', s, w, resets, weeklyResets, extraUsage,
    sessionResetsAt, weeklyResetsAt,
    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    history,
  });
}

function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, (cfg.refresh_interval || 60) * 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Single-window login flow
// ─────────────────────────────────────────────────────────────────────────────

function navigateToLogin() {
  if (isInLoginFlow) return;
  isInLoginFlow = true;
  stopPolling();

  // Close any stale login window
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.destroy();
    loginWin = null;
  }

  // Step down the widget so the login window can sit on top
  widgetWin?.setAlwaysOnTop(false);

  loginWin = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    frame: true,
    title: 'Log in to Claude',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: claudeSes(),
    },
  });

  loginWin.setOpacity(0);
  loginWin.once('ready-to-show', () => {
    loginWin.show();
    loginWin.focus();
    loginWin.moveTop();
  });

  // ── Login completion ─────────────────────────────────────────────────────
  let loginCompleted = false;

  const completeLogin = async () => {
    if (loginCompleted || !isInLoginFlow) return;
    loginCompleted = true;
    claudeSes().cookies.off('changed', cookieWatcher);  // stop watching
    isInLoginFlow = false;
    const w = loginWin;
    loginWin = null;
    // Pre-hide widgetWin so it's ready to fade in cleanly after transition
    widgetWin?.setOpacity(0);
    await fadeWindow(w, 1, 0, 300);
    w?.close();
    await onLoginSuccess();
  };

  // PRIMARY: fire the instant the sessionKey cookie is written to the session —
  // works for every login method (email, Google, etc.) without any race condition.
  const cookieWatcher = (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === 'sessionKey' && cookie.domain?.includes('claude.ai')) {
      completeLogin();
    }
  };
  claudeSes().cookies.on('changed', cookieWatcher);

  // FALLBACK: if loginWin itself navigates to a post-login page (e.g. email flow),
  // check for the cookie one more time with a small delay to let it settle.
  loginWin.webContents.on('did-navigate', async (_, url) => {
    if (!url.includes('claude.ai')) return;
    if (url.includes('/login') || url.includes('/auth') || url.includes('/oauth')) return;
    // We're on claude.ai home — give the cookie store 500 ms to flush then check
    setTimeout(async () => {
      const cookies = await claudeSes().cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
      if (cookies.length > 0) completeLogin();
    }, 500);
  });

  // ── OAuth popup handling (Google, etc.) ──────────────────────────────────
  // Explicitly pass the same session so cookies land in claudeSes()
  loginWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 500,
      height: 800,
      resizable: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: claudeSes(),   // <-- critical: share same session
      },
    },
  }));

  loginWin.webContents.on('did-create-window', (popup) => {
    popup.once('ready-to-show', () => {
      popup.show();
      popup.focus();
      popup.moveTop();
    });
  });

  loginWin.loadURL('https://claude.ai/login');

  // Hide scrollbar and fade in on first load
  let loginFadedIn = false;
  loginWin.webContents.on('did-finish-load', () => {
    loginWin?.webContents.insertCSS(
      '::-webkit-scrollbar { display: none !important; }'
    );
    if (!loginFadedIn) {
      loginFadedIn = true;
      fadeWindow(loginWin, 0, 1, 350);
    }
  });

  // User closed the login window without completing login → return to login screen
  loginWin.on('closed', () => {
    claudeSes().cookies.off('changed', cookieWatcher);  // always clean up
    loginWin = null;
    widgetWin?.setAlwaysOnTop(cfg.always_on_top);
    if (isInLoginFlow) {
      isInLoginFlow = false;
      resizeWidget(340, 450);   // logged-out (taller) layout
      widgetWin?.center();
      widgetWin?.loadFile(path.join(SRC, 'login-screen.html'));
    }
  });
}

async function onLoginSuccess() {
  isInLoginFlow = false;
  cfg.org_id = '';
  saveConfig();

  widgetWin?.setAlwaysOnTop(cfg.always_on_top); // restore after login
  resizeWidget(340, 230);                       // logged-in default (2-bar) layout

  if (cfg.win_x !== null && cfg.win_y !== null) {
    widgetWin?.setPosition(cfg.win_x, cfg.win_y);
  } else {
    widgetWin?.center();
  }

  widgetWin?.setOpacity(0);
  widgetWin?.loadFile(path.join(SRC, 'widget.html'));

  widgetWin?.webContents.once('did-finish-load', async () => {
    settingsWin?.webContents.send('login-success');
    startPolling();

    if (!cfg.onboarding_shown) {
      // First login — show onboarding over the (still hidden) widget
      createOnboardingWindow();
    } else {
      // Returning user — fade widget straight in
      await fadeWindow(widgetWin, 0, 1, 350);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Widget-window resize helper
//
//  The widget window is built with equal min*/max* dimensions (a hard lock).
//  When we switch between logged-in (360 tall) and logged-out (400 tall)
//  layouts, plain setSize() gets clamped by the current min/max constraints —
//  so we must loosen the constraints first, resize, then re-lock them at the
//  new dimensions. Doing this in one helper keeps the three transition call
//  sites honest.
// ─────────────────────────────────────────────────────────────────────────────
function resizeWidget(w, h) {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  widgetWin.setMinimumSize(w, h);
  widgetWin.setMaximumSize(w, h);
  widgetWin.setSize(w, h);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Window builders
// ─────────────────────────────────────────────────────────────────────────────

async function createWidgetWindow() {
  const loggedIn = await isLoggedIn();

  // Fixed size — widget is not resizable
  const initW = 340;
  const initH = loggedIn ? 230 : 450;

  const opts = {
    width:     initW,
    height:    initH,
    minWidth:  initW,
    minHeight: initH,
    maxWidth:  initW,
    maxHeight: initH,
    icon:        path.join(ASSETS, 'icon.png'),
    frame:       false,
    resizable:   false,
    skipTaskbar: true,
    alwaysOnTop: cfg.always_on_top,
    show:        false,
    webPreferences: {
      session:          claudeSes(),
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  };

  if (loggedIn && cfg.win_x !== null && cfg.win_y !== null) {
    opts.x = cfg.win_x;
    opts.y = cfg.win_y;
  } else {
    opts.center = true;
  }

  widgetWin = new BrowserWindow(opts);

  widgetWin.once('ready-to-show', () => {
    // If the app was launched by Windows at startup AND the user wants it
    // hidden, skip show() entirely — the window stays invisible until the
    // user clicks the tray icon. Without this check, show() always fires
    // here AFTER the post-creation hide() call in app.on('ready'), meaning
    // the hide was always a no-op and Start Minimized never worked.
    const shouldHide = process.argv.includes('--autostart') && cfg.start_minimized;
    if (!shouldHide) {
      widgetWin.setOpacity(0);
      widgetWin.show();
      widgetWin.focus();
      fadeWindow(widgetWin, 0, 1, 350);
    }
  });
  widgetWin.on('close', e => { e.preventDefault(); widgetWin?.hide(); });
  // Close the right-click context menu whenever the window loses focus
  // (e.g. user clicks on the desktop or another application)
  widgetWin.on('blur', () => widgetWin?.webContents.send('hide-ctx'));

  // Save position when moved (size is fixed, no need to track it).
  // Debounced: the 'moved' event fires many times per second during a drag,
  // and every saveConfig() now performs an atomic write + .bak copy. Without
  // the debounce a single drag could trigger hundreds of disk writes. 300ms
  // after the last move event we commit the final position.
  const savePos = () => {
    if (isInLoginFlow) return;
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      const [x, y] = widgetWin.getPosition();
      cfg.win_x = x; cfg.win_y = y;
      saveConfig();
    }, 300);
  };
  widgetWin.on('moved', savePos);

  if (loggedIn) {
    widgetWin.loadFile(path.join(SRC, 'widget.html'));
    // ── KEY FIX: wait for widget.html to fully load before starting the poll.
    // Without this, poll() fires before widget.js registers onUsageUpdate(),
    // the IPC message is lost, and the widget stays stuck at "Starting…".
    widgetWin.webContents.once('did-finish-load', () => {
      startPolling();
    });
  } else {
    widgetWin.loadFile(path.join(SRC, 'login-screen.html'));
  }
}

function createSettingsWindow() {
  if (settingsWin) { settingsWin.focus(); settingsWin.moveTop(); return; }

  settingsWin = new BrowserWindow({
    width: 440, height: 700,
    title: 'Claude Usage Monitor — Settings',
    icon: path.join(ASSETS, 'icon.png'),
    resizable: false, frame: false, show: false, alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(SRC, 'settings.html'));
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus(); settingsWin.moveTop(); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tray
// ─────────────────────────────────────────────────────────────────────────────

function createTray() {
  const trayPath = fs.existsSync(path.join(ASSETS, 'tray.png'))
    ? path.join(ASSETS, 'tray.png')
    : path.join(ASSETS, 'icon.png');
  let img;
  try {
    img = nativeImage.createFromPath(trayPath).resize({ width: 32, height: 32 });
  } catch (_) { img = nativeImage.createEmpty(); }

  tray = new Tray(img);
  tray.setToolTip('Claude Usage Monitor');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide',           click: () => widgetWin?.isVisible() ? widgetWin.hide() : widgetWin?.show() },
    { label: 'Refresh Now',           click: poll },
    { label: 'Check for Updates',     click: () => checkForUpdates(false) },
    { type:  'separator' },
    { label: 'Settings',              click: createSettingsWindow },
    { type:  'separator' },
    { label: 'Quit Claude Usage Monitor', click: () => app.quit() },
  ]));
  tray.on('click', () => widgetWin?.isVisible() ? widgetWin.hide() : widgetWin?.show());
}

// ─────────────────────────────────────────────────────────────────────────────
//  IPC
// ─────────────────────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle('get-config',      () => ({ ...cfg }));
  ipcMain.handle('get-history',     () => loadHistory());
  ipcMain.handle('get-login-status',() => isLoggedIn());
  ipcMain.handle('get-version',     () => app.getVersion());

  ipcMain.handle('save-config', (_, patch) => {
    const prev = cfg.refresh_interval;
    cfg = { ...cfg, ...patch };
    saveConfig();
    if (patch.always_on_top !== undefined)     widgetWin?.setAlwaysOnTop(cfg.always_on_top);
    if (patch.launch_on_startup !== undefined)  applyStartup(cfg.launch_on_startup);
    if (patch.refresh_interval  !== undefined && patch.refresh_interval !== prev) startPolling();
    return { ...cfg };
  });

  ipcMain.on('open-login',    () => navigateToLogin());
  ipcMain.on('open-settings', () => createSettingsWindow());
  ipcMain.on('close-settings',() => settingsWin?.close());
  ipcMain.on('manual-refresh',      () => poll());
  ipcMain.on('check-for-updates',   () => checkForUpdates(false));
  ipcMain.on('hide-widget',         () => widgetWin?.hide());
  ipcMain.on('show-widget',   () => widgetWin?.show());

  ipcMain.on('close-onboarding', async () => {
    if (!onboardingWin || onboardingWin.isDestroyed()) return;
    const win = onboardingWin;
    onboardingWin = null;
    cfg.onboarding_shown = true;
    saveConfig();
    await fadeWindow(win, 1, 0, 300);
    win.close();
    await fadeWindow(widgetWin, 0, 1, 350);
  });
  // ── Dynamic widget height (bars view) ────────────────────────────────────
  // Renderer sends this when extra-usage bar appears or disappears so the
  // window snaps to the minimum height needed — no wasted empty space.
  ipcMain.on('resize-for-bars', (_, h) => resizeWidget(340, h));
  // ── External URL opener ──────────────────────────────────────────────────
  // After shell.openExternal() the browser takes focus. On Windows, that can
  // drop the Electron window's "topmost" z-order even though alwaysOnTop is
  // still true as a property. Toggling alwaysOnTop off/on forces the Windows
  // window manager to re-assert topmost, so the settings panel pops back to
  // the front when the browser closes (Issue 6).
  ipcMain.on('open-url', (_, url) => {
    shell.openExternal(url);
    setTimeout(() => {
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.setAlwaysOnTop(false);
        settingsWin.setAlwaysOnTop(true);
        settingsWin.focus();
        settingsWin.moveTop();
      }
    }, 150);
  });

  ipcMain.on('logout', async () => {
    await doLogout();
    notified = {}; isInLoginFlow = false;
    stopPolling();
    settingsWin?.close();
    resizeWidget(340, 450);   // logged-out (taller) layout — see resizeWidget() docs
    widgetWin?.center();
    widgetWin?.loadFile(path.join(SRC, 'login-screen.html'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  App lifecycle
// ─────────────────────────────────────────────────────────────────────────────

app.on('ready', async () => {
  app.setName('Claude Usage Monitor');
  // AUMID must match package.json "appId" so that the NSIS-installed Start Menu
  // shortcut's AppUserModelId matches the running process. Windows uses that
  // match to resolve the small top-bar icon shown in toast notifications.
  // (In `npm start` dev mode there is no installed shortcut, so that small
  // icon will still fall back to a generic one — expected. Packaged builds
  // from build.bat will display the Claude Usage Monitor icon correctly.)
  app.setAppUserModelId('com.lonesmith.claude-usage-monitor');

  // Clean up any LevelDB lock files left behind by a previous forced shutdown
  // (Windows restart/crash leaves these behind, causing 0x80000003 crash on next launch)
  try {
    const partitionPath = path.join(app.getPath('userData'), 'Partitions', 'claude');
    const lockFiles = [
      path.join(partitionPath, 'IndexedDB', 'https_claude.ai_0.indexeddb.leveldb', 'LOCK'),
      path.join(partitionPath, 'Local Storage', 'leveldb', 'LOCK'),
    ];
    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log('[Claude Usage Monitor] Cleared stale lock file:', lockFile);
      }
    }
  } catch (_) {}

  // Also clean up any orphaned .tmp config/history files from an interrupted
  // write. Must happen BEFORE loadConfig().
  cleanupStaleTmpFiles();

  loadConfig();
  registerIPC();

  // ── Reconcile registry with saved config ─────────────────────────────────
  // Ensures the startup registry entry always matches what config.json says,
  // even if the entry was written by an older build with broken quoting, was
  // manually deleted from the registry, or the exe path changed after a
  // reinstall. Runs every launch so the state is always self-healing.
  applyStartup(cfg.launch_on_startup);

  await createWidgetWindow();
  createTray();
  // NOTE: startPolling() is called inside createWidgetWindow()'s did-finish-load
  // handler, ensuring poll() only fires after widget.js has registered its listeners.

  // ── Update check ─────────────────────────────────────────────────────────
  // Deferred 5 seconds so the widget is fully loaded and the first poll has
  // already fired before any dialog could appear.
  setTimeout(() => checkForUpdates(), 5000);
});

app.on('second-instance', () => { widgetWin?.show(); widgetWin?.focus(); });
app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => {
  widgetWin?.removeAllListeners('close');
  stopPolling();
  // Flush any pending debounced position save so we don't lose the last drag.
  if (savePosTimer) {
    clearTimeout(savePosTimer);
    savePosTimer = null;
    try {
      if (widgetWin && !widgetWin.isDestroyed()) {
        const [x, y] = widgetWin.getPosition();
        cfg.win_x = x; cfg.win_y = y;
        saveConfig();
      }
    } catch (_) {}
  }
  // Flush the session to disk so LevelDB closes cleanly before process exits
  try { claudeSes().flushStorageData(); } catch (_) {}
});
