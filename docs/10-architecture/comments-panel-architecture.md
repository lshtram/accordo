# Accordo — Custom Comments Panel Architecture

**Status:** ACTIVE  
**Date:** 2026-05-02  
**Scope:** Custom `vscode.WebviewView` sidebar panel that serves as the primary navigation and triage surface for `accordo-comments`, while native inline comments remain active.  
**References:**
- `docs/20-requirements/requirements-comments-panel.md`
- `docs/10-architecture/comments-panel-webview-contract.md`
- `docs/30-development/accordo-patterns.md` `P-22`

---

## 1. Problem statement

The built-in VS Code comments panel cannot serve as the primary Accordo comments surface because it cannot properly route non-text anchors and cannot be shaped into the approved inline-conversation narrow-sidebar UX.

The first custom replacement used `TreeView`, but that layout is still too constrained for:
- grouped file sections in a narrow panel
- expandable inline conversation cards
- explicit in-row action controls without a second pane

Therefore the authoritative panel architecture is now a **single `WebviewView` sidebar panel**.

---

## 2. Solution overview

Replace the current extension-contributed TreeView panel with a `WebviewView` registered at the **same view id**: `accordo-comments-panel`.

Key design rules:
- `CommentStore` remains authoritative
- native gutter/widgets remain active and converge through store-driven reconciliation
- existing command ids remain authoritative
- thread header click toggles inline expansion/collapse
- explicit **Go** action performs navigation through the existing router/command path
- no second detail pane and no center/right split

---

## 3. Components

```
packages/comments/src/
├── comments-bootstrap.ts
├── panel-bootstrap.ts
├── panel/
│   ├── comments-webview-contract.ts   ← M45-WVC
│   ├── comments-webview-provider.ts   ← M45-WV
│   ├── navigation-router.ts           ← M45-NR
│   ├── panel-commands.ts              ← M45-CMD
│   ├── panel-filters.ts               ← M45-FLT
│   └── (projection builder module)    ← M45-PJ
```

### 3.1 Projection builder

Pure derivation from:
- `store.getAllThreads()`
- `store.isThreadStale(id)`
- `PanelFilters`
- ephemeral UI state (`expandedThreadIds`, `collapsedGroupIds`)

Output: webview-facing grouped view model.

### 3.2 Webview provider

Responsibilities:
- register the panel via `registerWebviewViewProvider(...)`
- serve initial HTML shell
- receive webview messages
- publish `panel:state`
- retain ephemeral UI state

### 3.3 Commands and router

Mutation and navigation authority stays where it already lives:
- `panel-commands.ts`
- `navigation-router.ts`

The webview is a presentation shell plus command launcher, not a second business-logic path.

---

## 4. Data flow

```
CommentStore ──► projection builder ──► WebviewView provider ──► webview DOM
     ▲                    │                     │                     │
     │                    │                     └──── receives ───────┘
     │                    │                           messages
     │                    │
     └──── panel commands ◄──── explicit action bridge ◄── user clicks/keys
                    │
                    └──── navigateToThread / store mutations
```

Semantics split:
- **toggle thread/group** → provider UI state only
- **Go / Reply / Resolve / Reopen / Delete / filters** → existing command ids

---

## 5. Coexistence with native comments

The custom webview panel is additive.

- native gutter `+` creation remains
- native inline thread widgets remain
- comment SDK/webview pins remain
- all mutations still converge through `CommentStore` → native reconcile

The panel does not replace the underlying comment system; it replaces only the old custom panel surface.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| webview boot/CSP/postMessage issues pass mocked tests but fail in real VS Code | require real extension-host boundary proof |
| expansion state lost on rerender | keep ephemeral UI state in provider, not in DOM only |
| command ids drift between old panel and new webview | preserve existing commands as single source of truth |
| accidental duplicate business logic in webview message handler | webview bridge delegates to existing commands/router/store paths |

---

## 7. Strategic note

This migration is intentionally a **panel-shell replacement**.

The critical architectural constraint is: the UI surface changes, but the command/store/navigation contracts remain authoritative. That is what makes the migration safe.
