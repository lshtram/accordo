# Skill: Author Demo Scripts

**Version:** 2.0.0  
**Use when:** User says "demo", "walk through", "show me how", "narrate", "present", "script this"
**Status:** Updated 2026-04-16 — built-in `accordo_script_*` MCP tools removed. Scripts now execute via external Python runner.

---

> **Note on terminology:** "Script" here means a **NarrationScript** — a JSON object describing a sequenced IDE walkthrough (speak, navigate, highlight, delay). This format was originally executed by the built-in Hub script engine (`accordo_script_*` tools). That engine has been removed. Scripts are now authored as JSON and executed by an **external Python runner** (`skills/script-authoring/accordo-run.py`).

---

## Quick Reference: NarrationScript Format

```json
{
  "label": "My Demo",
  "errPolicy": "abort",
  "steps": [
    { "type": "speak", "text": "Hello", "block": true },
    { "type": "open", "path": "README.md" },
    { "type": "delay", "ms": 500 },
    { "type": "highlight", "path": "README.md", "start": 1, "end": 10 },
    { "type": "clear_highlights" }
  ]
}
```

### Step Types

| Step type | Fields | Behaviour |
|---|---|---|
| `speak` | `text`, `voice?`, `speed?`, `block?` | Text-to-speech. `block: true` (default) waits for playback. |
| `call` | `tool`, `args?`, `after_ms?` | Execute any Accordo tool directly. |
| `layout` | `area`, `action`, `view?`, `after_ms?` | Open/close VS Code sidebars and panels via `accordo_layout_panel`. |
| `slide_open` | `deckUri`, `after_ms?` | Open a Marp deck via `accordo_presentation_open`. |
| `slide_goto` | `index`, `after_ms?` | Navigate to a 1-based slide via `accordo_presentation_goto`. |
| `slide_next` / `slide_prev` | `after_ms?` | Move one slide forward/back. |
| `delay` | `ms` | Pause (1–30 000 ms). |
| `highlight` | `path`, `start`, `end`, `color?` | Highlight lines in an open text editor or already-open Accordo Markdown Preview. |
| `clear_highlights` | — | Remove all highlights; omit `decorationId` for clear-all rather than passing an empty string. |

**Markdown preview highlighting:** `accordo_editor_highlight` supports Accordo Markdown Preview only when the preview is already open. It does not auto-open previews. If the same `.md` file is visible as a text editor, the text-editor decoration path is intentionally preferred.

### Top-Level Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `steps` | Yes | — | Array of 1–200 step objects |
| `label` | No | — | Human-readable name |
| `errPolicy` | No | `"abort"` | `"abort"` stops on first error; `"skip"` logs and continues |

---

## How Scripts Are Executed

**Built-in engine removed (2026-04-16).** Scripts run via the external Python runner:

```bash
python3 skills/script-authoring/accordo-run.py my-script.json
```

The runner:
1. Parses the NarrationScript JSON
2. Executes each step via the Accordo Hub MCP API (via WebSocket)
3. Handles TTS playback, delays, editor navigation, and highlights
4. Reports progress to stdout

See `skills/script-authoring/accordo-run.py --help` for full options.

---

## Demo Types

Before writing anything, identify which type fits the request:

### Type 0: Manual Testing Guide — User Walks Through It

**Audience:** The user — they do the steps  
**Format:** Markdown in `docs/40-testing/testing-guide-<feature>.md`  
**Use when:** User wants to experience the feature themselves, not watch a narrated walkthrough

See full Type 0 template and rules in the **Golden Rules** section below.

### Type 1: Feature Demo — User-Facing (Automated)

**Audience:** Non-technical or technical end user  
**Purpose:** Show a feature working in the actual UI  
**Format:** NarrationScript JSON, executed via Python runner  
**Template:** Problem → User Action → Result → Reload Verification

**Golden rule:** The audience must see the UI change happen, not just hear about it.

### Type 2: Code / Architecture Walkthrough (Automated)

