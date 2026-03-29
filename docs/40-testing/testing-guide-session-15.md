# Testing Guide — Session 15: Page Understanding + Region Capture

**Module:** `packages/browser-extension` (content scripts + service worker) + `packages/browser` (MCP relay tools)  
**Date:** 2026-03-27 (updated after Session 15b hardening)  
**Automated test baseline:** 474 tests passing (357 browser-extension + 117 browser); full monorepo: 2,967 tests  
**TDD phases completed:** A → B → C → D → D2 → D3 (all green)

---

## Section 1 — Automated Tests

### How to run

```bash
# browser-extension package (357 tests)
cd /data/projects/accordo/packages/browser-extension && pnpm test

# browser package (117 tests)
cd /data/projects/accordo/packages/browser && pnpm test

# Full monorepo (2,967 tests)
cd /data/projects/accordo && pnpm test
```

### Test file index

| Test file | Package | Tests | What it covers |
|---|---|---|---|
| `page-map-collector.test.ts` | browser-extension | 27 | `collectPageMap()` DOM walking, node filtering, bounds, ref index |
| `element-inspector.test.ts` | browser-extension | 34 | `inspectElement()`, `getDomExcerpt()`, visibility, HTML sanitization |
| `enhanced-anchor.test.ts` | browser-extension | 34 | 6-tier anchor strategy hierarchy, enhanced-key parsing/resolution, disambiguation |
| `page-understanding-actions.test.ts` | browser-extension | 33 | Relay action routing for all 4 page-understanding actions |
| `capture-region.test.ts` | browser-extension | 31 | Region capture result types, bounds/size contracts, error codes |
| `anchor-position.test.ts` | browser-extension | 5 | Pin-position resolution for legacy + enhanced anchor keys and offset suffixes |
| `content-entry-anchor-generation.test.ts` | browser-extension | 1 | Right-click comment path uses enhanced anchor generation for low-stability elements |
| `service-worker.test.ts` | browser-extension | 35 | GET_THREADS hydration/normalization paths, relay action routing, mode sync |
| `page-understanding-tools.test.ts` | browser | 58 | MCP tool registration, handlers, relay forwarding, strict error propagation |

### Key invariants (must stay green)

- `browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`, `browser_capture_region` — all 4 tools registered
- `collectPageMap()` — EXCLUDED_TAGS filtered, `viewportOnly` respected, ref index built
- `inspectElement()` — returns `{ found: false }` for missing elements (never throws)
- `getDomExcerpt()` — strips `<script>`, `<style>`, `<iframe>`; removes `javascript:` and `data:` URLs; strips `on*` attributes
- `isEnhancedAnchorKey("body:50%x50%")` → true; `isEnhancedAnchorKey("body:0:center")` → false
- Relay error codes: `element-not-found`, `element-off-screen`, `no-target`, `image-too-large`, `capture-failed`
- Browser thread hydration is URL/hash-safe (same page with/without trailing hash resolves to the same thread set)
- Newly-created right-click anchors prefer enhanced strategies (`id:`, `data-testid:`, `aria:`, `css:`) over unstable legacy fingerprints
- Pin positions are recomputed on scroll/resize and nested scrolling contexts (no fixed viewport drift)

---

## Section 2 — User Journey Tests

These scenarios describe **real collaborative workflows between a user and an AI agent** using the Accordo browser extension. All scenarios assume:

- Chrome browser open with the Accordo browser extension installed and enabled
- `accordo-browser` VS Code extension active and connected to the MCP relay
- The MCP server (`accordo`) running and reachable by the agent
- An AI agent (e.g. opencode or GitHub Copilot) connected to the MCP server

> **How to check the relay is connected:** Open the Accordo browser extension popup — the relay status indicator should show green / "Connected". If it shows disconnected, start the Hub and Bridge, then reload the extension.

---

### Journey 1 — Agent understands the page and places a precise comment

**Purpose:** Verify the agent can read the live page, identify a specific element, and place a comment on it — not at a fallback position.

**Steps:**

1. Open Chrome and navigate to any page with visible UI elements — for example, a login form at `https://example.com` or a documentation page with headings and code blocks.

2. Open the Accordo browser extension popup and toggle **Comments Mode ON**.

3. In the AI chat (opencode or Copilot), ask the agent: *"What's on the current browser page? Give me a summary of the main UI elements."*

4. The agent should call `browser_get_page_map` internally. Its response should describe real elements on the page — headings, buttons, forms, navigation — **not** a generic answer.

5. Now ask the agent: *"Please leave a comment on the main heading of this page explaining what it does."*

6. The agent should call `browser_inspect_element` to locate the heading, then `comment_create` with an `anchorKey` referencing that heading (e.g. `id:main-title` or `h1:0:Welcome`).

7. Switch back to the browser. A comment pin should appear **on or near the heading**, not at the centre of the viewport.

**Expected result:** The comment pin is positioned on the correct element. Clicking the pin shows the agent's comment text.

**Red flag:** Pin appears at the centre of the page — this means the agent fell back to `body:center` because page understanding did not work.

---

### Journey 2 — User places a comment, agent understands the surrounding context

**Purpose:** Verify the agent can inspect the context around a user-placed comment to give a contextually accurate reply.

**Steps:**

1. Navigate to a page with a form or interactive widget — for example, a sign-up form or a settings page.

2. Toggle **Comments Mode ON** in the extension popup.

3. Right-click on a specific form field (e.g. the email input) and select **Add Comment**. Type: *"This field is confusing — what format does it expect?"*

4. In the AI chat, ask the agent: *"I just left a comment on the browser page. Can you look at what I commented on and give me context about the surrounding UI?"*

