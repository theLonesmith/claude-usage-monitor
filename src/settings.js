// settings.js — renderer for the settings panel

// ── DOM refs ──────────────────────────────────────────────────────────────
const accountsList  = document.getElementById('accounts-list');
const btnAddAccount = document.getElementById('btn-add-account');

document.getElementById('btn-close-settings')
  .addEventListener('click', () => window.claude.closeSettings());

const trackSession = document.getElementById('track-session');
const trackWeekly  = document.getElementById('track-weekly');
const trackFable   = document.getElementById('track-fable');
const trackExtra   = document.getElementById('track-extra');

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
  const [cfg, version] = await Promise.all([
    window.claude.getConfig(),
    window.claude.getVersion(),
  ]);

  // Update footer version from live package.json — never hardcoded
  const verEl = document.getElementById('about-version');
  if (verEl) verEl.textContent = `v${version}`;

  applyConfig(cfg);
  bindAll(cfg, version);
  await renderAccounts();
}

// ── Accounts list ──────────────────────────────────────────────────────────
//
// One card per account: label (with inline rename), email, Active/Connected
// pills, and per-account actions. Rebuilt from scratch on every change —
// the list is tiny, so simplicity wins over DOM diffing. Built with
// createElement/textContent (labels and emails are data, never markup).
async function renderAccounts() {
  const [cfg, statuses] = await Promise.all([
    window.claude.getConfig(),
    window.claude.getAccountsStatus(),
  ]);
  const loggedInById = Object.fromEntries(statuses.map(s => [s.id, s.loggedIn]));

  accountsList.innerHTML = '';

  for (const a of (cfg.accounts || [])) {
    const isActive = a.id === cfg.active_account;
    const loggedIn = !!loggedInById[a.id];

    const card = document.createElement('div');
    card.className = 'acct-card' + (isActive ? ' acct-card-active' : '');

    // ── Top row: identity + status pills ───────────────────────────────────
    const top = document.createElement('div');
    top.className = 'acct-top';

    const idCol = document.createElement('div');
    idCol.className = 'acct-id';

    const labelRow = document.createElement('div');
    labelRow.className = 'acct-label-row';
    const label = document.createElement('span');
    label.className = 'acct-label';
    label.textContent = a.label;
    const renameBtn = document.createElement('button');
    renameBtn.className = 'acct-rename';
    renameBtn.title = 'Rename this account';
    renameBtn.textContent = '✎';
    labelRow.appendChild(label);
    labelRow.appendChild(renameBtn);

    const email = document.createElement('div');
    email.className = 'acct-email';
    email.textContent = a.email || (loggedIn ? 'Logged in' : 'Not logged in yet');

    idCol.appendChild(labelRow);
    idCol.appendChild(email);

    const pills = document.createElement('div');
    pills.className = 'acct-pills';
    if (isActive) {
      const p = document.createElement('span');
      p.className = 'pill pill-accent';
      p.textContent = 'Active';
      pills.appendChild(p);
    }
    const status = document.createElement('span');
    status.className = 'pill ' + (loggedIn ? 'pill-green' : 'pill-red');
    status.textContent = loggedIn ? '● Connected' : '● Not connected';
    pills.appendChild(status);

    top.appendChild(idCol);
    top.appendChild(pills);
    card.appendChild(top);

    // ── Inline rename ───────────────────────────────────────────────────────
    renameBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.className = 'acct-rename-input';
      input.maxLength = 32;
      input.value = a.label;
      labelRow.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const val = input.value.trim();
        if (val && val !== a.label) window.claude.renameAccount(a.id, val);
        else renderAccounts();   // restore the label row unchanged
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  commit();
        if (e.key === 'Escape') { done = true; renderAccounts(); }
      });
      input.addEventListener('blur', commit);
    });

    // ── Action buttons ──────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'acct-actions';

    const addBtn = (text, cls, onClick) => {
      const b = document.createElement('button');
      b.className = `btn-sm ${cls}`;
      b.textContent = text;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };

    if (!isActive)  addBtn('Switch to', 'btn-sm-accent', () => window.claude.switchAccount(a.id));
    if (!loggedIn)  addBtn('Log in',    'btn-sm-accent', () => window.claude.loginAccount(a.id));
    if (loggedIn)   addBtn('Log out',   'btn-sm-plain',  () => window.claude.logoutAccount(a.id));
    addBtn('Remove', 'btn-sm-danger', () => {
      if (confirm(`Remove "${a.label}"${a.email ? ` (${a.email})` : ''}?\n\nThis logs the account out and deletes its usage history from this computer.`)) {
        window.claude.removeAccount(a.id);
      }
    });

    card.appendChild(actions);
    accountsList.appendChild(card);
  }
}

// ── Apply config to UI ────────────────────────────────────────────────────
function applyConfig(cfg) {
  trackSession.checked = cfg.track_session !== false;
  trackWeekly.checked  = cfg.track_weekly  !== false;
  trackFable.checked   = cfg.track_fable   !== false;
  trackExtra.checked   = cfg.track_extra   !== false;

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
  // Accounts
  btnAddAccount.addEventListener('click', () => window.claude.addAccount());

  // Tracked usage windows
  const trackMap = [
    [trackSession, 'track_session'],
    [trackWeekly,  'track_weekly' ],
    [trackFable,   'track_fable'  ],
    [trackExtra,   'track_extra'  ],
  ];
  for (const [toggle, key] of trackMap) {
    toggle.addEventListener('change', async () => {
      await window.claude.saveConfig({ [key]: toggle.checked });
    });
  }

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

  // Buy Me a Coffee — URL is the COFFEE_URL constant in main.js, injected
  // into the config object by the get-config handler.
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
window.claude.onLoginSuccess(() => { renderAccounts(); });
window.claude.onAccountsChanged(() => { renderAccounts(); });

// ── Boot ──────────────────────────────────────────────────────────────────
init();
