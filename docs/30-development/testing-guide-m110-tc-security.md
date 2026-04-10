# M110-TC Security Features — Testing Guide

> Phase D3 · P2 security implementation
> Generated for manual testing verification before Phase E

---

## 1. Agent-Automated Tests

All tests pass: **604/605** (1 pre-existing environmental failure unrelated to this changeset).

```
cd packages/browser && pnpm test
```

| Test file | Tests | Status |
|---|---|---|
| `security-origin-policy.test.ts` | 24 | ✅ |
| `security-redaction.test.ts` | 27 | ✅ |
| `security-audit-log.test.ts` | 29 | ✅ |
| `security-structured-errors.test.ts` | 43 | ✅ |
| `security-tool-integration.test.ts` | 13 | ✅ |
| `capture-region-tabid.test.ts` | 8 | ✅ |
| All other browser tests | 460 | ✅ |

**Pre-existing failure** (`BR-F-123`): relay port mismatch when VS Code is running — unrelated to security features.

---

## 2. Manual Testing Scenarios

### Prerequisites

- Chrome browser running with Accordo Chrome extension installed
- VS Code with accordo-bridge and accordo-browser extensions active
- MCP gateway on port 3006 (`http://localhost:3006/mcp`, token: `<TOKEN>`)
- A test page with PII visible (or use `https://example.com/contact` which has no real PII)

### Security tools available

All tools accept the new security parameters. Call via curl:

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{}}}'
```

---

### F1: Origin Policy

**Test page**: `https://example.com`

#### F1-1: deniedOrigins blocks matching origin

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_page_map",
      "arguments":{"tabId":<TAB_ID>,"deniedOrigins":["https://example.com"]}
    }
  }'
```

**Expected**: `{"success":false,"error":"origin-blocked","retryable":false}`

#### F1-2: allowedOrigins blocks non-matching origin

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_page_map",
      "arguments":{"tabId":<TAB_ID>,"allowedOrigins":["https://other.com"]}
    }
  }'
```

**Expected**: `{"success":false,"error":"origin-blocked","retryable":false}`

#### F1-3: No policy = allow (backward compatible)

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_page_map",
      "arguments":{"tabId":<TAB_ID>}
    }
  }'
```

**Expected**: Normal page map response (no `origin-blocked`)

---

### F2: Text Redaction

**Test page**: A page with visible PII (e.g. a contact page with email/phone)

#### F2-1: redactPII: true redacts emails and phones

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_text_map",
      "arguments":{"tabId":<TAB_ID>,"redactPII":true}
    }
  }'
```

**Expected**: Response contains `"redactionApplied":true` and email/phone replaced with `[REDACTED]`

#### F2-2: redactPII: false / not set = no redaction

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_text_map",
      "arguments":{"tabId":<TAB_ID>}
    }
  }'
```

**Expected**: `redactionApplied` absent or `false`; no `[REDACTED]` in text

---

### F5: Redaction Warning

#### F5-1: text_map without redactPII → warning

**Expected**: Response includes `"redactionWarning":"PII may be present in response"`

#### F5-2: capture_region (any mode) → screenshot warning

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_capture_region",
      "arguments":{"tabId":<TAB_ID>,"rect":{"x":0,"y":0,"width":800,"height":600}}
    }
  }'
```

**Expected**: Response includes `"redactionWarning":"Screenshots are not subject to redaction policy."`

---

### F4: Audit Trail

#### F4-1: auditId in every response

Every response from `get_page_map`, `get_text_map`, `get_semantic_graph`, `capture_region` should include `"auditId":"<uuid>"`.

#### F4-2: browser-audit.jsonl written

Check for `browser-audit.jsonl` in the accordo-browser package directory. Each line should be a JSON object with `auditId`, `tool`, `pageUrl`, `origin`, `action`, `redacted`, `capturedAt`.

```bash
cat packages/browser/dist/browser-audit.jsonl | head -5
```

**Expected**: JSONL entries with increasing timestamps

---

### F6: Structured Errors

#### F6-1: origin-blocked error is non-retryable

Call with `deniedOrigins` (see F1-1). 

**Expected**:
```json
{
  "success": false,
  "error": "origin-blocked",
  "retryable": false
}
```

#### F6-2: timeout error is retryable

Trigger a timeout by calling with a very short timeout or a dead tab.

**Expected**:
```json
{
  "success": false,
  "error": "timeout",
  "retryable": true
}
```

#### F6-3: All error codes have retryable field

Verify `element-not-found`, `element-off-screen`, `no-target`, `image-too-large`, `capture-failed`, `browser-not-connected` all return structured errors with `retryable` set.

---

## 3. Interaction Model

### `interactiveOnly` depth bug fix

Navigate to a page with interactive elements nested deep in the DOM (e.g. Hacker News with story links inside `<table><tbody><tr><td>...<a>`).

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_get_page_map",
      "arguments":{"tabId":<TAB_ID>,"interactiveOnly":true,"maxDepth":2}
    }
  }'
```

**Expected**: Returns interactive elements (links, buttons) even though they are deeper than `maxDepth: 2` in the tree. Previously this returned 0 results.

---

## 4. Visual Capture

### Full-page screenshot

```bash
curl -s http://localhost:3006/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"accordo_browser_capture_region",
      "arguments":{"tabId":<TAB_ID>,"mode":"fullPage"}
    }
  }'
```

**Expected**: `{"success":true,"dataUrl":"data:image/...","width":<fullWidth>,"height":<fullHeight>,"mode":"fullPage"}` — screenshot should be taller than the viewport height.

### Viewport screenshot (default, backward compatible)

Omit `mode` or set `mode: "viewport"`.

**Expected**: Same as before — viewport-sized screenshot.

---

## 5. Running the Full Test Suite

```bash
# Browser package
cd packages/browser && pnpm test

# Browser extension package  
cd packages/browser-extension && pnpm test
```

Expected:
- `packages/browser`: 604/605 (1 pre-existing port-conflict failure)
- `packages/browser-extension`: 931/931

```bash
# TypeScript
cd packages/browser && pnpm exec tsc --noEmit
cd packages/browser-extension && pnpm exec tsc --noEmit

# Lint
cd packages/browser && pnpm lint
cd packages/browser-extension && pnpm lint
```
