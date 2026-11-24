// preload.js — Context bridge
// IMPORTANT: Only expose our API to local file:// pages, never to external sites.
// This prevents claude.ai (loaded during login) from accessing our IPC bridge.

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('claude', {
    getConfig:            ()      => ipcRenderer.invoke('get-config'),
    getVersion:           ()      => ipcRenderer.invoke('get-version'),
    saveConfig:           (patch) => ipcRenderer.invoke('save-config', patch),
    getHistory:           ()      => ipcRenderer.invoke('get-history'),
    getLoginStatus:       ()      => ipcRenderer.invoke('get-login-status'),
    getAccountsStatus:    ()      => ipcRenderer.invoke('get-accounts-status'),
    openLogin:            ()      => ipcRenderer.send('open-login'),
    switchAccount:        (id)    => ipcRenderer.send('switch-account', id),
    addAccount:           ()      => ipcRenderer.send('add-account'),
    removeAccount:        (id)    => ipcRenderer.send('remove-account', id),
    renameAccount:        (id, label) => ipcRenderer.send('rename-account', id, label),
    logoutAccount:        (id)    => ipcRenderer.send('logout-account', id),
    loginAccount:         (id)    => ipcRenderer.send('login-account', id),
    openSettings:         ()      => ipcRenderer.send('open-settings'),
    closeSettings:        ()      => ipcRenderer.send('close-settings'),
    hideWidget:           ()      => ipcRenderer.send('hide-widget'),
    openUrl:              (url)   => ipcRenderer.send('open-url', url),
    manualRefresh:        ()      => ipcRenderer.send('manual-refresh'),
    checkForUpdates:      ()      => ipcRenderer.send('check-for-updates'),
    resizeForBars:        (h)     => ipcRenderer.send('resize-for-bars', h),
    closeOnboarding:      ()      => ipcRenderer.send('close-onboarding'),
    onUsageUpdate:        (fn)    => ipcRenderer.on('usage-update',         (_, d) => fn(d)),
    onLoginSuccess:       (fn)    => ipcRenderer.on('login-success',        ()     => fn()),
    onHideCtx:            (fn)    => ipcRenderer.on('hide-ctx',             ()     => fn()),
    onAccountsChanged:    (fn)    => ipcRenderer.on('accounts-changed',     (_, d) => fn(d)),
    onConfigChanged:      (fn)    => ipcRenderer.on('config-changed',       (_, d) => fn(d)),
  });
}