5. The agent should call `browser_inspect_element` or `browser_get_dom_excerpt` targeting the anchor stored with the comment (the agent can retrieve the anchor via `comment_list` → `comment_get`).

6. The agent's response should mention the form field, its label (if any), nearby validation hints or placeholder text, and adjacent form controls — details that **only make sense if the agent actually looked at the DOM** of that element.

**Expected result:** The agent's answer is specific to the element the user commented on — not a generic response about forms in general.

---

### Journey 3 — Agent captures a targeted screenshot of a specific element

**Purpose:** Verify `browser_capture_region` returns a cropped image of the right element, not a full-page screenshot.

**Steps:**

1. Navigate to a data-heavy page — a table, a chart, or a dashboard with multiple sections.

2. Toggle **Comments Mode ON**.

3. Ask the agent: *"Can you take a screenshot of just the data table on this page (not the whole page) and describe what you see in it?"*

4. The agent should call `browser_get_page_map` to find the table element, then `browser_capture_region` with a `nodeRef` or `selector` targeting the table.

5. The agent's description should match the actual content of the table (column headers, sample values) — evidence that the image it received was the table, not the full viewport.

**Expected result:** The agent describes table contents accurately. If the page has a sidebar or navigation, those are **absent** from the description (they were cropped out).

**Variant:** Ask the agent to capture a specific button or icon. The captured image should be small (matching the element's dimensions) — not a full-viewport screenshot.

---

### Journey 4 — Agent places comments on multiple elements across a page

**Purpose:** Verify the agent can navigate the page map, select multiple distinct elements, and place individual targeted comments on each.

**Steps:**

1. Navigate to a product page or article with multiple distinct sections (e.g. a hero banner, a feature list, and a footer call-to-action).

2. Toggle **Comments Mode ON**.

3. Ask the agent: *"Review this page layout and leave one comment on each of the three main sections explaining what purpose each section serves."*

4. The agent should call `browser_get_page_map` once to understand the full page structure, then call `browser_inspect_element` for each section to get a stable anchor, then call `comment_create` three times with different anchors.

5. Switch to the browser. **Three comment pins** should be visible, each on a different section of the page.

6. Click each pin to confirm the agent's comment text is relevant to that specific section.

**Expected result:** Three pins on three distinct, correct locations. No two pins stacked on the same element. No pins at the fallback viewport-centre position.

---

### Journey 5 — User navigates to a new page, agent sees the updated content

**Purpose:** Verify that page-understanding data reflects the live page at the time of the call — not a stale snapshot from a previous page.

**Steps:**

1. Start on Page A (e.g. a homepage). Ask the agent: *"What's the main heading on the current page?"*

2. The agent should call `browser_get_page_map` and describe Page A's heading accurately.

3. Navigate the browser to Page B (e.g. an about page or a different article).

4. Ask the agent again: *"What's the main heading now?"*

5. The agent should call `browser_get_page_map` again. Its answer should reflect Page B — **not** the heading from Page A.

**Expected result:** The agent's second answer matches Page B's heading. If the agent repeats the Page A answer without calling the page map tool again, that is a caching or context bug.

---

### Journey 6 — Agent inspects a page element the user is unsure about

**Purpose:** Verify the agent can help the user understand what a UI element is — the core "AI sees the page" use case.

**Steps:**

1. Navigate to any web application with an unfamiliar UI — a SaaS dashboard, a government form, or a complex checkout flow.

2. Toggle **Comments Mode ON**.

3. Point at something on the page you don't understand — for example, a grey icon button with no visible label. Note roughly where it is on the page (top-right, below the search bar, etc.).

4. Ask the agent: *"There's a grey icon button near the top-right of the page. Can you tell me what it does?"*

5. The agent should call `browser_get_page_map` and/or `browser_inspect_element` to find the button. It should report back the button's `aria-label`, `title`, accessible name, or surrounding context — enough for you to understand the element's purpose.

**Expected result:** The agent correctly identifies the button and explains its purpose based on DOM attributes (aria-label, title, role, nearby text). It should not hallucinate based on generic knowledge of that website.

---

### Journey 7 — Comment pins survive a page reload and re-anchor correctly

**Purpose:** Verify that enhanced anchors (id-based or data-testid-based) survive a page reload and pins re-appear in the correct location.

**Steps:**

1. Navigate to a page where elements have `id` attributes or `data-testid` attributes (common in modern web apps, e.g. React or Vue SPAs).

2. Toggle **Comments Mode ON**.

3. Ask the agent: *"Leave a comment on the sign-in button explaining what happens when it's clicked."*

4. The agent places a comment with an anchor like `id:sign-in-btn`.

5. Reload the page (Cmd/Ctrl+R).

6. After reload, check that the comment pin re-appears on the sign-in button — **not** at a fallback position.

**Expected result:** Pin re-anchors on the correct element after reload. This works because `id:`-prefixed anchor keys are resolved by DOM id lookup — they do not depend on element position.

**Note if it drifts:** If the pin appears at the wrong position after reload, check whether the element's `id` changed (some frameworks regenerate ids on re-render). Ask the agent what anchor key it used — if it used a viewport-pct key (e.g. `body:42%x37%`), that confirms the id strategy was not available for that element.

---

### Setup checklist (before running any journey)

- [ ] Chrome extension loaded — visit `chrome://extensions` and confirm the Accordo extension is enabled
- [ ] `accordo-browser` extension active in VS Code — check the status bar for a relay indicator
- [ ] Hub running — check `~/.accordo/bridge-server.log` or the Accordo Hub terminal output
- [ ] Agent connected — in opencode or Copilot, confirm the `accordo` MCP server is listed in available tools
- [ ] Comments Mode ON — the extension popup should show the toggle in the ON state before placing any comments
