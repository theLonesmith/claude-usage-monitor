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
    openLogin:            ()      => ipcRenderer.send('open-login'),
    logout:               ()      => ipcRenderer.send('logout'),
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
    onLoginStatusChanged: (fn)    => ipcRenderer.on('login-status-changed', (_, v) => fn(v)),
    onHideCtx:            (fn)    => ipcRenderer.on('hide-ctx',             ()     => fn()),
  });
}
