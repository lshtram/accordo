# Skill: Author Narration Scripts

**Version:** 1.2.0  
**Use when:** User says "demo", "walk through", "show me how", "script this", "narrate", "present", "code review"

---

## Demo Types

Before writing anything, identify which type fits the request. There are five types — **always check Type 0 first.**

### Type 0: Manual Testing Guide — User Walks Through It

**Audience:** The user — they are doing the steps, not watching  
**Purpose:** Show a feature is working by walking the user through it step-by-step from a real user's perspective  
**Format:** A markdown document in `docs/40-testing/testing-guide-<feature>.md` — NOT an automated script  
**Shows:** Real UI interactions (open popup, click button, see result), NOT code or tests

**When to use Type 0:**
- User says "demo the feature to me", "can we test it", "show me it's working", "walk me through it"
- User wants to experience the feature themselves, not watch a narrated walkthrough
- The feature has visible user-facing UI or interaction (browser extension, VS Code command, etc.)

**Format rules:**
- Prerequisites section first — what must be running before you start
- Numbered steps — "Step 1", "Step 2", ... in the order a user would actually do them
- Each step has: what to do, what you expect to see (as "Expected result:" or "Expected:")
- Include a "What to check if something goes wrong" section with a table
- No agent calls, no curl commands, no code — pure user actions
- Keep it under 2 pages — if it's longer, split by feature area

**Example structure:**
```
## Prerequisites
- VS Code open with Accordo active
- Chrome extension installed

## Step 1 — Do X
Action: Click the Y button in Z.
Expected: The banner changes to "Connected ✓".

## Step 2 — Verify the connection
Tell the agent: "list my tabs".
Expected: Agent returns your open tabs without error.

## What to check if something goes wrong
| Symptom | Cause | Fix |
```

**Reference:** `docs/40-testing/testing-guide-browser-relay-pairing.md` — canonical example of this format.

> **Key rule:** When a user says "demo" or "show me the feature working", default to Type 0 (manual testing guide) unless they specifically ask for an automated narrated demo. Type 0 is faster to produce, more useful for verification, and doesn't require a running script system.

---

## The Four Script Types (Automated Narration)

Before writing a single automated script step, identify which of these four types you're writing. Each has a different audience, structure, and voice.

### Type 1: Feature Demo — User-Facing

**Audience:** Non-technical or technical end user  
**Purpose:** Show a feature working in the actual UI — the user must see the before/after, the interaction, the result  
**Shows:** The `.mmd` file, the diagram panel, the patch command, the reload — NOT implementation code  
**Template:** Problem → User Action → Result → Reload Verification

**Golden rule for feature demos:** The audience must see the UI change happen, not just hear about it.

```
❌ Wrong:  "Here's the strokeDash fix" → show code
✅ Correct: "Your dashed edges weren't saving before. Watch — I'll change this edge to dashed, close the file, reopen it, and the dashed style is still there."
```

**Typical voice:** `af_nicole` (detailed, technical content, clear and professional) or `bf_emma` (warm, general purpose)

---

### Type 2: Code / Architecture Walkthrough — Workflow Demo

**Audience:** Technical team, developers  
**Purpose:** Walk through implementation — tests, design decisions, code structure  
**Shows:** Source files, test files, architecture diagrams  
**Template:** Context → Key Code → Explanation → Tests

**Typical voice:** `af_nicole` (technical deep-dive) or `bm_george` (architectural weight)

---

### Type 3: Presentation — Slide Deck Walkthrough

**Audience:** Mixed / stakeholders  
**Purpose:** Communicate high-level messages through slides  
**Shows:** Marp slide decks  
**Template:** Slide → Key Point → Slide → Key Point

**Typical voice:** `bf_emma` (warm, engaging) or `af_heart` (expressive storytelling)

---

### Type 4: Code Review — Findings Report

**Audience:** Technical team  
**Purpose:** Present review findings, what passed/failed, what needs fixing  
**Shows:** Review documents, specific code locations  
**Template:** Verdict → Evidence → Findings → Recommendation

**Typical voice:** `bm_lewis` (clear, convincing for findings)

---

## Golden Rules (All Types)

### Show First, Then Speak

> **The audience must see before they hear.**

Every step follows a **reveal → narrate** pattern:

```
1. OPEN the thing  (diagram, file, slide)
2. WAIT for it to render  (300–800ms)
3. HIGHLIGHT if showing code
4. SPEAK about it  (block: true)
```

- ❌ **Wrong:** Speak about something, THEN open it — audience is confused
- ❌ **Wrong:** Narrate, THEN highlight — audience hears why before seeing what
- ✅ **Correct:** Open → wait → highlight → narrate

