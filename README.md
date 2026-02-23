# ⚡ LeetCode Forcer

A Chrome extension that blocks all websites until you complete your daily LeetCode goal. No excuses.

---

## Features

- **Website blocking** — every non-LeetCode site is blocked until your goal is met
- **Configurable daily goal** — set 1–30 questions per day
- **Require Daily Challenge** — optionally force yourself to solve today's daily problem
- **Automatic solve detection** — passively intercepts LeetCode's own network calls (no manual check-in needed, no API ban risk)
  - Layer 1: `fetch` intercept for accepted submission responses  
  - Layer 2: `XMLHttpRequest` intercept as fallback  
  - Layer 3: DOM `MutationObserver` as last resort
- **Streak tracking** — current and longest streaks, updated automatically
- **Daily Challenge card** — shows today's problem title as a clickable link in the popup
- **Emergency bypass** — 3-hour unlock, once per UTC day
- **Goal-complete notification** — optional system notification with streak info
-   **Inline settings** — configure everything via the Settings page (⚙️ in the popup)

---

## Installing in Chrome / Arc / Brave / Edge (Developer Mode)

> **No build step required.** The extension runs as plain JavaScript — just point your browser at the `src/` folder.

### Step 1 — Download the project

**Option A — Clone with Git:**
```bash
git clone https://github.com/YOUR_USERNAME/leetcode-forcer.git
cd leetcode-forcer
```

**Option B — Download ZIP:**
1. Click the green **Code** button on GitHub → **Download ZIP**
2. Unzip somewhere permanent (e.g. `~/Extensions/leetcode-forcer`)

---

### Step 2 — Open the Extensions page

| Browser | URL |
|---------|-----|
| Chrome | `chrome://extensions` |
| **Arc** | **`arc://extensions`** |
| Brave | `brave://extensions` |
| Edge | `edge://extensions` |

---

### Step 3 — Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer mode** ON.

---

### Step 4 — Load the extension

1. Click **Load unpacked**
2. Navigate to the project folder and select the **`src`** subfolder  
   *(the folder that contains `manifest.json`)*
3. Click **Select** / **Open**

The extension will appear in your list with the ⚡ icon.

---

### Step 5 — Pin the extension (recommended)

**Chrome / Brave / Edge:** Click the puzzle-piece 🧩 icon in the toolbar → pin ⚡ LeetCode Forcer.

**Arc:** The extension icon appears in the Arc toolbar automatically. You can also access it via the toolbar overflow menu.

---

### Step 6 — Configure

Click the ⚡ icon → click **Open Settings →** → enter your LeetCode username and set your daily goal → **Save Settings**.

The extension will:
1. Verify you are logged into LeetCode in this browser
2. Query your solve history for today (once per UTC day)
3. Start blocking all non-LeetCode sites immediately if your goal isn't met

---

## Updating the extension

If you pull new code or edit any files:

| Browser | URL | Action |
|---------|-----|--------|
| Chrome | `chrome://extensions` | Click ↺ refresh on the card |
| Arc | `arc://extensions` | Click ↺ refresh on the card |
| Brave | `brave://extensions` | Click ↺ refresh on the card |
| Edge | `edge://extensions` | Click ↺ refresh on the card |

---

## How solve detection works

When you submit a solution on LeetCode and it's accepted, the extension detects this **automatically** — no button to press. Detection uses three layers in order:

| Layer | Method | Triggers on |
|-------|--------|-------------|
| 1 | `window.fetch` override | Modern LeetCode submission responses |
| 2 | `XMLHttpRequest` override | Older / fallback submission flow |
| 3 | `MutationObserver` on DOM | "Accepted" text appearing in the result panel |

All detection is **passive** (reads your own active session, never logs in on your behalf) to avoid any risk to your LeetCode account.

---

## Permissions explained

| Permission | Why it's needed |
|------------|-----------------|
| `storage` | Save your settings and daily progress |
| `alarms` | Reset progress at UTC midnight, expire bypass timer |
| `declarativeNetRequest` | Block non-LeetCode sites via Chrome's native engine |
| `tabs` | Detect active tab for state refresh |
| `notifications` | Optional goal-complete system notification |
| `<all_urls>` (host permission) | Required by `declarativeNetRequest` to intercept all URLs |

---

## Troubleshooting

**Extension not blocking sites?**
- Make sure you entered your LeetCode username in Settings (click ⚙️ in the popup)
- Confirm you are logged into LeetCode at [leetcode.com](https://leetcode.com) in the same browser profile
- **Arc users:** go to `arc://extensions`, find LeetCode Forcer, and click ↺ reload
- **Arc users:** blocking does not apply inside Arc's "Little Arc" preview windows — only full tabs are blocked
- Click ↺ refresh on the Extensions page and try again

**Solve not detected automatically?**
- Wait a few seconds after the "Accepted" banner appears — detection is near-instant but the popup updates on a 30-second poll
- If the DOM layer doesn't trigger, open [leetcode.com](https://leetcode.com) and solve again — the lazy poll on next startup will sync your count

**Bypass already used / streak broken?**
- Both reset at UTC midnight (the same time LeetCode resets its daily challenge)

---

## Project structure

```
src/
├── manifest.json              # MV3 extension manifest
├── background/
│   └── service_worker.js      # Blocking rules, alarms, streak, notifications
├── content/
│   └── detector.js            # 3-layer solve detection (injected into leetcode.com)
├── utils/
│   ├── api.js                 # LeetCode GraphQL helpers (lazy poll, daily challenge)
│   └── storage.js             # chrome.storage.local read/write helpers + defaults
├── popup/
│   ├── popup.html             # Popup UI with inline settings panel
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html           # Extended options page (accessible via right-click)
│   ├── options.css
│   └── options.js
├── blocked/
│   ├── blocked.html           # Page shown when a site is blocked
│   ├── blocked.css
│   └── blocked.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Privacy

All data is stored **locally** in your browser via `chrome.storage.local`. Nothing is sent to any server. The only external requests made are to `leetcode.com/graphql/` using your own active browser session, identical to what LeetCode's own website does.