**Audience:** Technical team, developers  
**Purpose:** Walk through implementation — tests, design decisions, code  
**Format:** NarrationScript JSON, executed via Python runner  
**Template:** Context → Key Code → Explanation → Tests

### Type 3: Presentation — Slide Deck Walkthrough (Automated)

**Audience:** Mixed / stakeholders  
**Purpose:** Communicate high-level messages through slides  
**Format:** NarrationScript JSON, executed via Python runner  
**Template:** Slide → Key Point → Slide → Key Point

**Narration sourcing rule (efficiency):**
- First, call `accordo_presentation_generateNarration` **once** without `slideIndex` to get narration for the whole deck.
- Then map those narration texts into `speak` steps in the script.
- Do not call narration generation once per slide unless you are selectively refreshing a changed slide.

**One-shot live presentation rule:**
- A narrated presentation has one real audience pass. Do **not** run a voice-only version and then rerun a corrected slide-moving version; hearing the same talk twice is a failure.
- Before any live playback, dry-run the script with `python3 skills/script-authoring/accordo-run.py <script.json> --dry-run` and verify there are no `unknown step type` warnings.
- The dry-run output must show slide navigation steps (`slide_open`, `slide_goto`, `slide_next`, or `slide_prev`) interleaved before `speak` steps.
- Use the actual runner vocabulary: `layout`, `slide_open`, `slide_goto`, `slide_next`, `slide_prev`, `open`, `highlight`, `clear_highlights`, `speak`, `delay`, and `call`. Do not use the generic `command` step; the current runner skips it.
- If the dry-run is wrong, fix the JSON before starting TTS. Never validate by playing narration aloud.

### Type 4: Code Review — Findings Report

**Audience:** Technical team  
**Purpose:** Present review findings  
**Format:** NarrationScript JSON, executed via Python runner  
**Template:** Verdict → Evidence → Findings → Recommendation

---

