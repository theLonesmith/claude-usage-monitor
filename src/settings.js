// settings.js — renderer for the settings panel

// ── DOM refs ──────────────────────────────────────────────────────────────
const loggedInEl   = document.getElementById('state-logged-in');
const loggedOutEl  = document.getElementById('state-logged-out');
const btnLogin     = document.getElementById('btn-login');
const btnLogout    = document.getElementById('btn-logout');

document.getElementById('btn-close-settings')
  .addEventListener('click', () => window.claude.closeSettings());

const notifEnabled = document.getElementById('notif-enabled');
const notifThresh  = document.getElementById('notif-thresholds');

const sWarn        = document.getElementById('s-warn');
const sDanger      = document.getElementById('s-danger');
const wWarn        = document.getElementById('w-warn');
const wDanger      = document.getElementById('w-danger');
const sWarnVal     = document.getElementById('s-warn-val');
const sDangerVal   = document.getElementById('s-danger-val');
const wWarnVal     = document.getElementById('w-warn-val');
const wDangerVal   = document.getElementById('w-danger-val');

const prefAot      = document.getElementById('pref-aot');
const prefStartup  = document.getElementById('pref-startup');
const prefStartMin = document.getElementById('pref-start-min');
const rowStartMin  = document.getElementById('row-start-min');
const prefUpdates  = document.getElementById('pref-updates');
const prefInterval = document.getElementById('pref-interval');
const btnCoffee    = document.getElementById('btn-coffee');

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const [cfg, loggedIn, version] = await Promise.all([
    window.claude.getConfig(),
    window.claude.getLoginStatus(),
    window.claude.getVersion(),
  ]);

  // Update footer version from live package.json — never hardcoded
  const verEl = document.getElementById('about-version');
  if (verEl) verEl.textContent = `v${version}`;

  applyLoginState(loggedIn);
  applyConfig(cfg);
  bindAll(cfg, version);
}

// ── Apply login state ─────────────────────────────────────────────────────
function applyLoginState(loggedIn) {
  loggedInEl.classList.toggle('hidden', !loggedIn);
  loggedOutEl.classList.toggle('hidden',  loggedIn);
}

// ── Apply config to UI ────────────────────────────────────────────────────
function applyConfig(cfg) {
  notifEnabled.checked = cfg.notifications_enabled;
  notifThresh.classList.toggle('disabled', !cfg.notifications_enabled);

  sWarn.value   = cfg.session_warn_pct;
  sDanger.value = cfg.session_danger_pct;
  wWarn.value   = cfg.weekly_warn_pct;
  wDanger.value = cfg.weekly_danger_pct;
  sWarnVal.textContent   = `${cfg.session_warn_pct}%`;
  sDangerVal.textContent = `${cfg.session_danger_pct}%`;
  wWarnVal.textContent   = `${cfg.weekly_warn_pct}%`;
  wDangerVal.textContent = `${cfg.weekly_danger_pct}%`;

  prefAot.checked       = cfg.always_on_top;
  prefStartup.checked   = cfg.launch_on_startup;
  prefStartMin.checked  = cfg.start_minimized;
  prefUpdates.checked   = cfg.check_for_updates;
  prefInterval.value    = String(cfg.refresh_interval || 60);

  // "Start Minimized" only has meaning when Launch-on-Startup is on.
  // Gray it out when startup is off to signal that relationship.
  updateStartMinEnabled();
}

// Visually and functionally disable the Start-Minimized toggle when
// Launch-on-Startup is off. Keeps the saved value intact — we only toggle
// the interaction state, not the checkbox's checked value.
function updateStartMinEnabled() {
  const enabled = prefStartup.checked;
  prefStartMin.disabled = !enabled;
  rowStartMin.classList.toggle('disabled', !enabled);
}

// ── Bind all controls ─────────────────────────────────────────────────────
function bindAll(cfg, version) {
  // Login / Logout
  btnLogin.addEventListener('click', () => window.claude.openLogin());
  btnLogout.addEventListener('click', async () => {
    btnLogout.textContent = 'Logging out…';
    btnLogout.disabled    = true;
    window.claude.logout();
    // loginStatusChanged event will update the UI
  });

  // Notifications master toggle
  notifEnabled.addEventListener('change', async () => {
    await window.claude.saveConfig({ notifications_enabled: notifEnabled.checked });
    notifThresh.classList.toggle('disabled', !notifEnabled.checked);
  });

  // Threshold sliders — save on input
  const sliderMap = [
    [sWarn,   sWarnVal,   'session_warn_pct'   ],
    [sDanger, sDangerVal, 'session_danger_pct' ],
    [wWarn,   wWarnVal,   'weekly_warn_pct'    ],
    [wDanger, wDangerVal, 'weekly_danger_pct'  ],
  ];
  for (const [slider, label, key] of sliderMap) {
    slider.addEventListener('input', () => {
      label.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', async () => {
      await window.claude.saveConfig({ [key]: +slider.value });
    });
  }

  // Preferences toggles
  prefAot.addEventListener('change', async () => {
    await window.claude.saveConfig({ always_on_top: prefAot.checked });
  });
  prefStartup.addEventListener('change', async () => {
    await window.claude.saveConfig({ launch_on_startup: prefStartup.checked });
    // Re-evaluate the Start-Minimized row's enabled state — it follows
    // the startup toggle.
    updateStartMinEnabled();
  });
  prefStartMin.addEventListener('change', async () => {
    await window.claude.saveConfig({ start_minimized: prefStartMin.checked });
  });
  prefUpdates.addEventListener('change', async () => {
    await window.claude.saveConfig({ check_for_updates: prefUpdates.checked });
  });

  // Refresh interval
  prefInterval.addEventListener('change', async () => {
    await window.claude.saveConfig({ refresh_interval: +prefInterval.value });
  });

  // Buy Me a Coffee — URL comes from config (DEFAULTS.coffee_url) so it's
  // changeable in one place instead of being hardcoded here.
  btnCoffee.addEventListener('click', () => {
    window.claude.openUrl(cfg.coffee_url || 'https://buymeacoffee.com/lonesmith');
  });

  // Bug report — opens a pre-addressed email with a structured report template
  document.getElementById('btn-bug').addEventListener('click', e => {
    e.preventDefault();
    const subject = `Bug Report — Claude Usage Monitor v${version}`;
    const body = [
      `App Version: v${version}`,
      `Windows Version: (e.g. Windows 11 24H2)`,
      ``,
      `Steps to reproduce:`,
      `1. `,
      `2. `,
      ``,
      `Expected behavior:`,
      ``,
      ``,
      `What actually happened:`,
      ``,
      ``,
      `(Attach a screenshot if helpful)`,
    ].join('\r\n');
    window.claude.openUrl(
      `mailto:hello@lonesmith.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    );
  });
}

// ── Listen for events from main ───────────────────────────────────────────
window.claude.onLoginSuccess(() => {
  applyLoginState(true);
});

window.claude.onLoginStatusChanged(loggedIn => {
  applyLoginState(loggedIn);
  if (!loggedIn) {
    btnLogout.textContent = 'Log out';
    btnLogout.disabled    = false;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
init();
