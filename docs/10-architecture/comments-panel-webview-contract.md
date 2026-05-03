# Accordo Comments Panel — Webview Contract

**Status:** ACTIVE  
**Date:** 2026-05-02  
**Primary requirements:** `M45-WVC-01..10`

---

## 1. Scope

This document defines the internal host↔webview contract for the Accordo comments panel `WebviewView`.

It is:
- authoritative for message shapes and invalid-case handling
- internal to the VS Code extension implementation
- **not** a new MCP/public tool contract

---

## 2. Command model

The panel preserves the existing command ids. The webview does not invent new mutation or navigation commands.

### 2.1 Global commands

Global commands do not require `threadId`:
- `accordo.commentsPanel.refresh`
- `accordo.commentsPanel.filterByStatus`
- `accordo.commentsPanel.filterByIntent`
- `accordo.commentsPanel.clearFilters`
- `accordo.commentsPanel.groupBy`
- `accordo.commentsPanel.deleteAllBrowserComments`

### 2.2 Thread-scoped commands

Thread-scoped commands require `threadId`:
- `accordo.commentsPanel.navigateToAnchor`
- `accordo.commentsPanel.resolve`
- `accordo.commentsPanel.reopen`
- `accordo.commentsPanel.reply`
- `accordo.commentsPanel.delete`

Invalid combinations must fail safely and must not mutate store state.

---

## 3. Interaction semantics

### 3.1 Thread header/title

Thread header/title activation:
- toggles inline expansion/collapse
- does **not** navigate
- does **not** mutate the store

### 3.2 Go action

The explicit **Go** action invokes `accordo.commentsPanel.navigateToAnchor` and is the only row-level navigation trigger in the panel UX.

### 3.3 Group headers

Group header activation toggles collapsed/expanded state for the file/status group only. This state is ephemeral panel UI state.

---

## 4. Message taxonomy

### 4.1 Webview → host

- `panel:ready`
- `panel:toggle-group`
- `panel:toggle-thread`
- `panel:invoke-global-command`
- `panel:invoke-thread-command`

### 4.2 Host → webview

- `panel:state`
- `panel:error`

---

## 5. Invalid cases and precedence

Validation precedence:

1. unknown message type
2. malformed payload / missing required field
3. invalid command scope (global command sent as thread command, or vice versa)
4. missing thread id for thread-scoped command
5. unknown thread id
6. downstream command failure

Earlier failures take precedence over later ones.

---

## 6. Error vocabulary

The host-facing error vocabulary is intentionally small:

- `unknown-message`
- `invalid-payload`
- `invalid-command-scope`
- `missing-thread-id`
- `thread-not-found`
- `command-failed`

Errors are non-fatal to the panel unless VS Code destroys the webview itself.

---

## 7. Accessibility / keyboard contract

- group headers must be keyboard focusable and activatable with Enter/Space
- thread headers must be keyboard focusable and activatable with Enter/Space
- inline actions (`Go`, `Reply`, `Resolve`, etc.) must be tabbable buttons
- command palette remains a complete fallback path for every action
- focus order must remain stable after rerender

---

## 8. Runtime-doc impact

This change does **not** add a new MCP tool, hub skill resource, or public runtime API.

Required authoritative surfaces are therefore:
- requirements doc
- architecture doc
- this contract doc
- local TypeScript contract definitions in `packages/comments/src/panel/comments-webview-contract.ts`

No `accordo://skills/*` runtime documentation change is required unless the panel later becomes an MCP-facing runtime surface.
