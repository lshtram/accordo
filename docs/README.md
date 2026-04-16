# Accordo Documentation

**Single source of truth for Accordo IDE design, requirements, and development guides.**

---

## Quick Navigation

| I'm looking for... | Go to... |
|---|---|
| Current work status and upcoming tasks | [00-workplan/workplan.md](00-workplan/workplan.md) |
| Completed milestones and historical outcomes | [00-workplan/accomplished-tasks.md](00-workplan/accomplished-tasks.md) |
| System design and architecture | [10-architecture/](10-architecture/) |
| Feature requirements | [20-requirements/](20-requirements/) |
| Code standards and patterns | [30-development/](30-development/) |
| How to test current features | [40-testing/](40-testing/) |
| Current authoritative reviews | [40-reviews/](40-reviews/) |
| Historical review evidence | [50-reviews/](50-reviews/) |
| Historical docs and superseded plans | [60-archive/](60-archive/) |

---

## Start Here

### New to the project?
1. Read [10-architecture/architecture.md](10-architecture/architecture.md) for system overview
2. Check [00-workplan/workplan.md](00-workplan/workplan.md) for current status
3. Review [30-development/coding-guidelines.md](30-development/coding-guidelines.md) before contributing

### Looking for a specific feature?
- **Comments on code/visuals** → [10-architecture/comments-architecture.md](10-architecture/comments-architecture.md)
- **Browser extension** → [10-architecture/browser-extension-architecture.md](10-architecture/browser-extension-architecture.md)
- **Voice/TTS/STT** → [10-architecture/voice-architecture.md](10-architecture/voice-architecture.md)
- **Diagrams** → [10-architecture/diagram-architecture.md](10-architecture/diagram-architecture.md)
- **Presentations** → [10-architecture/presentation-architecture.md](10-architecture/presentation-architecture.md)

### Current priorities (2026-04-08)
- Browser continuity for agents (non-active-tab access must work)
- DEC-024 reload-reconnect hardening and E2E validation
- Documentation harmonization and archive cleanup

---

## Directory Structure

### 00-workplan/ — Current Planning
Active workplans and roadmaps.

| File | Purpose |
|---|---|
| [workplan.md](00-workplan/workplan.md) | Active backlog only (open items + next execution queue) |
| [accomplished-tasks.md](00-workplan/accomplished-tasks.md) | Completed sessions/modules and evidence pointers |
| [workplan-modularity-waves.md](00-workplan/workplan-modularity-waves.md) | Code quality and modularity improvement plan |

### 10-architecture/ — System Design
Architecture documents by modality. Each doc includes "Last Updated" and "Status" sections.

| File | Scope | Status |
|---|---|---|
| [architecture.md](10-architecture/architecture.md) | Master system architecture | ACTIVE |
| [comments-architecture.md](10-architecture/comments-architecture.md) | Comments system (code + visual) | ACTIVE |
| [comments-panel-architecture.md](10-architecture/comments-panel-architecture.md) | Custom comments panel | ACTIVE |
| [browser-extension-architecture.md](10-architecture/browser-extension-architecture.md) | Chrome extension + relay | ACTIVE |
| [browser2.0-architecture.md](10-architecture/browser2.0-architecture.md) | Browser upgrade (P1/P2/P3) | DRAFT |
| [voice-architecture.md](10-architecture/voice-architecture.md) | TTS/STT/voice tools | ACTIVE |
| [presentation-architecture.md](10-architecture/presentation-architecture.md) | Marp presentations | ACTIVE |
| [diagram-architecture.md](10-architecture/diagram-architecture.md) | Mermaid/Excalidraw diagrams | ACTIVE |
| [layout-state-architecture.md](10-architecture/layout-state-architecture.md) | IDE state capture | ACTIVE |

### 20-requirements/ — Functional Requirements
Requirements by package/component. Each includes module IDs for TDD traceability.

**Core:**
- [requirements-hub.md](20-requirements/requirements-hub.md) — MCP server, SSE, auth
- [requirements-bridge.md](20-requirements/requirements-bridge.md) — VS Code bridge, WebSocket
- [requirements-editor.md](20-requirements/requirements-editor.md) — Editor/terminal/workspace tools

**Modalities:**
- [requirements-comments.md](20-requirements/requirements-comments.md) — Comments system
- [requirements-comments-panel.md](20-requirements/requirements-comments-panel.md) — Custom panel
- [requirements-comments-sdk.md](20-requirements/requirements-comments-sdk.md) — Comment SDK
- [requirements-browser-extension.md](20-requirements/requirements-browser-extension.md) — Browser extension
- [requirements-browser2.0.md](20-requirements/requirements-browser2.0.md) — Browser 2.0 upgrade
- [requirements-voice.md](20-requirements/requirements-voice.md) — Voice tools
- [requirements-marp.md](20-requirements/requirements-marp.md) — Presentations
- [requirements-diagram.md](20-requirements/requirements-diagram.md) — Diagrams
- [requirements-script.md](20-requirements/requirements-script.md) — Scripted walkthroughs **(Removed 2026-04-16)**
- [requirements-md-viewer.md](20-requirements/requirements-md-viewer.md) — Markdown viewer

