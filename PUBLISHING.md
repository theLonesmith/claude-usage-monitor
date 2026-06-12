# Publishing Guide — Claude Usage Monitor

This is your personal step-by-step guide for getting the app onto GitHub and releasing updates. Keep this file — you'll refer back to it every time you ship a new version.

---

## First-Time Setup (do this once)

### Step 1 — Create a GitHub account

1. Go to **https://github.com** and click **Sign up**
2. Choose a username (this becomes part of your repo URL, e.g. `github.com/lonesmith`)
3. Verify your email and complete the setup

---

### Step 2 — Create a new repository

1. Once logged in, click the **+** icon (top right) → **New repository**
2. Fill in:
   - **Repository name:** `claude-usage-monitor`
   - **Description:** `Windows desktop widget to track Claude.ai usage`
   - **Public** (so anyone can find and download it)
   - ✅ Leave **Add a README** unchecked — we already have one
3. Click **Create repository**
4. GitHub shows you an empty repo page — leave this tab open

---

### Step 3 — Upload your source files

You have two options. Option A is simpler for a first-time upload.

#### Option A — Upload via the GitHub website (easiest)

1. On your new repo page, click **uploading an existing file**
2. Open your project folder in File Explorer
3. Select all files **except** `node_modules/` and `dist/` — you don't want those
   - Everything else: `main.js`, `preload.js`, `package.json`, `setup.bat`, `build.bat`, `run.bat`, `README.md`, `.gitignore`, `PUBLISHING.md`, the `src/` folder, the `assets/` folder, the `build/` folder
4. Drag them all onto the GitHub upload page
5. Scroll down, type a commit message like `Initial release`
6. Click **Commit changes**

#### Option B — Use GitHub Desktop (easier for future updates)

1. Download **GitHub Desktop** from https://desktop.github.com
2. Sign in with your GitHub account
3. Click **File → Clone repository**, find `claude-usage-monitor`, choose a local folder
4. Copy your project files into that folder (excluding `node_modules/` and `dist/`)
5. In GitHub Desktop you'll see all the new files listed
6. Type a summary like `Initial release` and click **Commit to main**
7. Click **Push origin** to upload to GitHub

---

### Step 4 — Create your first Release and attach the installer

This is how users download your .exe. Releases are separate from the source code.

1. On your GitHub repo page, look in the right sidebar for **Releases** → click **Create a new release**
2. Click **Choose a tag** → type `v1.0.0` → click **Create new tag: v1.0.0**
3. Fill in:
   - **Release title:** `Claude Usage Monitor v1.0.0`
   - **Description:** (copy from below or write your own)
     ```
     First public release.

     - Real-time session and weekly usage tracking
     - Toast notifications at configurable thresholds
     - 8-hour and 7-day history graph
     - Launch on startup support
     - System tray with show/hide toggle
     ```
4. Scroll down to **Attach binaries** — drag your installer file here:
   `dist\Claude Usage Monitor Setup 1.0.0.exe`
5. Click **Publish release**

Done! Your repo now has a Releases page and users can download the .exe directly.

---

## Releasing an Update

Every time you fix a bug or add a feature:

### 1. Update the version number

In `package.json`, change the version:
```json
"version": "1.0.1"
```

Also update the installer filename reference in `README.md` if the version appears there.

### 2. Rebuild the installer

Run `build.bat` — the new installer will be in `dist\`.

### 3. Push the updated source to GitHub

**If using GitHub Desktop:**
1. Copy your updated source files into the cloned folder
2. GitHub Desktop shows the changed files
3. Write a commit message describing what changed (e.g. `Fix uninstaller not closing app`)
4. Click **Commit to main** → **Push origin**

**If uploading via website:**
1. Go to your repo, navigate to the file you changed, click the pencil ✏️ icon to edit
2. For multiple files, use the upload page again — GitHub will update existing files

### 4. Create a new Release

1. Go to your repo → **Releases** → **Draft a new release**
2. Tag: `v1.0.1` (match your new version number)
3. Title: `Claude Usage Monitor v1.0.1`
4. Describe what changed
5. Attach the new `dist\Claude Usage Monitor Setup 1.0.1.exe`
6. Click **Publish release**

The README's download button automatically points to `releases/latest`, so users always get the newest version without you changing any links.

---

## Sharing the Link

Once published, your download page is:
```
https://github.com/YOUR-USERNAME/claude-usage-monitor/releases/latest
```

On your personal website, link to that URL. Anyone clicking it lands on the Releases page and can download the installer with one click. You never need to host the .exe file yourself.

---

## What GitHub Shows Visitors

When someone finds your repo, they see:
- The `README.md` rendered as the homepage (this is what you wrote — features, install guide, etc.)
- A **Releases** section in the sidebar with the latest version
- Your source code (which developers can browse or build themselves)

---

## Quick Reference — Files That Go on GitHub

✅ **Include:**
- `main.js`, `preload.js`, `package.json`
- `setup.bat`, `build.bat`, `run.bat`
- `README.md`, `.gitignore`, `PUBLISHING.md`
- `src/` (all HTML, JS, CSS)
- `assets/` (icons, images)
- `build/installer.nsh`

❌ **Never include:**
- `node_modules/` (700+ files, regenerated by setup.bat)
- `dist/` (binary output — attach to Releases instead)
- `src/chart.umd.min.js` (copied in by setup.bat)
