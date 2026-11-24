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

// ── Dev-only profile isolation ──────────────────────────────────────────────
// When CUM_USER_DATA is set, ALL app data (config, history, login sessions)
// lives in that folder instead of the real %APPDATA% profile. Lets a
// development copy run alongside the installed app without touching its real
// config or logins. Must be set before the single-instance lock — the lock is
// scoped to the userData path. No effect unless the env var is set.
if (process.env.CUM_USER_DATA) {
  app.setPath('userData', process.env.CUM_USER_DATA);
}

// ── Single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ── Hardware acceleration ────────────────────────────────────────────────────
// The widget is a ~340px window drawing two progress bars and an occasional
// small chart. Compositing it on the GPU spins up a separate Chromium GPU
// process (~20-30 MB) for no real benefit. Rendering in software removes that
// process entirely. Trade-off: window fades and chart tooltips paint on the CPU,
// which is imperceptible at this window size. (Comment out this one line if the
// fades ever look soft on a particular PC.)
app.disableHardwareAcceleration();

// ── Paths ──────────────────────────────────────────────────────────────────
const USER_DATA    = app.getPath('userData');
const CONFIG_FILE  = path.join(USER_DATA, 'config.json');
const HISTORY_FILE = path.join(USER_DATA, 'history.json');
const SRC          = path.join(__dirname, 'src');
const ASSETS       = path.join(__dirname, 'assets');

// ── Config defaults ────────────────────────────────────────────────────────
const DEFAULTS = {
  org_id:                '',      // legacy (pre-1.0.3) — migrated into accounts[]
  accounts:              [],      // [{ id, label, email, partition, org_id }]
  active_account:        '',      // id of the account currently shown
  track_session:         true,    // which usage windows the widget displays
  track_weekly:          true,
  track_extra:           true,
  track_fable:           true,
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
  onboarding_shown:      false,   // one-time welcome screen after first login
};

// Developer constant, not a user preference — so it lives here instead of in
// config.json. The get-config IPC handler injects it so the settings renderer
// can still read it from the config object it already receives.
const COFFEE_URL = 'https://buymeacoffee.com/lonesmith';

// ── Dev-only mock mode ───────────────────────────────────────────────────────
// CUM_MOCK_USAGE points at a JSON file of fake /usage API payloads so the full
// UI (fable bar, multi-account switching, toggles) can be exercised without a
// real login. File shape: either one payload used for every account, or
// { "<accountId>": payload, ... } keyed by account id. Inert unless set.
const MOCK = process.env.CUM_MOCK_USAGE || null;