### Panel Hygiene

> **Close all panels before showing content.**

Run these first in every script:

```json
{ "type": "command", "command": "accordo_layout_panel", "args": { "area": "sidebar", "action": "close" }},
{ "type": "command", "command": "accordo_layout_panel", "args": { "area": "panel",   "action": "close" }},
{ "type": "delay",   "ms": 300 }
```

---

## Voice Selection Guide

Use this matrix — don't default to the same voice every time:

| Script Type | Voice | Why |
|---|---|---|
| **Feature Demo** (general) | `bf_emma` | Warm, natural, versatile |
| **Feature Demo** (detailed/technical) | `af_nicole` | Clear, professional, easy to follow |
| **Architecture walkthrough** | `bm_george` | Formal, gives weight to decisions |
| **Code walkthrough** | `af_nicole` | Technical clarity, slightly different timbre keeps attention |
| **Presentation / storytelling** | `af_heart` | Most expressive, Grade A |
| **Findings / review** | `bm_lewis` | Clear, convincing |
| **Quick status update** | `af_sky` | Light, fast pacing |

**Key principle:** If the content is detailed or risks being boring, use `af_nicole`. If it's engaging storytelling, use `bf_emma` or `af_heart`.

### Top Picks

| Voice | Grade | Best For |
|---|---|---|
| `af_heart` | **A** | Engaging demos, storytelling |
| `af_bella` | **A-** | Warm, dramatic premium presentations |
| `af_nicole` | **B-** | Technical narration, detailed walkthroughs |
| `bm_george` | **C** | Formal architectural explanations |
| `bm_lewis` | **D+** | Clear findings presentation |

### Voice Blending

`voice1,voice2` (comma-separated, no ratio):

- `bf_emma,bf_lily` — warm + soft. Gentle and approachable
- `bf_emma,af_nicole` — warm + clear. Professional blend
- `af_heart,af_bella` — extra expressive
- `bm_george,bm_lewis` — formal + clear. Authoritative

> ❌ Do NOT use `voice:ratio:voice:ratio` syntax — it returns 404 errors.

---

## Step Types Reference

| Step type | When to use |
|---|---|
| `speak` | Narrate content. Always `block: true` for demos. |
| `command` | Open slides, files, diagram panels, or trigger VS Code commands. |
| `delay` | Wait for UI to render (300ms after panels, 500–800ms after opening files/slides). |
| `highlight` | Reveal code lines before narration — audience sees the lines first. |
| `clear-highlights` | Remove highlights after explanation. |
| `subtitle` | Status bar note (non-blocking, use sparingly). |

---

## Templates by Type

### Template: Feature Demo (User-Facing)

```json
{
  "label": "D-02 Feature Demo: strokeDash Persists",
  "errPolicy": "abort",
  "steps": [
    // 1. SETUP — close panels, open fresh diagram showing the problem state
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "sidebar", "action": "close" }},
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "panel",   "action": "close" }},
    { "type": "delay",   "ms": 300 },

    // 2. CONTEXT — explain the problem before showing the fix
    { "type": "speak",  "text": "Before this fix, if you changed an arrow to dashed in the diagram editor, it would reset to solid the next time you opened the file. Let's see it in action.", "voice": "af_nicole", "block": true },

    // 3. SHOW THE BROKEN STATE — open diagram with solid arrow
    { "type": "command", "command": "accordo_editor_open", "args": { "path": "/path/to/diagram.mmd" }},
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Here's a flowchart with a solid arrow. I'll change it to dashed using the patch tool.", "voice": "af_nicole", "block": true },

    // 4. SHOW THE FIX — apply strokeDash: true via patch
    // (The user would see the diagram update in real-time)
    { "type": "command", "command": "accordo_diagram_patch", "args": { ... }},
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Done. The arrow is now dashed. Now let's close the file and reopen it to verify the style was saved.", "voice": "af_nicole", "block": true },

    // 5. VERIFY PERSISTENCE — close and reopen
    { "type": "command", "command": "accordo_editor_close", "args": { "path": "/path/to/diagram.mmd" }},
    { "type": "delay",   "ms": 400 },
    { "type": "command", "command": "accordo_editor_open", "args": { "path": "/path/to/diagram.mmd" }},
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Reopened. The dashed style is still there — it persisted. Before the fix, it would have reverted to solid.", "voice": "af_nicole", "block": true }
  ]
}
```

**Key difference from code walkthrough:** The audience watches the user interaction (patch → reload → verify), not the code that made it work.

---

### Template: Code / Architecture Walkthrough

