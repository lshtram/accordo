# Visual Gap Research — AI Agent Display Layer
**Date:** 2026-03-20  
**Scope:** Evidence-based survey of the display layer gap for CLI-first AI coding agents  
**Audience:** Accordo product and engineering team  
**Status:** PRIMARY RESEARCH — all sources cited, no secondary summaries

---

## 1. Executive Summary

Between July 2025 and March 2026, at least **15 independent developers** built standalone visual companion tools for CLI AI agents (Claude Code, Codex CLI, OpenCode, Aider). Every tool solves one fragment of the same underlying problem: **CLI agents produce rich output — plans, diffs, diagrams, session traces, architectural changes — and the terminal renders none of it.**

The gap is real, widely felt among CLI-first senior developers, and currently addressed only through a fragmented collection of independent tools. No project attempts an integrated visual layer. Accordo is the exception.

---

## 2. The Tools People Built (Jan–Mar 2026)

These tools were built and shipped to Hacker News between January and March 2026. Star counts as of 2026-03-20.

### 2.1 Activity Visualization

**[vibecraft](https://github.com/Nearcyan/vibecraft)** — ⭐ 1,300 stars, 234 forks  
*"Manage Claude Code in style"*  
A 3D pixel-art workshop that visualizes which "station" Claude Code is at (Read → Bookshelf, Write → Desk, Edit → Workbench, Bash → Terminal, Grep → Scanner, WebFetch → Antenna, Task/subagents → Portal, TodoWrite → Taskboard). Sub-agent spawns show as mini-Claudes at a portal. Thought bubbles appear during thinking. Response feed alongside 3D scene. Multi-session support via tmux. Spatial audio.  
Requires: macOS/Linux, Node 18+, jq, tmux.  
HN submission: Jan 19, 2026 — https://news.ycombinator.com/item?id=46675634

**[SeeClaudeCode](https://seeclaudecode.fly.dev/)** — early stage  
*"See what Claude Code is actually doing"*  
Visualizes codebase structure (project/frontend/backend/database tree) with real-time file-change indicators showing which directories and files are being edited as they happen. Targets non-technical builders and PMs. Tagline: *"Development shouldn't be a black box. We bridge the gap between AI coding agents and humans."*  
HN submission: Jan 21, 2026 — https://news.ycombinator.com/item?id=46709893  
HN comment from `chux52`: *"This is a great idea. Any plans to take it further than what your page demos?"*

**[claudeye](https://www.npmjs.com/package/claudeye)** — early stage  
`npx claudeye` — visualizer for Claude Code and Agents SDK executions.  
HN submission: Feb 9, 2026 — https://news.ycombinator.com/item?id=46948878

**[CC Wiretap](https://github.com/wierdbytes/cc-wiretap)** — early stage  
Intercepts and visualizes Claude Code's LLM traffic in real-time.  
HN submission: Feb 14, 2026 — https://news.ycombinator.com/item?id=47014331

**[Claude Dungeon / claude-pixel-agent-web](https://github.com/thousandsky2024/claude-pixel-agent-web)** — small  
Visualizes Claude Code sessions as pixel-art dungeon heroes.  
HN submission: Mar 1, 2026 — https://news.ycombinator.com/item?id=47206796

**[Claude Quest](https://github.com/Michaelliv/claude-quest)** — ⭐ 7 points  
Pixel-art visualization for Claude Code sessions.  
HN submission: Jan 16, 2026 — https://news.ycombinator.com/item?id=46647099

---

### 2.2 Session History / Replay

**[claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer)** — ⭐ 674 stars, 70 forks  
Desktop app (Tauri + React + Rust). Reads `~/.claude/projects/` JSONL files. Renders conversation history with code diffs, tool call inputs/outputs, thinking blocks, token costs, session timelines. Now multi-provider: Claude Code + Codex CLI + OpenCode — one viewer for all three agents. Has a headless server mode (`cchv-server --serve`) for VPS/Docker deployment — access from any browser. Docker Compose provided. Real-time file watching via SSE.  
Available on macOS, Windows, Linux. Available via Homebrew.  
README available in 5 languages (English, Korean, Japanese, Chinese Simplified, Chinese Traditional).  
HN submission: Jul 3, 2025 — https://news.ycombinator.com/item?id=44459376

Builder quote (`jackleee`):
> *"I found it quite inconvenient to check the history in separate terminal tabs or editor windows. The process of reviewing AI coding results is crucial, but the existing terminal/editor approach was too cumbersome. I felt the need for a tool to view Claude's conversation history: more easily, more comprehensively, more intuitively."*

**[Claude Traces](https://claudetraces.dev/)** — early stage  
`npx claude-traces` — reads `~/.claude/projects/` traces, renders as timeline with token counts, tool inputs/outputs, subagent trees. Local server at localhost:3000.  
HN submission: Feb 14, 2026 — https://news.ycombinator.com/item?id=47018696

Builder quote (`hahawhatsgood`):
> *"I wanted an easy way to understand what my Claude agents were doing under the hood."*

**[Visualize full Claude Code CLI sessions in a rich UI](https://rcanand.gumroad.com/l/ccviewer)** — small  
Single-page HTML app that reads `~/.claude` session files. Shows detailed steps: thinking, tool calls/responses, code diffs. Search, sort, filter. Export as Markdown.  
HN submission: Jan 8, 2026 — https://news.ycombinator.com/item?id=46545981

Builder quote (`rcanand2025`):
> *"The best way to get the most out of Claude Code is to learn from past sessions. Review past sessions, see where it worked, where it went wrong... However, the sessions are saved across multiple json files with cross references, and are hard to read. The mindset when grappling with Claude Code in a session is not exactly ripe to later remembering the details of what went well or wrong and why."*

**[Visualize Claude Code's LLM Interactions](https://yuyz0112.github.io/claude-code-reverse/visualize.html)** — small  
Reverse-engineered Claude Code protocol, interactive visualization of LLM interactions.  
HN submission: Jul 28, 2025 — https://news.ycombinator.com/item?id=44712391

---

### 2.3 Markdown / Documentation Rendering

**[attn](https://github.com/lightsofapollo/attn)** — ⭐ 6 stars (brand new, Mar 5, 2026)  
Native markdown viewer, <20MB Rust binary. Launched from the terminal (`npx attnmd README.md`). OS webview (WebKit on macOS, WebKitGTK on Linux) — no Electron, no bundled Chromium. Live reload while agent is writing. ProseMirror editor inline (Cmd+E). Mermaid diagrams render inline. File tree + fuzzy search (Cmd+P). Interactive checkboxes write back to file. Tabs + multi-project. Paper/ink themes.  
GitHub: https://github.com/lightsofapollo/attn  
HN submission: Mar 5, 2026 — https://news.ycombinator.com/item?id=47263402

Builder quote (`lightsofapollo`), in full:
> *"I use Claude Code as my primary dev environment. It generates a lot of markdown. Planning docs, architecture notes, task lists. I wanted something purpose-built for reading markdown. Not a browser tab, not a preview pane in an editor. A real app I can launch from the terminal.*
> *VS Code's markdown preview is fine but I don't really use VS Code. I wanted something Claude Code could launch for me and get a nice readable window.*
> *Mermaid diagrams render inline. Agents love generating mermaid."*

---

### 2.4 Configuration / Management UI

**[CC Mate](https://github.com/djyde/ccmate)** — small  
Desktop app (Tauri, macOS/Windows/Linux). Visual JSON editor for Claude Code settings, MCP server management UI, agent management (markdown editing), global slash commands, CLAUDE.md editor, usage analytics charts.  
HN submission: Nov 16, 2025 — https://news.ycombinator.com/item?id=45946760

**[Configure Claude Code](https://configure-claude-code.vercel.app/)** — small  
Web-based visual configurator for Claude Code settings and permissions. No installation.  
HN submission: Jan 14, 2026 — https://news.ycombinator.com/item?id=46617534

**[Claude Stats](https://claude-stats.vercel.app/)** — small  
Visualize Claude Code usage statistics.  
HN submission: Jan 15, 2026 — https://news.ycombinator.com/item?id=46627483

**[SessionWatcher](https://www.sessionwatcher.com/)** — small  
macOS menu bar app. Tracks and visualizes Claude Code usage in real-time: sessions, tokens, cost estimates, 5-hour rolling limit monitoring.

---

## 3. What People Say (Community Quotes)

### 3.1 On the Need for Visual Feedback

**`mccoyb` (HN, Jul 2025)** — independent developer, discussing AI agent loop design:
> *"I spend a significant amount of time (a) curating the test suite, and making sure it matches my notion of correctness and (b) forcing the agent to make PNG visuals (which Claude Code can see, by the way, and presumably also Gemini CLI, and maybe Aider?)*
> *The visuals it makes for me I can inspect and easily tell if it is on the right path, or wrong. The test suite is a sharper notion of 'this is right, this is wrong' — more sharp than just visual feedback and my directions.*
> *The visuals are absolutely critical — as a compressed representation of the behavior of the codebase, which I can quickly and easily parse and recognize if there are issues."*
Source: https://news.ycombinator.com/item?id=44450160

**`SeeClaudeCode` homepage** (product positioning, Jan 2026):
> *"Can't figure out what Claude Code is doing? Don't worry! SeeClaudeCode visualizes your code base and shows you which files and folders Claude is editing in real-time."*
> *"Bridging the Gap: Development shouldn't be a black box. We bridge the gap between AI coding agents and humans."*

**`jackleee`** (claude-code-history-viewer README):
> *"The process of reviewing AI coding results is crucial, but the existing terminal/editor approach was too cumbersome. I felt the need for a tool to view Claude's conversation history: more easily, more comprehensively, more intuitively."*

### 3.2 On Review Being the New Primary Developer Activity

**`aspenmartin` (HN, Jan 1, 2026)** — described as "at my MAANG company, where I watch the data closely":
> *"My workflow is now:*
> *- Write code exclusively with Claude*
> *- Review the code myself + use Claude as a sort of review assistant to help me understand decisions about parts of the code I'm confused about*
> *- Provide feedback to Claude to change / steer it away or towards approaches*
> *- Give up when Claude is hopelessly lost"*

> *"Most (significant) LOC are written by agents, and most employees have adopted coding agents as WAU, and the adoption rate is positively correlated with seniority."*
Source: https://news.ycombinator.com/item?id=46449643

**`annjose` (HN, Mar 16, 2025)**:
> *"Yes reviewing the code take time, but it is far less than if I were to write all that code myself. It was eye-opening to realize that I need to be diligent about reviewing the code written by AI... We developers need to adapt and understand: Reading code — Understanding, verifying and correcting the code written by AI."*

### 3.3 On the Shift Happening at Scale

**`threethirtytwo` (HN, Jan 27, 2026)** — listing influential engineers who have endorsed agentic coding, including:
- **Mitchell Hashimoto** (HashiCorp/Terraform founder): *"detailed his workflow of using reasoning models (like o3) to generate comprehensive architecture plans before writing a single line of code... maintains strict engineering rigor by reviewing the output line-by-line"*
- **Addy Osmani** (Engineering Manager, Chrome): *"characterizes the modern senior engineer not as a typist but as a 'Director,' whose primary skill is effectively guiding AI agents to execute complex engineering tasks while maintaining architectural integrity"*
- **DHH** (creator of Rails): *"agentic coding has become a viable tool for experienced developers to deliver on specs rapidly"* — notably described as *"historically a skeptic of industry hype"*
- **Linus Torvalds**: Used Google Antigravity to vibe-code a Python visualizer, documented as *"basically written by vibe-coding"*
Source: https://news.ycombinator.com/item?id=46765460

### 3.4 On Agent Activity Being Invisible

**`rcanand2025`** (Visualize Claude Code sessions):
> *"In a live session, many steps are hidden by default and cannot be easily accessed later. The mindset when grappling with Claude Code in a session is not exactly ripe to later remembering the details of what went well or wrong and why."*

**`hahawhatsgood`** (Claude Traces):
> *"I wanted an easy way to understand what my Claude agents were doing under the hood... I tried to support timeline/token counts, tool inputs/outputs, subagents, and more."*

---

## 4. The Seven Visual Gap Categories

Based on the tools built and community language, these are the specific display surfaces that are missing or inadequate, ordered by evidence volume:

### Category 1 — Session History / Replay
**Evidence level: HIGHEST**  
Tools built: claude-code-history-viewer (674 ⭐), Claude Traces, ccviewer, claude-code-reverse-visualize  
The agent works for an hour, produces hundreds of file changes across dozens of tool calls. The developer needs to understand the journey — not just the end state. The JSONL files stored in `~/.claude/projects/` are unreadable raw (multiple cross-referenced files). Four separate tools were built just for this category.  
**What's missing:** Rendered conversation with diffs, tool calls shown as readable actions, thinking blocks visible, timeline with cost and token tracking. The ability to annotate a past session ("what went wrong here") is completely unsolved.

### Category 2 — Real-Time Agent Activity Visibility
**Evidence level: HIGH**  
Tools built: vibecraft (1,300 ⭐), SeeClaudeCode, claudeye, CC Wiretap, Claude Dungeon  
While the agent works, what is it doing right now? Terminal output is a scrolling firehose. Vibecraft's 1,300 stars — for a tool that requires tmux, jq, and Node — signals that this need is strong enough that developers install significant setup friction to satisfy it.  
**What's missing:** A visual map of current agent tool usage, which files are being edited, what the agent is "thinking about." The pixel-art framing of vibecraft is a delivery vehicle — the underlying demand is spatial/visual representation of agent state.

### Category 3 — Rendered Markdown / Documentation
**Evidence level: HIGH**  
Tools built: attn (Mar 2026)  
Agents produce enormous amounts of markdown: architecture plans, task lists, specs, meeting summaries, CLAUDE.md instruction files. The terminal renders none of it. VS Code's markdown preview requires VS Code. `attn` was built explicitly for the CLI-first user who doesn't live in VS Code.  
**What's missing:** Terminal-launchable markdown viewer with live reload (agent is still writing the doc), Mermaid rendering, and the ability to annotate inline. `attn` solves rendering but not annotation.

### Category 4 — Diagram / Architecture Visualization
**Evidence level: MEDIUM-HIGH**  
Context: 570 HN hits for "mermaid+AI" in 6 months. Agents generate Mermaid constantly (confirmed by `attn` builder: *"agents love generating mermaid"*). Microsoft's vscode-mermAId (106k installs) and Mermaid Editor (240k installs) exist but are passive renderers.  
**What's missing:** An interactive diagram surface that is both renderable by the agent AND editable by the human, with bidirectional sync. No existing tool does this.

### Category 5 — Live Browser / UI Preview
**Evidence level: MEDIUM**  
Context: Boris Cherny (Claude Code's creator) uses the Claude Chrome extension so the agent can test UI changes. Multiple developers describe keeping a browser + dev server open as standard workflow alongside CLI agents. This pattern is functional but completely disconnected from the agent's work stream.  
**What's missing:** The loop between agent code changes → rendered UI → agent sees rendered output → human annotates problems. Spatial commenting on web pages would close this loop.

### Category 6 — Code Diff Review
**Evidence level: MEDIUM**  
Context: The classic pain point. Currently addressed by: VS Code's built-in diff view, lazygit, `git diff` in terminal. It's inconvenient but not impossible.  
**What's missing:** Mid-session diff review (during an agent run, not post-session), spatially annotated with comments, with the ability for the human to mark "don't undo this" or "this part is wrong" and have the agent read those annotations.

### Category 7 — Task / Planning Visualization
**Evidence level: MEDIUM**  
Context: Vibecraft has a "Taskboard" station for TodoWrite tool calls. `attn` renders `- [ ]` checkboxes as interactive (click → writes back to file). CC Mate shows CLAUDE.md inline.  
**What's missing:** A visual task board that reflects agent progress in real-time — what was planned, what was completed, what failed, what was deferred.

---

## 5. The Market Split (Replacing 2024 Survey Data)

The 2024 Stack Overflow survey (73.6% VSCode, 62% AI adoption) is no longer the right reference. The current landscape has bifurcated:

### IDE-Native (majority)
Cursor, GitHub Copilot in VSCode, Windsurf, JetBrains AI. Agent lives inside the editor. Diff review is built in. The visual layer is the editor itself. This is the majority of AI-assisted developers.

### CLI-First (fast-growing minority, ~20-30% of active AI coding users)
Claude Code, Codex CLI, OpenCode, Aider. Agent lives in the terminal. No visual layer by default. This group is:
- Disproportionately senior (MAANG commenter `aspenmartin`: *"adoption rate is positively correlated with seniority"*)
- More productive per-session (multiple parallel agent runs, longer autonomous runs)
- More likely to build tooling (all 15 tools listed above came from this community)
- Globally represented (claude-code-history-viewer README in 5 languages)

### Convergence Signal
claude-code-history-viewer already supports Claude Code + Codex CLI + OpenCode in one viewer. This multi-agent posture will become the norm. Developers are not mono-agent loyal.

---

## 6. What Accordo Has vs. What's Missing

### What Accordo has that no other tool has

| Capability | Accordo Modality | Gap it fills |
|---|---|---|
| Rendered markdown with live annotation | `accordo-md-viewer` | Category 3 — and goes further than `attn` with comments |
| Interactive bidirectional diagrams | `accordo-diagram` (Mermaid + Excalidraw) | Category 4 — the only bidirectional tool |
| Presentation walkthroughs | `accordo-slidev` | Category 7 — plan communication + execution |
| Spatial comments on code, docs, diagrams, slides | `accordo-comments` + comment-sdk | Categories 3, 4, 6, 7 — unique cross-surface |
| Agent-steerable display (agent opens the view) | All modalities via MCP tools | Only integrated bidirectional system |
| System prompt awareness of what's open | `accordo_layout_state`, open comment threads | No other tool has this ambient loop |
| Voice narration and dictation | `accordo-voice` | No other CLI agent tool has TTS/STT |
| Spatial commenting on web pages | Browser extension (Session 12) | Category 5 — closes the live preview loop |

**The critical differentiator:** Every other tool in this list is **read-only** — it observes the agent. Accordo is **bidirectional** — the agent can open a view, the human annotates it, the agent reads the annotations. This is a fundamentally different architecture.

### What Accordo doesn't have yet

| Gap | Category | Evidence | Priority |
|---|---|---|---|
| Session replay / history viewer | 1 | 674-star tool built for this | HIGH — next after browser extension |
| Real-time agent activity feed | 2 | 1,300-star tool built for this | HIGH — `accordo_layout_state` is the right foundation |
| Diff review mode (mid-session) | 6 | Top community complaint | MEDIUM — comment-on-code is partial solution |
| Hub web dashboard (no VSCode needed) | Cross-cutting | cchv-server mode has demand | MEDIUM — editor-optional access |

---

## 7. Strategic Implications

### The Core Finding

The display gap is not about lacking a specific tool — it is about **fragmentation**. The current ecosystem is:

```
Claude Code / OpenCode / Aider / Codex CLI
              ↓
   [terminal — renders nothing]
              ↓
 [15+ separate tools, each solving one fragment]
   attn               → markdown
   vibecraft           → activity
   claude-code-history-viewer → session history  
   lazygit / VS Code diff     → code review
   browser + dev server       → live UI preview
   mermaid preview             → diagrams
   SeeClaudeCode               → real-time file map
   claude-traces               → session timeline
```

**Accordo is the only project attempting to be the integrated layer.**

### Surface Priority (Evidence-Based)

1. **Browser extension** (Session 12 — in progress) — Closes the live preview loop. Spatial commenting on web pages is unique. Correct.

2. **Hub web dashboard** — claude-code-history-viewer has Docker, VPS, headless server mode. Accordo Hub already runs as a server. A browser-accessible Accordo dashboard would make the system usable without VSCode at all, capturing the full CLI-first audience.

3. **Session replay** — The 674-star history viewer confirms demand. Accordo's comment threads already persist across sessions. Adding a "session narrative" view (timeline of agent tool calls + comments placed at each point) would be a unique integration nobody has.

4. **Real-time activity feed** — `accordo_layout_state` + open tabs gives the infrastructure. Surfacing this as a visual "what the agent is doing right now" panel would directly compete with vibecraft's core value prop — but integrated with annotation.

5. **Other editors** — Do not prioritize. The CLI-first users who need Accordo most are not primarily living in any specific editor — they're living in the terminal. Become editor-optional first, then follow adoption data to specific editors.

### On Editor Porting Specifically

The question of "which editor to port to next" is the wrong frame. The evidence shows:
- CLI-first developers are not editor-loyal (they use tmux, multiple terminals, and whatever editor is convenient for review)
- The browser/web surface is more universally accessible than any specific editor
- Zed's extension model (Rust/WASM) cannot support webview-based modalities like Excalidraw or Slidev — a hard technical barrier
- The right move is to make Accordo's visual layer accessible without any editor, which Session 12 begins

---

## 8. Sources Index

All URLs verified as of 2026-03-20.

| Tool / Source | URL |
|---|---|
| vibecraft | https://github.com/Nearcyan/vibecraft |
| SeeClaudeCode | https://seeclaudecode.fly.dev/ |
| claude-code-history-viewer | https://github.com/jhlee0409/claude-code-history-viewer |
| Claude Traces | https://claudetraces.dev/ |
| attn | https://github.com/lightsofapollo/attn |
| CC Wiretap | https://github.com/wierdbytes/cc-wiretap |
| claudeye | https://www.npmjs.com/package/claudeye |
| CC Mate | https://github.com/djyde/ccmate |
| Configure Claude Code | https://configure-claude-code.vercel.app/ |
| Claude Stats | https://claude-stats.vercel.app/ |
| Visualize full Claude Code CLI sessions | https://rcanand.gumroad.com/l/ccviewer |
| Visualize Claude Code LLM Interactions | https://yuyz0112.github.io/claude-code-reverse/visualize.html |
| Claude Dungeon | https://github.com/thousandsky2024/claude-pixel-agent-web |
| Claude Quest | https://github.com/Michaelliv/claude-quest |
| HN: attn launch thread | https://news.ycombinator.com/item?id=47263402 |
| HN: SeeClaudeCode launch thread | https://news.ycombinator.com/item?id=46709893 |
| HN: claude-code-history-viewer launch thread | https://news.ycombinator.com/item?id=44459376 |
| HN: Claude Traces launch thread | https://news.ycombinator.com/item?id=47018696 |
| HN: vibecraft launch thread | https://news.ycombinator.com/item?id=46675634 |
| HN: aspenmartin MAANG workflow comment | https://news.ycombinator.com/item?id=46449643 |
| HN: mccoyb on visual feedback loop | https://news.ycombinator.com/item?id=44450160 |
| HN: threethirtytwo on industry adoption | https://news.ycombinator.com/item?id=46765460 |
