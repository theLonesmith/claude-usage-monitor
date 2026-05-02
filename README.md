# Claude Usage Monitor

A lightweight Windows desktop widget that tracks your Claude.ai session and weekly usage limits in real time — with toast alerts, a usage history graph, and system tray support.

> **Not affiliated with or endorsed by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.**

[![Downloads](https://img.shields.io/github/downloads/theLonesmith/claude-usage-monitor/total?color=blue)](https://github.com/theLonesmith/claude-usage-monitor/releases/latest)

<a href="https://www.producthunt.com/products/claude-usage-monitor-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-claude-usage-monitor-2" target="_blank" rel="noopener noreferrer"><img alt="Claude Usage Monitor - Never get caught off guard by Claude's usage limits again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1131059&theme=light&t=1776987238395"></a>

---

## Download

👉 **[Download the latest installer from Releases](../../releases/latest)**

Just download the `.exe` installer and run it. No Node.js, no terminal, nothing else required.

> Windows may show a SmartScreen warning. Click "More info" → "Run anyway".

---

## Screenshots / Demo Video

<table>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/1-tray-menu.png" alt="Tray Menu"/><br/>
      <sub><b>System tray context menu</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/2-usage-bars.png" alt="Usage Bars"/><br/>
      <sub><b>Live session & weekly usage bars</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/3-history-8hrs.png" alt="History Chart"/><br/>
      <sub><b>Usage history — past 8 hours</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/4-weekly-breakdown.png" alt="Weekly Breakdown"/><br/>
      <sub><b>Weekly usage breakdown by day</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/5-settings.png" alt="Settings"/><br/>
      <sub><b>Settings & notification thresholds</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/6-login-screen.png" alt="Login Screen"/><br/>
      <sub><b>Login screen</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <video src="https://github.com/user-attachments/assets/6873df67-fb4a-4ac9-aa46-e38c8e96e1ce" controls width="100%"></video><br/>
      <sub><b>Claude Usage Monitor in action</b></sub>
    </td>
  </tr>
</table>

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

## Requirements

- Windows 10 or 11
- An active Claude.ai account

---

## How It Works

Runs an embedded browser session logged into Claude.ai and reads your usage data directly from the page — no API keys, no third-party servers.

---

## Building from Source

If you'd prefer to audit or build the app yourself:

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

## Privacy & Security

- **Your data never leaves your machine.** The app only communicates directly with `claude.ai` — no third-party servers, no analytics, no telemetry.
- **No API keys required.** The app uses the same browser session you'd use normally — it reads your usage data directly from the page.
- **Your login is stored locally.** Your Claude.ai session is stored in an isolated Electron session on your own PC, the same way a browser stores a cookie.
- All data is stored locally on your machine (`%AppData%\Claude Usage Monitor\`)
- Uninstalling removes the program files; your AppData folder is kept so you can reinstall without re-logging in (delete it manually if you want a clean wipe)
- **SHA256 hash available** on the [releases page](../../releases/latest) if you'd like to verify your download hasn't been tampered with.

> If you have specific security questions, feel free to [email me](mailto:hello@lonesmith.com).

---

## Found a Bug?

[Email Me](mailto:hello@lonesmith.com?subject=Bug%20Report%20%E2%80%94%20Claude%20Usage%20Monitor&body=App%20Version%3A%20v1.0.1%0AWindows%20Version%3A%20%0A%0ASteps%20to%20reproduce%3A%0A1.%20%0A2.%20%0A%0AExpected%20behavior%3A%0A%0A%0AWhat%20actually%20happened%3A%0A%0A%0A(Attach%20a%20screenshot%20if%20helpful)) with your Windows version and a description of what happened.

---

## Disclaimer

This is an **unofficial, community-built tool**. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" is a registered trademark of Anthropic, PBC. This app connects to Claude.ai using the same browser-based session API your web browser uses — it is not an official Anthropic product and does not use the Anthropic developer API.

---

## License

MIT — free to use, modify, and distribute.

---

☕ If this saves you from hitting the limit mid-conversation, consider [buying me a coffee](https://buymeacoffee.com/lonesmith)!

*Built by [Lonesmith](https://buymeacoffee.com/lonesmith)*