## Golden Rules (Automated Types 1–4)

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
{ "type": "layout", "area": "sidebar", "action": "close" },
{ "type": "layout", "area": "panel", "action": "close" },
{ "type": "delay",   "ms": 300 }
```

---

## Voice Selection Guide

| Script Type | Voice | Why |
|---|---|---|
| **Feature Demo** (general) | `bf_emma` | Warm, natural, versatile |
| **Feature Demo** (detailed/technical) | `af_nicole` | Clear, professional, easy to follow |
| **Architecture walkthrough** | `bm_george` | Formal, gives weight to decisions |
| **Code walkthrough** | `af_nicole` | Technical clarity |
| **Presentation / storytelling** | `af_heart` | Most expressive |
| **Findings / review** | `bm_lewis` | Clear, convincing |
| **Quick status update** | `af_sky` | Light, fast pacing |

> If content is detailed or risks being boring, use `af_nicole`. If engaging storytelling, use `bf_emma` or `af_heart`.

---

## Templates by Type

### Template: Feature Demo (Type 1)

```json
{
  "label": "D-02 Feature Demo: strokeDash Persists",
  "errPolicy": "abort",
  "steps": [
    { "type": "layout", "area": "sidebar", "action": "close" },
    { "type": "layout", "area": "panel", "action": "close" },
    { "type": "delay",   "ms": 300 },

    { "type": "speak",  "text": "Before this fix, changing an arrow to dashed in the diagram editor would reset to solid on reopen. Let's see it in action.", "voice": "af_nicole", "block": true },

    { "type": "open", "path": "/path/to/diagram.mmd" },
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Here's a flowchart with a solid arrow. I'll change it to dashed using the patch tool.", "voice": "af_nicole", "block": true },

    { "type": "call", "tool": "accordo_diagram_patch", "args": { ... }},
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Done. The arrow is now dashed. Now let's close and reopen to verify persistence.", "voice": "af_nicole", "block": true },

    { "type": "close", "path": "/path/to/diagram.mmd" },
    { "type": "delay",   "ms": 400 },
    { "type": "open", "path": "/path/to/diagram.mmd" },
    { "type": "delay",   "ms": 800 },
    { "type": "speak",   "text": "Reopened. The dashed style persisted. Before the fix it would have reverted.", "voice": "af_nicole", "block": true }
  ]
}
```

### Template: Code / Architecture Walkthrough (Type 2)

```json
{
  "label": "D-04 Code Walkthrough",
  "errPolicy": "abort",
  "steps": [
    { "type": "layout", "area": "sidebar", "action": "close" },
    { "type": "layout", "area": "panel", "action": "close" },
    { "type": "delay",   "ms": 300 },

    { "type": "speak", "text": "D-04 implements Z-shape routing for orthogonal edges. Let's look at the tests first.", "voice": "af_nicole", "block": true },

    { "type": "open", "path": "/path/to/edge-router.test.ts", "line": 140 },
    { "type": "delay",   "ms": 600 },
    { "type": "highlight", "path": "/path/to/edge-router.test.ts", "start": 140, "end": 160 },
    { "type": "speak",   "text": "ER-16 tests that two waypoints produce a Z-shape with seven points.", "voice": "af_nicole", "block": true },
    { "type": "clear_highlights" },

    { "type": "open", "path": "/path/to/edge-router.ts", "line": 177 },
    { "type": "delay",   "ms": 600 },
    { "type": "highlight", "path": "/path/to/edge-router.ts", "start": 177, "end": 210 },
    { "type": "speak",   "text": "The implementation builds a control chain from source through all waypoints.", "voice": "af_nicole", "block": true },
    { "type": "clear_highlights" }
  ]
}
```

### Template: Presentation Walkthrough (Type 3)

```json
{
  "label": "Architecture Overview Deck",
  "errPolicy": "abort",
  "steps": [
    { "type": "layout", "area": "sidebar", "action": "close" },
    { "type": "layout", "area": "panel", "action": "close" },
    { "type": "delay",   "ms": 300 },
    { "type": "slide_open", "deckUri": "/path/to/deck.md", "after_ms": 600 },
    { "type": "slide_goto", "index": 1, "after_ms": 500 },
    { "type": "delay",   "ms": 400 },
    { "type": "speak",  "text": "Three main components: the Hub, the Bridge, and the Editor tools.", "voice": "bf_emma", "block": true },
    { "type": "slide_next", "after_ms": 500 },
    { "type": "delay",   "ms": 500 },
    { "type": "speak",   "text": "The Hub manages AI sessions and routes tools.", "voice": "bf_emma", "block": true }
  ]
}
```

### Narration Style for Presentation Scripts

- Default style: do **not** announce slide numbers in spoken text.
- Prefer: concise topic-first narration (what the audience sees + key takeaway).
- Use numbered narration only when the user explicitly requests it.

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

1. **Feature demo that shows code** — If the user says "demo", they want to see the feature in the UI. Use Type 1, not Type 2.

2. **Speaking before showing** — The audience can't connect what they're hearing to what they're seeing.

3. **Skipping render delays** — Without 500–800ms after opening a file or slide, the audience sees a blank panel while narration starts.

4. **Non-blocking narration in demos** — Always `block: true`. If the script continues while narration plays, the next action fires before the audience finishes listening.

5. **Overlapping highlights** — Always `clear_highlights` before a new `highlight`.

6. **Long highlight durations** — Set `durationMs` to match narration length, not 20s.

7. **Using `bf_emma` for everything** — For detailed technical content `af_nicole` has better clarity.

---

## How to Choose

| Signal from user | Script Type |
|---|---|
| "demo the feature", "show me it's working" | **Manual Testing Guide (Type 0)** |
| "show me a narrated demo", "demo with voice" | **Feature Demo (Type 1)** |
| "walk through the implementation", "show me the code" | **Code Walkthrough (Type 2)** |
| "present the architecture", "walk the deck" | **Presentation (Type 3)** |
| "review findings" | **Code Review (Type 4)** |

**Default:** When a user says "demo" without specifying, use **Type 0** (manual testing guide). It's faster, works without a running script system, and lets the user experience the feature. Only use Type 1–4 if the user explicitly asks for narration.
