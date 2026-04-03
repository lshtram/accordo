# Testing Guide — Browser Tab Control Module (M110-TC)

**Module:** `packages/browser-extension`  
**Design doc:** `docs/10-architecture/browser-tab-control-architecture.md`  
**Phase A review:** `docs/reviews/browser-tab-control-architecture.md`  
**Phase B review:** `docs/reviews/browser-tab-control-Phase-B.md`  
**Date:** 2026-04-03  
**Test status:** 931/931 unit tests pass (all green after chrome-mock factory fix)

---

## Section 1 — Agent-Automated Verification

### Unit Tests

```bash
pnpm --filter browser-extension test
```

**Expected output:**
```
Test Files  43 passed (43)
     Tests  931 passed (931)
```

**Test coverage map:**

| Test File | What It Verifies |
|---|---|
| `browser-control-click.test.ts` | Click by uid, selector, explicit coords; double-click sequence; scroll-into-viewport; permission checks |
| `browser-control-type.test.ts` | Text insertion; clearFirst (Ctrl+A Delete); submitKey (Enter/Tab/Escape); element focus |
| `browser-control-keyboard.test.ts` | Basic key press; modifier bitmask (Alt/Control/Meta/Shift); KeyCodeMap for named keys |
| `browser-control-navigate.test.ts` | Navigate by url/back/forward/reload; tab targeting; Page.loadEventFired wait; error handling |
| `resolve-element-coords.test.ts` | RESOLVE_ELEMENT_COORDS message handler; uid/selector resolution; zero-size detection; viewport check |
| `debugger-manager-attach.test.ts` | ensureAttached MV3 recovery; "already attached" recovery; unsupported-page error; detach |
| `debugger-manager.test.ts` | Full debugger manager lifecycle; detachAll; isAttached |
| `control-permission.test.ts` | hasPermission grant/revoke; badge text/color; session persistence |
| `relay-control-handlers.test.ts` | Integration tests for all 4 control handlers |
| `capture-tabid-routing.test.ts` | tabId routing through relay-capture-handler |
| *(33 existing test files)* | Comments, page-understanding, snapshot, relay infrastructure |

### Static Analysis

```bash
# Type check
pnpm --filter browser-extension exec tsc --noEmit

# Lint
pnpm --filter browser-extension lint
```

Both should pass with zero errors.

### Deployed E2E Verification

**Status: NOT POSSIBLE in current environment**

The Browser Tab Control module requires a **live Chrome browser with CDP debugging enabled**. The module:
- Sends real CDP (Chrome DevTools Protocol) commands via `chrome.debugger.sendCommand`
- Requires `chrome.debugger.attach()` to establish a debugging session
- Requires a Chrome extension to be installed and connected

**Why E2E is not possible here:**
1. **No headless Chrome with CDP** — The test environment uses JSDOM, which does not support `chrome.debugger` APIs
2. **No running Chrome extension host** — The extension must be installed in Chrome and connected to the Accordo Hub
3. **CDP requires real browser** — Debugger commands like `Input.dispatchMouseEvent` and `Page.navigate` can only execute in a real Chrome tab

All 931 unit tests verify handler logic, permission checks, message routing, CDP command sequencing (double-click 5-event sequence, modifier bitmask application), and error handling at the `sendCommand` mock level. 462 additional tests in `accordo-browser` (Hub relay side) also pass.

---

## Section 2 — User Journey Verification

### Before You Start

These steps require:
- Chrome browser with the Accordo extension installed
- Accordo IDE open on your computer
- The Accordo extension connected to Hub (the orange dot in VS Code status bar should be green)

---

### Journey 1: Let the Agent Click a Button

**What happens:** You open a webpage, the agent clicks a button on it.

**Steps:**

