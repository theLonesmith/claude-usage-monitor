<a href="https://www.producthunt.com/products/claude-usage-monitor-2?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-claude-usage-monitor-2" target="_blank" rel="noopener noreferrer"><img alt="Claude Usage Monitor - Never get caught off guard by Claude's usage limits again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1131059&amp;theme=light&amp;t=1776987238395"></a>

# Claude Usage Monitor

Never get caught off guard by Claude's usage limits again.

A Windows desktop widget that monitors your Claude.ai session and weekly 
usage limits in real-time. Sits in the system tray — always available, 
never in the way.

[![Download](https://img.shields.io/github/downloads/theLonesmith/claude-usage-monitor/total?label=Downloads&color=blue)](https://github.com/theLonesmith/claude-usage-monitor/releases/latest)

## Download

**[⬇ Download Claude Usage Monitor Setup 1.0.1.exe](https://github.com/theLonesmith/claude-usage-monitor/releases/latest)**

> Windows may show a SmartScreen warning. Click "More info" → "Run anyway".

## Screenshots

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
</table>

## Features

- Live session and weekly usage bars on your desktop
- Usage history charts (past 8 hours + weekly breakdown by day)
- System tray integration
- Launch on startup with optional start minimized
- Auto-checks for updates on launch

## Requirements

- Windows 10 or 11
- An active Claude.ai account

## How It Works

Runs an embedded browser session logged into Claude.ai and reads your 
usage data directly from the page — no API keys, no third-party servers.

## Privacy & Security

- **Your data never leaves your machine.** The app only communicates directly with `claude.ai` — no third-party servers, no analytics, no telemetry.
- **No API keys required.** The app uses the same browser session you'd use normally — it reads your usage data directly from the page.
- **Your login is stored locally.** Your Claude.ai session is stored in an isolated Electron session on your own PC, the same way a browser stores a cookie.
- **SHA256 hash available** on the [releases page](https://github.com/theLonesmith/claude-usage-monitor/releases/latest) if you'd like to verify your download hasn't been tampered with.
- **Not affiliated with Anthropic.** This is an independent community-built tool. "Claude" is a trademark of Anthropic, PBC.

> If you have specific security questions, feel free to [email me](mailto:hello@lonesmith.com).

## Found a Bug?

[Email Me](mailto:hello@lonesmith.com?subject=Bug%20Report%20%E2%80%94%20Claude%20Usage%20Monitor&body=App%20Version%3A%20v1.0.0%0AWindows%20Version%3A%20%0A%0ASteps%20to%20reproduce%3A%0A1.%20%0A2.%20%0A%0AExpected%20behavior%3A%0A%0A%0AWhat%20actually%20happened%3A%0A%0A%0A(Attach%20a%20screenshot%20if%20helpful)) with your Windows version and a description of what happened.


---

☕ If this saves you from hitting the limit mid-conversation, consider 
[buying me a coffee](https://buymeacoffee.com/lonesmith)!
