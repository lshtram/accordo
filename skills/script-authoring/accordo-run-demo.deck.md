---
marp: true
theme: accordo-dark
paginate: true
---

<!-- _class: lead -->
<!-- _paginate: false -->

# 🎬 accordo-run.py
## Narrated walkthroughs without the LLM in the loop

*A JSON steps file + one permanent Python runner = fully interruptible, GPU-narrated demos*

---

# Why This Exists

Every time an AI agent narrated something before, it had to:

- Make **individual LLM round-trips** per tool call — slow
- Use `accordo_script_run` — which **can't be interrupted**
- Re-write Python glue code from scratch every time

**The solution:** one permanent runner. Agent writes only **JSON**.

---

# How It Works

```
  JSON steps file  →  accordo-run.py
                           │
                           ├── ~/.accordo/hubs.json    (find port)
                           ├── /proc/<pid>/environ     (live token)
                           │
                           └── POST localhost:3002/mcp (call tools)
```

Every step = one MCP tool call.
Runner handles **auth, sequencing, error recovery, and Ctrl+C**.

---

# Step Types

| Type | What it does |
|---|---|
| `speak` | Narrate via Kokoro TTS — GPU-accelerated, local |
| `open` | Open a file in the editor at a specific line |
| `highlight` | Highlight a line range in colour |
| `clear_highlights` | Remove all highlights |
| `slide_open` / `slide_goto` | Drive a Marp presentation |
| `layout` | Show/hide sidebar, panel, explorer |
| `delay` | Pause between steps |
| `call` | Raw escape hatch — any Accordo tool |

---

# The Result — A Self-Contained JSON File

```json
{ "project": "accordo", "label": "My Demo", "steps": [
  { "type": "speak",           "text": "Hello!", "voice": "af_nicole" },
  { "type": "open",            "path": "src/index.ts", "line": 42 },
  { "type": "highlight",       "path": "src/index.ts", "start": 42, "end": 55 },
  { "type": "speak",           "text": "Key function.", "voice": "af_nicole" },
  { "type": "clear_highlights" }
]}
```

**Run:** `python3 accordo-run.py demo.json`
**Stop:** `Ctrl+C` — clean exit after current step
**Resume:** `python3 accordo-run.py demo.json --from 3`