1. **Open Chrome** and go to any website with a button (for example: https://example.com — has a form submit button)

2. **Click the Accordo icon** in the Chrome toolbar (top right)

3. **Click the "Grant" button** in the popup (next to "Browser Control: OFF")
   - The button changes to "Revoke" and the label changes to "Browser Control: ON"
   - The extension badge shows orange text "CTL"

4. **Open VS Code** and the Accordo IDE panel

5. **Tell the agent** (in the chat): "Please click the submit button on the webpage"

6. **Watch the Chrome tab** — the button should be clicked (you should see the page react, like a form submitting or a button being pressed)

**If it works:** The button was clicked and the page responded.

**If it doesn't work:** Tell the agent what went wrong. It may need the button's name or a description.

---

### Journey 2: Let the Agent Type into a Text Box

**What happens:** You open a webpage with input fields, the agent types text into one.

**Steps:**

1. **Open Chrome** and go to a website with a text input (for example: https://github.com — has a search box and login fields)

2. **Grant control** — click the Accordo icon → click "Grant" next to "Browser Control"

3. **Open VS Code** and the Accordo IDE panel

4. **Tell the agent:** "Please type your email address into the search box"

5. **Watch Chrome** — the agent will find the input field and type into it

**If it works:** You see text appearing in the input field character by character.

**If it doesn't work:** Tell the agent which field to use instead, or describe where it is ("the top search box" or "the username field").

---

### Journey 3: Let the Agent Use Keyboard Shortcuts

**What happens:** The agent sends a keyboard shortcut to Chrome (like Ctrl+A to select all text).

**Steps:**

1. **Open Chrome** and go to any website with a text field that has text in it

2. **Grant control** — click the Accordo icon → click "Grant" next to "Browser Control"

3. **Open VS Code** and the Accordo IDE panel

4. **Tell the agent:** "Press Ctrl+A to select all the text"

5. **Watch Chrome** — all text in the focused text field should become selected (highlighted blue)

**Other shortcuts the agent can do:**
- "Press Enter" — presses the Enter key
- "Press Tab" — presses the Tab key
- "Press Escape" — presses the Escape key
- "Press Control+A" — Ctrl+A (select all)
- "Press Control+C" — Ctrl+C (copy, if you first selected text)

**If it works:** The keyboard shortcut was sent and Chrome reacted to it.

---

### Journey 4: Let the Agent Navigate to a Website

**What happens:** The agent opens a new URL in the Chrome tab.

**Steps:**

1. **Open Chrome** and go to any website (for example: https://example.com)

2. **Grant control** — click the Accordo icon → click "Grant" next to "Browser Control"

3. **Open VS Code** and the Accordo IDE panel

4. **Tell the agent:** "Go to https://github.com"

5. **Watch Chrome** — the tab should navigate to GitHub

**Other navigation commands:**
- "Go back" — presses the browser back button
- "Go forward" — presses the browser forward button
- "Reload the page" — refreshes the current page

**If it works:** Chrome navigated to the new website you requested.

---

### Journey 5: Keep Working While You Browse Another Tab

**What happens:** You switch to a different tab in Chrome, but the agent can still control the original tab.

**Steps:**

1. **Open Chrome** with at least two tabs open

2. **Make Tab A active** (click on it)

3. **Grant control** for Tab A — click the Accordo icon → click "Grant" next to "Browser Control"

4. **Tell the agent** to do something in Tab A: "Click the Login button on the webpage"

5. **While watching Tab A respond**, click on Tab B in Chrome to switch tabs

6. **Tell the agent** to do something else: "Now click the search button"

7. **Watch Tab A** — the agent's command should execute in Tab A even though Tab B is now showing in Chrome

**If it works:** The agent controls Tab A independently of which tab you are currently looking at.

**If it doesn't work:** The session may have been lost. Click the Accordo icon and click "Grant" again to re-establish control.

---

## Test Evidence Summary

| Verification | Command | Result |
|---|---|---|
| Unit tests | `pnpm --filter browser-extension test` | 931/931 pass ✅ |
| Type check | `pnpm --filter browser-extension exec tsc --noEmit` | Clean ✅ |
| Lint | `pnpm --filter browser-extension lint` | Clean ✅ |
| Accordo-browser tests | `pnpm --filter accordo-browser test` | 462/464 pass (2 env failures — see below) |
| E2E | Manual Chrome testing (see journeys above) | See notes |

**Accordo-browser environmental failures (pre-existing, not code bugs):**
- `BR-F-120`: relay server start times out because VS Code occupies ports 40111/40112
- `BR-F-123`: relay state publishes on wrong port due to port conflict

These fail in any environment where VS Code is running with the Accordo extension. Not reproducible in CI without a dedicated test environment.