```json
{
  "label": "D-04 Code Walkthrough",
  "errPolicy": "abort",
  "steps": [
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "sidebar", "action": "close" }},
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "panel",   "action": "close" }},
    { "type": "delay",   "ms": 300 },

    // Context
    { "type": "speak", "text": "D-04 implements Z-shape routing for orthogonal edges. The problem: multiple waypoints were ignored. Let's look at the tests first.", "voice": "af_nicole", "block": true },

    // Show tests
    { "type": "command", "command": "accordo_editor_open", "args": { "path": "/path/to/edge-router.test.ts", "line": 140 }},
    { "type": "delay",   "ms": 600 },
    { "type": "highlight", "file": "/path/to/edge-router.test.ts", "startLine": 140, "endLine": 160, "durationMs": 10000 },
    { "type": "speak",   "text": "ER-16 tests that two waypoints produce a Z-shape with seven points — start, L-junctions at each waypoint, and end.", "voice": "af_nicole", "block": true },
    { "type": "clear-highlights" },

    // Show implementation
    { "type": "command", "command": "accordo_editor_open", "args": { "path": "/path/to/edge-router.ts", "line": 177 }},
    { "type": "delay",   "ms": 600 },
    { "type": "highlight", "file": "/path/to/edge-router.ts", "startLine": 177, "endLine": 210, "durationMs": 12000 },
    { "type": "speak",   "text": "The implementation builds a control chain from source through all waypoints to target. For each pair it emits a horizontal-first L-junction. Adjacent duplicates are removed to avoid zero-length segments.", "voice": "af_nicole", "block": true },
    { "type": "clear-highlights" }
  ]
}
```

---

### Template: Presentation (Slide Deck)

```json
{
  "label": "Architecture Overview Deck",
  "errPolicy": "abort",
  "steps": [
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "sidebar", "action": "close" }},
    { "type": "command", "command": "accordo_layout_panel", "args": { "area": "panel",   "action": "close" }},
    { "type": "delay",   "ms": 300 },
    { "type": "command", "command": "accordo_presentation_open", "args": { "deckUri": "/path/to/deck.md" }},
    { "type": "delay",   "ms": 400 },
    { "type": "speak",  "text": "Here's the architecture overview. Three main components: the Hub, the Bridge, and the Editor tools.", "voice": "bf_emma", "block": true },
    { "type": "command", "command": "accordo_presentation_next" },
    { "type": "delay",   "ms": 500 },
    { "type": "speak",   "text": "The Hub manages AI sessions and routes tools. Notice the FIFO queue — no per-session scheduling.", "voice": "bf_emma", "block": true }
  ]
}
```

---

## Timing Reference

| Action | Delay after |
|---|---|
| Panels closed (panel hygiene) | 300ms |
| Diagram opened | 800ms |
| Code file opened | 500–800ms |
| Slide opened (first) | 300–400ms |
| Slide opened (subsequent) | 500–800ms |
| Highlight applied | 0ms — speak immediately |
| Between narration sentences | 0ms (blocking handles pacing) |

---

## Anti-Patterns

1. **Feature demo that shows code** — If the user says "demo", they want to see the feature in the UI, not the implementation. Use Type 1, not Type 2.

2. **Speaking before showing** — The audience can't connect what they're hearing to what they're seeing if they see it after.

3. **Skipping render delays** — Without 500–800ms after opening a file or slide, the audience sees a blank panel while narration starts.

4. **Non-blocking narration in demos** — Always `block: true`. If the script continues while narration is still playing, the next action fires before the audience finishes listening.

5. **Overlapping highlights** — Always `clear-highlights` before a new `highlight`, or set `durationMs` so they auto-expire.

6. **Long highlight durations** — If narration is ~20 words (~5s), set `durationMs: 5000` not 20000. Highlights should not outlive the explanation.

7. **Using `bf_emma` for everything** — `bf_emma` is great but for detailed technical content `af_nicole` has better clarity. Match the voice to the content density.

---

## How to Choose

| Signal from user | Script Type |
|---|---|
| "demo the feature", "show me it's working", "can we test it", "walk me through it" | **Manual Testing Guide (Type 0)** |
| "show me a narrated demo", "demo the feature with voice", "user-facing demo" | **Feature Demo (Type 1)** |
| "walk through the implementation", "show me the code", "explain how it works under the hood" | **Code Walkthrough (Type 2)** |
| "present the architecture", "walk the deck" | **Presentation (Type 3)** |
| "review findings", "here's what we found" | **Code Review (Type 4)** |

**Default rule:** When a user says "demo" without specifying an automated walkthrough, use **Type 0** (manual testing guide). It's faster to produce, works without a running script system, and lets the user experience the feature themselves. Only escalate to Type 1 (narrated script) if the user explicitly asks for narration or an automated demo.
