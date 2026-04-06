# M115 — End-to-End `redactPII` Enforcement Plan

**Date:** 2026-04-05  
**Status:** Design ready  
**Scope:** `packages/browser`

---

## 1. Problem

Handler-level redaction is already the chosen architecture, but implementation is incomplete.

Current state:
- `get_text_map` and `get_semantic_graph` have redaction logic.
- `get_page_map`, `inspect_element`, and `get_dom_excerpt` expose `redactionWarning` expectations in docs/types but do not actually apply `redactPII`.
- audit logging currently records these tool paths as `redacted: false` even when the feature should apply.

This means the MCP-visible security contract is only partially implemented.

---

## 2. Goal

Make `redactPII` work consistently and fail-closed across all text-producing read tools:

1. `browser_get_text_map`
2. `browser_get_semantic_graph`
3. `browser_get_page_map`
4. `browser_inspect_element`
5. `browser_get_dom_excerpt`

---

## 3. Chosen Architecture

Keep the existing decision from `DEC-018`:

- redaction happens in `packages/browser` handlers, not in the content script
- relay responses may contain raw text on localhost
- the MCP response boundary is the enforcement point

This feature is therefore about completing the existing handler-level contract, not changing architecture.

---

## 4. Implementation Shape

### 4.1 Add `redactPII` to the missing arg types

Files:
- `packages/browser/src/page-tool-types.ts`

Add optional `redactPII?: boolean` to:
- `GetPageMapArgs`
- `InspectElementArgs`
- `GetDomExcerptArgs`

### 4.2 Add redaction helpers for the missing response shapes

Files:
- `packages/browser/src/security/redaction.ts`

Add helper functions for:
- `PageMapResponse`-like text-bearing node fields
- `InspectElementResponse`-like element/context text-bearing fields
- `DomExcerptResponse`-like `text` field

Design rule:
- redact only text-bearing fields
- do not mutate identifiers like `pageId`, `snapshotId`, `anchorKey`, `ref`, `id`, URLs, or structural keys
- mutate in place, consistent with current text/semantic helpers

### 4.3 Wire fail-closed enforcement into handlers

Files:
- `packages/browser/src/page-tool-handlers-impl.ts`

For `handleGetPageMap`, `handleInspectElement`, `handleGetDomExcerpt`:
- if `args.redactPII` is true:
  - apply redaction helper
  - set `redactionApplied` when any substitution occurs
  - on error, return `redaction-failed`
- else:
  - set `redactionWarning = "PII may be present in response"`
- audit log must record `redacted: true/false` correctly

### 4.4 Normalize the existing inline handlers

The inline text/semantic handlers already implement warning behavior but should be checked for parity:
- `handleGetTextMapInline`
- `handleGetSemanticGraphInline`

Goal:
- same fail-closed behavior
- same `redactionApplied`/warning behavior
- same audit semantics as the named handlers

---

## 5. Test Plan

### Unit/integration tests

Files likely involved:
- `packages/browser/src/__tests__/security-tool-integration.test.ts`
- `packages/browser/src/__tests__/...` existing page-tool tests

Add focused tests for:
1. `get_page_map({ redactPII: true })` redacts node text/name fields
2. `inspect_element({ redactPII: true })` redacts element/context text-bearing fields
3. `get_dom_excerpt({ redactPII: true })` redacts excerpt text
4. malformed regex policy returns `redaction-failed` for each newly covered handler
5. when `redactPII` is omitted, these tools return `redactionWarning`
6. audit trail records `redacted: true` when redaction occurred

### Live verification

Use a page/fixture containing PII-like strings and verify:
1. unredacted response includes warning
2. redacted response replaces the text
3. no raw PII survives in returned text-bearing fields

---

## 6. Non-goals

1. Screenshot OCR redaction parity
2. Content-script-side redaction
3. URL/identifier redaction
4. Redacting raw HTML markup in `get_dom_excerpt.html` beyond text-bearing fields

---

## 7. Success Criteria

M115 is done when:

1. all five text-producing read tools honor `redactPII`
2. failures are fail-closed with `redaction-failed`
3. unredacted calls consistently emit `redactionWarning`
4. audit logs reflect whether redaction actually occurred
5. live MCP tests confirm no raw PII leaks through the newly covered handlers
