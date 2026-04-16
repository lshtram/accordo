# Testing Guide — Browser Relay Pairing Auth

**Feature:** Browser extension ↔ VS Code pairing via one-time code  
**Shipped in:** `feat(browser,browser-extension): replace native messaging auth with pairing flow` (PR #3)  
**Date:** 2026-04-15

---

## What This Feature Does

When the Accordo browser extension is installed, it needs to connect to VS Code securely.
Previously this required a native messaging host install step. The pairing flow replaces that with a simpler approach:

1. An agent (or you) calls one MCP tool — `accordo_browser_pair`
2. A short code like `1234-5678` appears in the chat
3. You paste that code into the browser extension popup and click Connect
4. The extension connects automatically — no restart needed

---

## Prerequisites

Before starting:

- VS Code is open with the Accordo extension active (check the status bar — you should see Accordo connected)
- The Accordo browser extension is installed in Chrome (visible in the toolbar)
- An AI agent is connected to Accordo (e.g. OpenCode or Claude Desktop)

---

## Step-by-Step: First-Time Pairing

### Step 1 — Ask the agent for a pairing code

Tell the agent: *"Connect the browser extension"* or *"give me a pairing code"*.

The agent calls `accordo_browser_pair` and responds with something like:

> Pairing code: **3847-2910**
>
> Open the Accordo browser extension popup, enter this code in the "VS Code code:" field, and click Connect. The code expires in 300 seconds.

### Step 2 — Open the browser extension popup

Click the Accordo icon in the Chrome toolbar (top-right of the browser window).

You will see a banner at the top of the popup:

```
VS Code code: [ __________ ] [ Connect ]
```

### Step 3 — Enter the code and connect

Paste the code from the agent into the text field (e.g. `3847-2910`) and click **Connect** (or press Enter).

**Expected result:** The banner changes to:

```
VS Code: Connected ✓         [ Disconnect ]
```

The extension is now paired. The agent can now use all browser tools (`accordo_browser_get_page_map`, `accordo_browser_navigate`, `accordo_browser_click`, etc.).

---

## Step-by-Step: Verify the Agent Can See the Browser

### Step 4 — Ask the agent to list open tabs

Tell the agent: *"What tabs do I have open?"* or *"list my browser tabs"*.

The agent calls `accordo_browser_list_pages` and returns a list of your open tabs with their titles and URLs.

**Expected:** The agent correctly reports your open tabs without any "browser not connected" error.

### Step 5 — Ask the agent to read a page

Navigate to any website (e.g. `https://example.com`). Tell the agent: *"Read the current page"*.

The agent calls `accordo_browser_get_text_map` and returns the page content.

**Expected:** The agent returns text from the page you're looking at.

---

## Step-by-Step: What Happens When the Code Expires

If you wait more than 5 minutes before entering the code:

### Step 6 — Try an expired code

Enter the code after 5 minutes (or enter a wrong code deliberately, e.g. `0000-0000`).

**Expected result:** The popup shows briefly:

```
Invalid code
```

The "Connect" button resets. Request a new code from the agent and try again.

---

## Step-by-Step: Disconnect and Re-pair

### Step 7 — Disconnect

While paired, open the popup and click **Disconnect**.

**Expected:** Banner returns to unpaired state:

```
VS Code code: [ __________ ] [ Connect ]
```

The agent's browser tools now return "browser not connected" until you pair again.

### Step 8 — Re-pair

Ask the agent for a new pairing code and repeat Steps 2–3.

**Expected:** Re-pairing works without restarting VS Code or Chrome.

---

## What to Check if Something Goes Wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| "VS Code code" field not visible in popup | Extension loaded before VS Code started | Reload the extension: `chrome://extensions` → refresh Accordo |
| "Invalid code" on first attempt | Code was typed incorrectly | Copy-paste directly — don't retype |
| Agent says "browser not connected" after pairing | Relay server not started | Check VS Code status bar — Accordo must show connected |
| Popup shows "Connected" but agent still fails | VS Code window that owns the relay was closed | Restart VS Code and re-pair |

---

## Security Properties (for reference)

These are what the pairing flow protects — you don't need to test them manually, but it's useful to know what the feature guarantees:

- **Codes are single-use** — once entered, the code is consumed and cannot be reused
- **Codes expire in 5 minutes** — an unused code will be rejected after that
- **Only Chrome extensions can pair** — a regular webpage cannot call `/pair/confirm` (CORS blocks it)
- **Token is stored in Chrome's encrypted storage** — `chrome.storage.local`, not a plain file
- **1008 close clears the token** — if the relay closes with policy violation, Chrome clears its token and shows unpaired state