function mockUsageFor(acctId) {
  const all = safeReadJSON(MOCK, {});
  const payload = all[acctId] || all.default_payload || all;
  return JSON.parse(JSON.stringify(payload));
}

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
  // Per-account history files: match the orphaned .tmp itself, so a stray
  // history-acct-2.json.tmp is removed even if its main file never existed.
  try {
    for (const f of fs.readdirSync(USER_DATA)) {
      if (/^history-.+\.json\.tmp$/.test(f)) {
        try { fs.unlinkSync(path.join(USER_DATA, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

function loadConfig() {
  const loaded = safeReadJSON(CONFIG_FILE, null);
  cfg = loaded ? { ...DEFAULTS, ...loaded } : { ...DEFAULTS };

  // ── One-time migrations ───────────────────────────────────────────────────
  // coffee_url used to be stored in config.json; it's a developer constant
  // (COFFEE_URL above) now, so drop any stale copy from older builds.
  delete cfg.coffee_url;
  if (cfg.history_view === '24h') cfg.history_view = '8h';   // old internal key
  if (cfg.history_view === '7d')  cfg.history_view = 'day';  // 7d tab removed

  // ── 1.0.3 migration: single login → accounts[] ────────────────────────────
  // Pre-1.0.3 builds stored one login in the 'persist:claude' partition with
  // its org id in cfg.org_id. Wrap that state in an account entry so the
  // existing login carries over without the user re-authenticating. The
  // 'claude' partition and history.json stay bound to this first account.
  if (!Array.isArray(cfg.accounts)) cfg.accounts = [];
  if (cfg.accounts.length === 0) {
    cfg.accounts = [{
      id:        'default',
      label:     'Account 1',
      email:     '',
      partition: 'claude',
      org_id:    cfg.org_id || '',
    }];
    cfg.active_account = 'default';
  }
  if (!cfg.accounts.some(a => a.id === cfg.active_account)) {
    cfg.active_account = cfg.accounts[0].id;
  }
  delete cfg.org_id;
}

function saveConfig() {
  atomicWriteJSON(CONFIG_FILE, cfg, /* pretty */ true);
}

// ─────────────────────────────────────────────────────────────────────────────
//  In-memory history cache
//
//  The history array is held in memory and flushed to disk on a timer (every
//  HISTORY_FLUSH_MS) plus on quit — instead of being read, rewritten, AND
//  backup-copied on every single poll. For a file that grows to thousands of
//  entries while polling every 30-60s, that per-poll rewrite was ~99% of the
//  app's disk I/O. The on-disk format and the atomic-write/.bak safety machinery
//  are unchanged; they just run far less often.
// ─────────────────────────────────────────────────────────────────────────────

let historyCache       = null;   // loaded lazily on first access
let historyDirty       = false;  // in-memory data differs from what's on disk
let historyFile        = null;   // disk file the cache was loaded from
let historyFlushTimer  = null;
const HISTORY_FLUSH_MS     = 5 * 60 * 1000;   // flush to disk every 5 minutes
const HISTORY_HEARTBEAT_MS = 5 * 60 * 1000;   // force a sample at least this often

// Each account keeps its own history so the graph never mixes two accounts'
// usage. The migrated 'default' account keeps the pre-1.0.3 history.json.
function historyFileFor(acct) {
  return acct.id === 'default'
    ? HISTORY_FILE
    : path.join(USER_DATA, `history-${acct.id}.json`);
}

function loadHistory() {
  if (historyCache === null) {
    historyFile = historyFileFor(activeAccount());
    const arr = safeReadJSON(historyFile, []);
    historyCache = Array.isArray(arr) ? arr : [];
  }
  return historyCache;
}

function flushHistory() {
  if (!historyDirty || historyCache === null || !historyFile) return;
  if (atomicWriteJSON(historyFile, historyCache)) historyDirty = false;
}

// Flush the outgoing account's samples and drop the cache so the next
// loadHistory() picks up the incoming account's file.
function resetHistoryCache() {
  flushHistory();
  historyCache = null;
  historyDirty = false;
  historyFile  = null;
}

function startHistoryFlushTimer() {
  if (historyFlushTimer) return;
  historyFlushTimer = setInterval(flushHistory, HISTORY_FLUSH_MS);
}

// Append a sample to the in-memory history and return the new entry, or null if
// nothing was recorded. We skip appends when neither value changed (utilization
// is reported in whole percents and moves slowly, so most polls are exact
// duplicates) unless HISTORY_HEARTBEAT_MS has elapsed — the heartbeat keeps the
// history graph continuous during idle stretches. Pruning to the 7-day window
// happens in place.
function appendHistory(s, w) {
  const hist = loadHistory();
  if (s === null && w === null) return null;

  const now  = Date.now();
  const sVal = s !== null ? +s.toFixed(4) : null;
  const wVal = w !== null ? +w.toFixed(4) : null;

  const last    = hist[hist.length - 1];
  const changed = !last || last.s !== sVal || last.w !== wVal;
  const stale   = !last || (now - last.ts) >= HISTORY_HEARTBEAT_MS;
  if (!changed && !stale) return null;

  const entry = { ts: now, s: sVal, w: wVal };
  hist.push(entry);

  const cutoff = now - 7 * 864e5;
  while (hist.length && hist[0].ts <= cutoff) hist.shift();

  historyDirty = true;
  return entry;
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
//  Accounts & session helpers
//
//  Each account owns its own Electron session partition ('persist:<partition>'),
//  so logins never bleed between accounts. The pre-1.0.3 login lives in
//  'persist:claude' (the migrated 'default' account); accounts added later get
//  'claude-acct-<n>' partitions.
// ─────────────────────────────────────────────────────────────────────────────

function activeAccount() {
  return cfg.accounts.find(a => a.id === cfg.active_account) || cfg.accounts[0];
}

function getAccount(id) {
  return cfg.accounts.find(a => a.id === id) || null;
}

function sesFor(acct) {
  return session.fromPartition(`persist:${acct.partition}`);
}

function activeSes() { return sesFor(activeAccount()); }

// New ids/partitions are derived from a counter that only ever moves forward,
// so a removed account's partition (with any residual cookies) is never
// silently re-adopted by a future account.
function newAccountIdentity() {
  let n = 2;
  const taken = new Set(cfg.accounts.flatMap(a => [a.id, a.partition]));
  while (taken.has(`acct-${n}`) || taken.has(`claude-acct-${n}`)) n++;
  return { id: `acct-${n}`, partition: `claude-acct-${n}` };
}

function nextAccountLabel() {
  let n = cfg.accounts.length + 1;
  while (cfg.accounts.some(a => a.label === `Account ${n}`)) n++;
  return `Account ${n}`;
}

// Tell every open renderer the account roster changed (list, labels, active).
function broadcastAccounts() {
  const payload = { accounts: cfg.accounts, active_account: cfg.active_account };
  for (const win of [widgetWin, settingsWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('accounts-changed', payload);
  }
  refreshTrayMenu();
}

async function isLoggedIn(acct = activeAccount()) {
  if (MOCK) return true;
  try {
    const cookies = await sesFor(acct).cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
    return cookies.length > 0;
  } catch (_) { return false; }
}

async function doLogout(acct = activeAccount()) {
  try {
    await sesFor(acct).clearStorageData({ storages: ['cookies', 'localstorage'] });
    acct.org_id = '';
    acct.email  = '';
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

async function apiFetch(ses, url) {
  return ses.fetch(url, { headers: BASE_HDR, signal: AbortSignal.timeout(12000) });
}

async function fetchOrgId(ses) {
  if (MOCK) return { orgId: 'mock-org', err: null };
  try {
    const r = await apiFetch(ses, 'https://claude.ai/api/organizations');
    if (r.status === 403) return { orgId: null, err: '403' };
    const d = await r.json();
    if (Array.isArray(d) && d.length) return { orgId: d[0].uuid, err: null };
    return { orgId: null, err: 'No organizations found' };
  } catch (e) { return { orgId: null, err: e.message }; }
}

async function fetchUsage(ses, orgId, acctId) {
  if (MOCK) return { data: mockUsageFor(acctId), err: null };
  try {
    const r = await apiFetch(ses, `https://claude.ai/api/organizations/${orgId}/usage`);
    if (r.status === 403) return { data: null, err: '403' };
    return { data: await r.json(), err: null };
  } catch (e) { return { data: null, err: e.message }; }
}

// Best-effort lookup of the logged-in account's email so the settings panel
// and the account switcher can identify each login. claude.ai has moved this
// around between endpoints, so try the known ones in order and give up
// quietly — the user can always rename the account by hand.
async function fetchAccountEmail(ses) {
  if (MOCK) return 'mock@example.com';
  const candidates = [
    'https://claude.ai/api/account',
    'https://claude.ai/api/auth/current_account',
    'https://claude.ai/api/bootstrap',
  ];
  for (const url of candidates) {
    try {
      const r = await apiFetch(ses, url);
      if (!r.ok) continue;
      const d = await r.json();
      const email =
        d?.email_address || d?.email ||
        d?.account?.email_address || d?.account?.email ||
        d?.user?.email_address || d?.user?.email;
      if (email && typeof email === 'string') return email;
    } catch (_) {}
  }
  return '';
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
    return { s: null, w: null, fable: null, resets: '', weeklyResets: '', extraUsage: null };
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

  // ── Fable (model-scoped weekly window) ───────────────────────────────────
  // PRIMARY (current API, confirmed live 2026-07-16): the payload carries a
  // `limits` array with one entry per window. The per-model limit is the entry
  // whose scope names a model:
  //   { kind: "weekly_scoped", percent: 5, resets_at: "...",
  //     scope: { model: { display_name: "Fable" } } }
  // The old dedicated keys (seven_day_opus etc.) are all null in this format,
  // so we read the array first and keep the key-based lookups as fallbacks
  // for older payload shapes. The label shown on the bar comes from the API's
  // own display_name, so a future model rename shows up without an app update.
  let fable = null;
  {
    let found = false, frac = null, resetsAt = null, label = '';

    if (Array.isArray(raw.limits)) {
      const lim = raw.limits.find(l =>
        l && typeof l === 'object' && l.scope && l.scope.model);
      if (lim) {
        found    = true;
        frac     = (lim.percent !== null && lim.percent !== undefined)
                     ? Math.max(0, Math.min(1, lim.percent / 100)) : null;
        resetsAt = lim.resets_at || null;
        label    = lim.scope.model.display_name || 'Fable';
      }
    }

    // FALLBACKS: dedicated top-level blocks from older payload shapes
    if (!found) {
      let fw = null, fwKey = '';
      const known = ['fable', 'seven_day_fable', 'fable_seven_day', 'seven_day_opus'];
      for (const k of known) {
        if (raw[k] && typeof raw[k] === 'object' && 'utilization' in raw[k]) { fw = raw[k]; fwKey = k; break; }
      }
      if (!fw) {
        for (const [k, v] of Object.entries(raw)) {
          if (/fable|opus/i.test(k) && v && typeof v === 'object' && 'utilization' in v) { fw = v; fwKey = k; break; }
        }
      }
      if (fw) {
        found    = true;
        const u  = fw.utilization;
        frac     = (u !== null && u !== undefined) ? Math.max(0, Math.min(1, u / 100)) : null;
        resetsAt = fw.resets_at || null;
        label    = /opus/i.test(fwKey) ? 'Opus' : 'Fable';
      }
    }

    if (found) {
      let fresets = '';
      if (resetsAt) {
        try {
          const diffMs = new Date(resetsAt) - Date.now();
          const atStr  = localTimeStr(resetsAt);
          if (frac !== null && frac >= 1.0) {
            fresets = atStr ? `Limit reached  (resets ${atStr})` : 'Limit reached';
          } else if (diffMs > 0) {
            const totalH = Math.floor(diffMs / 3_600_000);
            const d      = Math.floor(totalH / 24);
            const h      = totalH % 24;
            const cd     = d > 0 ? `${d}d ${h}h` : `${h}h`;
            fresets      = atStr ? `Resets in ${cd}  (${atStr})` : `Resets in ${cd}`;
          } else {
            fresets = 'Resetting soon';
          }
        } catch (_) {}
      }
      fable = { frac, resets: fresets, resetsAt, label };
    }
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

  return { s, w, fable, resets, weeklyResets, extraUsage, sessionResetsAt, weeklyResetsAt };
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
  // A window the user isn't tracking shouldn't toast either — null it out so
  // the checks below skip it.
  if (!cfg.track_session) s = null;
  if (!cfg.track_weekly)  w = null;
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

    // Newer version available — always show regardless of silent flag.
    // Pull the release notes from the GitHub release body so the dialog can tell
    // the user WHY they should update (e.g. "Bug fixes"). Whatever you type into
    // the release description on GitHub shows up here. Falls back cleanly if the
    // release has no notes.
    const notes    = (data.body || '').trim();
    const whatsNew = notes ? `\n\nWhat's new in v${latest}:\n${notes}` : '';
    const { response } = await dialog.showMessageBox(widgetWin, {
      type:      'info',
      title:     'Update Available',
      message:   `Claude Usage Monitor v${latest} is available`,
      detail:    `You're running v${current}.${whatsNew}\n\nWould you like to open the download page?`,
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

  const acct = activeAccount();
  const ses  = sesFor(acct);

  const loggedIn = await isLoggedIn(acct);
  if (!loggedIn) {
    widgetWin?.webContents.send('usage-update', { status: 'no_session', accountId: acct.id });
    tray?.setToolTip('Claude Usage Monitor — not logged in');
    return;
  }

  if (!acct.org_id) {
    widgetWin?.webContents.send('usage-update', { status: 'connecting', accountId: acct.id });
    const { orgId, err } = await fetchOrgId(ses);
    if (orgId) { acct.org_id = orgId; saveConfig(); }
    else {
      if (err === '403') await doLogout(acct);
      widgetWin?.webContents.send('usage-update', {
        status: 'error', accountId: acct.id,
        message: err === '403' ? 'Session expired — please log in again' : friendlyNetError(err),
      });
      return;
    }
  }

  // Backfill the account email for logins that predate 1.0.3 (or where the
  // fetch failed at login time) so the switcher can identify the account.
  if (!acct.email) {
    fetchAccountEmail(ses).then(email => {
      if (email && !acct.email) {
        acct.email = email;
        saveConfig();
        broadcastAccounts();
      }
    }).catch(() => {});
  }

  const { data, err } = await fetchUsage(ses, acct.org_id, acct.id);

  // If the user switched accounts while this fetch was in flight, drop the
  // result — otherwise account A's numbers would land in account B's widget
  // and history file.
  if (cfg.active_account !== acct.id) return;

  if (err) {
    if (err === '403') { await doLogout(acct); }
    widgetWin?.webContents.send('usage-update', {
      status:  'error', accountId: acct.id,
      message: err === '403' ? 'Session expired — please log in again' : friendlyNetError(err),
    });
    return;
  }

  // Dev-only: dump the raw /usage payload to disk so unrecognized window keys
  // (e.g. whatever Anthropic calls the Fable window this week) can be
  // inspected. Inert unless the env var is set.
  if (process.env.CUM_DUMP_USAGE) {
    try {
      fs.writeFileSync(
        path.join(USER_DATA, `usage-dump-${acct.id}.json`),
        JSON.stringify(data, null, 2), 'utf8',
      );
    } catch (_) {}
  }

  const { s, w, fable, resets, weeklyResets, extraUsage, sessionResetsAt, weeklyResetsAt } = parseUsage(data);

  if (s === null && w === null) {
    console.log('[Claude Usage Monitor] Could not parse usage. Raw response:');
    console.log(JSON.stringify(data, null, 2));
  }

  const newPoint = appendHistory(s, w);
  maybeNotify(s, w);

  // Live usage in the tray tooltip — hovering the tray icon shows current
  // usage without opening the widget at all. Only tracked windows appear.
  // (Windows caps tooltips at 127 chars; this is well under.)
  const tipParts = [];
  if (cfg.track_session)          tipParts.push(`Session ${s     !== null ? Math.round(s * 100)          + '%' : '—'}`);
  if (cfg.track_weekly)           tipParts.push(`Weekly ${w      !== null ? Math.round(w * 100)          + '%' : '—'}`);
  if (cfg.track_fable && fable)   tipParts.push(`${fable.label || 'Fable'} ${fable.frac !== null ? Math.round(fable.frac * 100) + '%' : '—'}`);
  const acctTip = cfg.accounts.length > 1 ? ` — ${acct.label}` : '';
  tray?.setToolTip(`Claude Usage Monitor${acctTip}` + (tipParts.length ? `\n${tipParts.join('  ·  ')}` : ''));

  widgetWin?.webContents.send('usage-update', {
    status: 'ok', s, w, fable, resets, weeklyResets, extraUsage,
    sessionResetsAt, weeklyResetsAt,
    accountId: acct.id,
    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    point: newPoint,   // single new sample (or null) — renderer appends locally
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
//
//  Login always targets the ACTIVE account — adding an account switches to it
//  first, then opens this window on that account's (empty) session partition.
// ─────────────────────────────────────────────────────────────────────────────

// Set while a freshly-added account is in its first login. If the user closes
// the login window without completing it, the placeholder account is removed
// and the previously active account is restored.
let pendingNewAccount = null;   // { id, prevActiveId }

function navigateToLogin() {
  if (isInLoginFlow) return;
  isInLoginFlow = true;
  stopPolling();

  const acct = activeAccount();
  const ses  = sesFor(acct);

  // Close any stale login window
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.destroy();
    loginWin = null;
  }

  // Step down the widget (and the settings panel, which now hosts the
  // Add Account / Log in buttons) so the login window can sit on top
  widgetWin?.setAlwaysOnTop(false);
  settingsWin?.setAlwaysOnTop(false);

  loginWin = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    frame: true,
    title: `Log in to Claude — ${acct.label}`,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: ses,
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
    ses.cookies.off('changed', cookieWatcher);  // stop watching
    isInLoginFlow = false;
    const w = loginWin;
    loginWin = null;
    // Pre-hide widgetWin so it's ready to fade in cleanly after transition
    widgetWin?.setOpacity(0);
    await fadeWindow(w, 1, 0, 300);
    w?.close();
    await onLoginSuccess(acct);
  };

  // PRIMARY: fire the instant the sessionKey cookie is written to the session —
  // works for every login method (email, Google, etc.) without any race condition.
  const cookieWatcher = (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === 'sessionKey' && cookie.domain?.includes('claude.ai')) {
      completeLogin();
    }
  };
  ses.cookies.on('changed', cookieWatcher);

  // FALLBACK: if loginWin itself navigates to a post-login page (e.g. email flow),
  // check for the cookie one more time with a small delay to let it settle.
  loginWin.webContents.on('did-navigate', async (_, url) => {
    if (!url.includes('claude.ai')) return;
    if (url.includes('/login') || url.includes('/auth') || url.includes('/oauth')) return;
    // We're on claude.ai home — give the cookie store 500 ms to flush then check
    setTimeout(async () => {
      const cookies = await ses.cookies.get({ url: 'https://claude.ai', name: 'sessionKey' });
      if (cookies.length > 0) completeLogin();
    }, 500);
  });

  // ── OAuth popup handling (Google, etc.) ──────────────────────────────────
  // Explicitly pass the same session so cookies land in this account's partition
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
        session: ses,   // <-- critical: share same session
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

  // User closed the login window without completing login
  loginWin.on('closed', async () => {
    ses.cookies.off('changed', cookieWatcher);  // always clean up
    loginWin = null;
    widgetWin?.setAlwaysOnTop(cfg.always_on_top);
    settingsWin?.setAlwaysOnTop(true);
    if (isInLoginFlow) {
      isInLoginFlow = false;

      // A just-added account whose first login was abandoned is an empty
      // shell — remove it and put the previously active account back.
      if (pendingNewAccount && pendingNewAccount.id === cfg.active_account) {
        const prevId = pendingNewAccount.prevActiveId;
        cfg.accounts = cfg.accounts.filter(a => a.id !== pendingNewAccount.id);
        pendingNewAccount = null;
        if (getAccount(prevId)) cfg.active_account = prevId;
        else if (cfg.accounts.length) cfg.active_account = cfg.accounts[0].id;
        resetHistoryCache();
        notified = {};
        saveConfig();
        broadcastAccounts();
      }
      pendingNewAccount = null;

      // Land wherever the (possibly restored) active account should be:
      // bars if it's logged in, the login screen if not.
      if (await isLoggedIn()) {
        resizeWidget(340, 230);
        widgetWin?.loadFile(path.join(SRC, 'widget.html'));
        widgetWin?.webContents.once('did-finish-load', () => startPolling());
      } else {
        resizeWidget(340, 450);   // logged-out (taller) layout
        widgetWin?.center();
        widgetWin?.loadFile(path.join(SRC, 'login-screen.html'));
      }
    }
  });
}

async function onLoginSuccess(acct) {
  isInLoginFlow = false;
  pendingNewAccount = null;
  acct.org_id = '';
  saveConfig();

  // Grab the account's email in the background so the switcher and settings
  // panel can identify it. Non-blocking — the widget shouldn't wait on this.
  fetchAccountEmail(sesFor(acct)).then(email => {
    if (email) {
      acct.email = email;
      saveConfig();
      broadcastAccounts();
    }
  }).catch(() => {});
  broadcastAccounts();

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
      session:          activeSes(),
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

function buildTrayMenu() {
  const template = [
    { label: 'Show / Hide',           click: () => widgetWin?.isVisible() ? widgetWin.hide() : widgetWin?.show() },
    { label: 'Refresh Now',           click: poll },
    { label: 'Check for Updates',     click: () => checkForUpdates(false) },
  ];

  // Quick account switching straight from the tray when there's more than one
  if (cfg.accounts.length > 1) {
    template.push({ type: 'separator' });
    template.push({
      label: 'Switch Account',
      submenu: cfg.accounts.map(a => ({
        label:   a.email ? `${a.label} — ${a.email}` : a.label,
        type:    'radio',
        checked: a.id === cfg.active_account,
        click:   () => switchAccount(a.id),
      })),
    });
  }

  template.push(
    { type:  'separator' },
    { label: 'Settings',              click: createSettingsWindow },
    { type:  'separator' },
    { label: 'Quit Claude Usage Monitor', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(template);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

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
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => widgetWin?.isVisible() ? widgetWin.hide() : widgetWin?.show());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Account operations
// ─────────────────────────────────────────────────────────────────────────────

// Point the widget at whatever the active account's state calls for:
// the bars view when logged in, the login screen when not.
async function showWidgetForActiveAccount() {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  if (await isLoggedIn()) {
    resizeWidget(340, 230);
    widgetWin.loadFile(path.join(SRC, 'widget.html'));
    widgetWin.webContents.once('did-finish-load', () => startPolling());
  } else {
    stopPolling();
    resizeWidget(340, 450);
    widgetWin.loadFile(path.join(SRC, 'login-screen.html'));
  }
}

async function switchAccount(id) {
  if (isInLoginFlow) return;
  if (id === cfg.active_account || !getAccount(id)) return;
  stopPolling();
  resetHistoryCache();      // flush the outgoing account's samples first
  notified = {};
  cfg.active_account = id;
  saveConfig();
  broadcastAccounts();
  await showWidgetForActiveAccount();
}

async function addAccount() {
  if (isInLoginFlow) return;
  const { id, partition } = newAccountIdentity();
  const acct = { id, label: nextAccountLabel(), email: '', partition, org_id: '' };
  pendingNewAccount = { id, prevActiveId: cfg.active_account };
  cfg.accounts.push(acct);
  stopPolling();
  resetHistoryCache();
  notified = {};
  cfg.active_account = id;
  saveConfig();
  broadcastAccounts();
  navigateToLogin();
}

async function logoutAccount(id) {
  const acct = getAccount(id);
  if (!acct) return;
  await doLogout(acct);
  broadcastAccounts();
  if (acct.id === cfg.active_account) {
    notified = {};
    stopPolling();
    await showWidgetForActiveAccount();   // will land on the login screen
  }
}

async function removeAccount(id) {
  const acct = getAccount(id);
  if (!acct || isInLoginFlow) return;
  const wasActive = acct.id === cfg.active_account;

  if (wasActive) {
    stopPolling();
    resetHistoryCache();
  }
  await doLogout(acct);

  // The account's history goes with it
  const hf = historyFileFor(acct);
  for (const p of [hf, hf + '.bak']) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }

  cfg.accounts = cfg.accounts.filter(a => a.id !== id);
  // Always keep at least one account slot so the app has somewhere to log in
  if (cfg.accounts.length === 0) {
    cfg.accounts.push({ id: 'default', label: 'Account 1', email: '', partition: 'claude', org_id: '' });
  }
  if (wasActive) {
    cfg.active_account = cfg.accounts[0].id;
    resetHistoryCache();
    notified = {};
  }
  saveConfig();
  broadcastAccounts();
  if (wasActive) await showWidgetForActiveAccount();
}

function renameAccount(id, label) {
  const acct = getAccount(id);
  const clean = String(label || '').trim().slice(0, 32);
  if (!acct || !clean) return;
  acct.label = clean;
  saveConfig();
  broadcastAccounts();
}

// ─────────────────────────────────────────────────────────────────────────────
//  IPC
// ─────────────────────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle('get-config',      () => ({ ...cfg, coffee_url: COFFEE_URL }));
  ipcMain.handle('get-history',     () => loadHistory());
  ipcMain.handle('get-login-status',() => isLoggedIn());
  ipcMain.handle('get-version',     () => app.getVersion());

  // Per-account login state for the settings account list
  ipcMain.handle('get-accounts-status', async () => {
    const out = [];
    for (const a of cfg.accounts) out.push({ id: a.id, loggedIn: await isLoggedIn(a) });
    return out;
  });

  ipcMain.handle('save-config', (_, patch) => {
    const prev = cfg.refresh_interval;
    cfg = { ...cfg, ...patch };
    saveConfig();
    if (patch.always_on_top !== undefined)     widgetWin?.setAlwaysOnTop(cfg.always_on_top);
    if (patch.launch_on_startup !== undefined)  applyStartup(cfg.launch_on_startup);
    if (patch.refresh_interval  !== undefined && patch.refresh_interval !== prev) startPolling();
    // Tracked-window toggles change what the widget shows — tell it so it can
    // re-render its bars from the last data without waiting for the next poll.
    const trackKeys = ['track_session', 'track_weekly', 'track_extra', 'track_fable'];
    if (trackKeys.some(k => patch[k] !== undefined)) {
      if (widgetWin && !widgetWin.isDestroyed()) {
        widgetWin.webContents.send('config-changed', { ...cfg });
      }
      poll();   // refresh tray tooltip with the new set of tracked windows
    }
    return { ...cfg };
  });

  // ── Accounts ──────────────────────────────────────────────────────────────
  ipcMain.on('switch-account',  (_, id)        => switchAccount(id));
  ipcMain.on('add-account',     ()             => addAccount());
  ipcMain.on('remove-account',  (_, id)        => removeAccount(id));
  ipcMain.on('rename-account',  (_, id, label) => renameAccount(id, label));
  ipcMain.on('logout-account',  (_, id)        => logoutAccount(id));
  ipcMain.on('login-account',   async (_, id)  => {
    if (id && id !== cfg.active_account) await switchAccount(id);
    navigateToLogin();
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
  // (Windows restart/crash leaves these behind, causing 0x80000003 crash on
  // next launch). Every account has its own partition, so sweep them all.
  try {
    const partitionsRoot = path.join(app.getPath('userData'), 'Partitions');
    const partitionDirs = fs.existsSync(partitionsRoot) ? fs.readdirSync(partitionsRoot) : [];
    for (const dir of partitionDirs) {
      const partitionPath = path.join(partitionsRoot, dir);
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
  startHistoryFlushTimer();
  // NOTE: startPolling() is called inside createWidgetWindow()'s did-finish-load
  // handler, ensuring poll() only fires after widget.js has registered its listeners.

  // ── Update check ─────────────────────────────────────────────────────────
  // Deferred 5 seconds so the widget is fully loaded and the first poll has
  // already fired before any dialog could appear. Then re-checked once a day:
  // this is a tray app that users leave running for weeks, so a startup-only
  // check would never reach always-on users.
  setTimeout(() => checkForUpdates(), 5000);
  setInterval(() => checkForUpdates(), 24 * 3_600_000);
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
  // Flush any unsaved history samples to disk before we exit.
  if (historyFlushTimer) { clearInterval(historyFlushTimer); historyFlushTimer = null; }
  flushHistory();
  // Flush every account's session to disk so LevelDB closes cleanly before exit
  for (const a of cfg.accounts || []) {
    try { sesFor(a).flushStorageData(); } catch (_) {}
  }
});
