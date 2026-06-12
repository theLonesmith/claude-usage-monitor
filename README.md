# Claude Usage Monitor

A lightweight Windows desktop widget that tracks your Claude.ai session and weekly usage limits in real time — with toast alerts, a usage history graph, and system tray support.

> **Not affiliated with or endorsed by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.**

---

## Download

👉 **[Download the latest installer from Releases](../../releases/latest)**

Just download the `.exe` installer and run it. No Node.js, no terminal, nothing else required.

---

## Features

- **Session usage bar** — 5-hour window showing % used and time until reset
- **Weekly usage bar** — 7-day window showing % used and time until reset
- **Usage history graph** — 8-hour or 7-day sparkline chart
- **Toast notifications** — configurable alerts at warning and critical thresholds
- **Always on top** — stays visible above other windows (toggle in Settings)
- **System tray** — minimize out of the way, always accessible
- **Launch on startup** — auto-starts with Windows, optionally minimized to tray
- **Draggable** — drag the title bar to position the widget anywhere on screen
- **One-click login** — logs in to Claude.ai directly inside the app

---

## Installation

1. Download the installer (`.exe`) from the [Releases page](../../releases/latest)
2. Double-click the installer and follow the prompts (no admin rights required)
3. Launch **Claude Usage Monitor** from your Start Menu or Desktop shortcut
4. Click **Login with Claude** and log in to your Claude.ai account
5. The widget begins showing your live usage immediately

---

## Usage

**System tray:**
- **Left-click** the tray icon → show / hide the widget
- **Right-click** the tray icon → Refresh, Settings, or Quit

**Settings** (gear icon in the widget):

| Setting | Description |
|---|---|
| Login / Logout | Connect or disconnect your Claude.ai account |
| Allow Notifications | Master on/off toggle for Windows toast alerts |
| Session warning % | Amber bar threshold (default 75%) |
| Session critical % | Red bar + toast threshold (default 95%) |
| Weekly warning % | Same thresholds for the 7-day bar |
| Weekly critical % | |
| Always on Top | Keep widget above all other windows |
| Launch on Startup | Auto-start with Windows |
| Start Minimized | Start hidden to tray (only applies when Launch on Startup is on) |
| Refresh Interval | How often to poll Claude.ai (default: 1 minute) |

---

## Troubleshooting

**Installer doesn't seem to do anything when double-clicked**
→ Because the installer is not code-signed, Windows Defender scans the file before allowing it to run. This can take 10-30 seconds on the first launch with no visible indication. **Double-click once and wait** — don't click multiple times or you'll queue up multiple instances. If a "Windows protected your PC" dialog appears, click **More info → Run anyway**. This is a one-time delay; subsequent launches are instant.

**Widget shows "—" after logging in**
→ The app uses Claude.ai's internal browser API. If the format has changed, check the console (right-click widget → Inspect, then Console tab) and [open a bug report](../../issues).

**"Not logged in" right after logging in**
→ The login window may not have caught the session. Close it and try again, making sure to complete the full login and reach the Claude.ai main page.

**Session expired message**
→ Claude.ai sessions expire periodically. Click Login — it takes a few seconds.

**App doesn't start after install**
→ Try launching from the Start Menu. If nothing happens, check Windows Event Viewer or [open a bug report](../../issues).

---

## Privacy

- All data is stored **locally** on your machine (`%AppData%\Claude Usage Monitor\`)
- Nothing is sent to any third-party server — this app talks only to `claude.ai`
- Your Claude.ai session cookie is stored in an isolated Electron session partition
- Uninstalling removes the program files; your AppData folder is kept so you can reinstall without re-logging in (delete it manually if you want a clean wipe)

---

## Building from Source

If you'd prefer to build the installer yourself:

**Prerequisites:** [Node.js LTS](https://nodejs.org) (v18 or later)

```
1. Clone or download this repository
2. Double-click setup.bat   (installs dependencies — ~200 MB, one time only)
3. Double-click build.bat   (compiles the installer — accept the UAC prompt)
4. Find your installer in the dist\ folder
```

For development / running without building:
```
Double-click run.bat
```

---

## Disclaimer

This is an **unofficial, community-built tool**. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" is a registered trademark of Anthropic, PBC. This app connects to Claude.ai using the same browser-based session API your web browser uses — it is not an official Anthropic product and does not use the Anthropic developer API.

---

## License

MIT — free to use, modify, and distribute.

---

*Built by [Lonesmith](https://buymeacoffee.com/lonesmith)*