### 30-development/ — Development Guides

| File | Purpose |
|---|---|
| [coding-guidelines.md](30-development/coding-guidelines.md) | TypeScript style, banned patterns, review checklist |
| [patterns.md](30-development/patterns.md) | Generic agent tool patterns |
| [accordo-patterns.md](30-development/accordo-patterns.md) | Accordo-specific patterns |
| [mcp-webview-agent-evaluation-checklist.md](30-development/mcp-webview-agent-evaluation-checklist.md) | Browser capability evaluation |
| [setup-windows.md](30-development/setup-windows.md) | Windows development setup |
| [retrospective.md](30-development/retrospective.md) | Project retrospectives |

### 40-testing/ — Active Testing Guides
Testing guides for current/in-progress features.

| File | Feature |
|---|---|
| [testing-guide-session-15.md](40-testing/testing-guide-session-15.md) | Page understanding + region capture |
| [testing-guide-m113-sem.md](40-testing/testing-guide-m113-sem.md) | Semantic graph (browser 2.1 W2) |

### 40-reviews/ — Current Authoritative Reviews
Current gate reviews, live evaluations, and recent architecture reviews that still describe the active system.

### 50-reviews/ — Historical Review Evidence
Older review evidence and planning-era review material that is still useful for traceability but is no longer the primary reference set.

**2026-03-29 Reviews:**
- [full-project-modularity-plugin-review-2026-03-29.md](50-reviews/full-project-modularity-plugin-review-2026-03-29.md) — Full project modularity review
- [browser-stack-readability-modularity-review-2026-03-29.md](50-reviews/browser-stack-readability-modularity-review-2026-03-29.md) — Browser stack review
- [mcp-webview-evaluation-live-2026-03-29.md](50-reviews/mcp-webview-evaluation-live-2026-03-29.md) — Live evaluation
- [mcp-webview-evaluation-e2e-2026-03-29.md](50-reviews/mcp-webview-evaluation-e2e-2026-03-29.md) — E2E runtime evidence evaluation

**Current Module Reviews:**
- m113-sem-*.md — Semantic graph modules
- m112-text-*.md — Text map modules
- m111-eval-*.md — Evaluation harness
- m109-wait-*.md — Wait primitives
- m10x-* — Browser 2.0 modules

### 60-archive/ — Historical Documents
Superseded docs, handoffs, and session notes kept for reference.

### 90-archive/ — Legacy Historical Documents
Older archived material retained during the ongoing documentation migration.

- **90-archive/testing/** — Old testing guides (completed sessions)
- **90-archive/reviews/** — Old review documents
- **90-archive/tdd/** — TDD phase documents (A, B, B2, etc.)
- **90-archive/research/** — Research docs, design explorations
- **90-archive/requirements/** — Superseded requirements
- **90-archive/architecture/** — Superseded architecture docs

---

## Document Conventions

### Status Badges
All architecture and requirements docs include a status:
- **ACTIVE** — Current, maintained, referenced
- **DRAFT** — In design, not yet implemented
- **SUPERSEDED** — Replaced by another doc (link provided)
- **ARCHIVED** — Historical reference only

### Module IDs
Requirements docs use module IDs (e.g., M90-MAP, M100-SNAP) for traceability:
- **Mxxx** = Module identifier
- First digit = Session/phase
- TDD phases reference these IDs

### File Naming
- **kebab-case** for all files
- **requirements-{feature}.md** for requirements
- **testing-guide-{feature}.md** for testing guides
- **{module}-{phase}.md** for reviews (e.g., m113-sem-D2.md)

---

## Contributing

1. **Update the workplan** when starting new work
2. **Follow status conventions** on all docs
3. **Archive, don't delete** — Move superseded docs to 60-archive/
4. **Keep one authoritative review set** — current reviews live in 40-reviews/, older evidence in 50-reviews/
5. **Maintain this README** — Update navigation when adding/moving docs

---

## Stats

- **Active docs:** ~40 (00- through 50-)
- **Archived docs:** legacy 90-archive/ plus active migration into 60-archive/
- **Total reduction:** Consolidated from 79+ scattered files to organized structure
- **Last reorganization:** 2026-03-29

---

*For questions about documentation structure, see the workplan §10 or ask in #accordo-dev.*
