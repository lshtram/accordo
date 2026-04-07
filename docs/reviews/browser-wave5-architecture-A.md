# Wave 5 — Browser MCP Server Improvements: Architecture Design (Phase A)

**Date:** 2026-04-06  
**Author:** Architect Agent  
**Scope:** H2/H3/H4 (Error Contract Uniformity), F2 (Actionability Taxonomy), I1 (redactPII on capture_region)  
**Status:** Phase A — interfaces & stubs, pending approval

---

## Table of Contents

1. [Non-Technical Summary](#1-non-technical-summary)
2. [Technical Summary](#2-technical-summary)
3. [Target H2/H3/H4 — Error Contract Uniformity](#3-target-h2h3h4--error-contract-uniformity)
4. [Target F2 — disabled/readonly Actionability Taxonomy](#4-target-f2--disabledreadonly-actionability-taxonomy)
5. [Target I1 — redactPII on capture_region](#5-target-i1--redactpii-on-capture_region)
6. [Decision Record](#6-decision-record)

---

## 1. Non-Technical Summary

**What problem are we solving?**

When our browser tools encounter errors, different tools report them in different formats — some include helpful advice for recovery, some don't. Some report how long they waited, others get that number wrong. And one of our screenshot tools is missing a privacy toggle that all its sibling tools already have. These inconsistencies confuse AI agents that rely on our tools.

**What are we doing about it?**

Three surgical fixes:

1. **Error uniformity (H2/H3/H4):** Every error response will now include a "recovery hint" — a short sentence telling the agent what to do next. We also fix a timer bug where one code path reports the configured timeout value instead of actual elapsed time.

2. **Actionability taxonomy (F2):** When we tell an agent about an interactive element (like a form field), we already report whether it's disabled or read-only — but the types used in communication between components are loosely defined. We tighten the type contract so agents can reliably check these states.

3. **Privacy toggle on screenshots (I1):** Every other tool has a `redactPII` on/off switch. The screenshot tool is missing it — so either the global setting forces redaction with no override, or there's no way to request redaction on a per-call basis. We add the same switch.

**What can go wrong?**

Very little — all three changes are additive. Existing fields keep their meaning. New fields are optional. Old clients that don't read `recoveryHints` or `redactPII` continue to work.

**How do we know it works?**

Each change comes with specific test cases that assert the new fields appear in responses, the timer values are accurate, and the privacy toggle correctly controls redaction behaviour.

---

## 2. Technical Summary

### Key Design Decisions

1. **`recoveryHints` added to `PageToolError`, not just `WaitToolError`.** The `WaitToolError` interface already carries `recoveryHints`. Rather than converting all handlers to `WaitToolError`, we add the field to `PageToolError` (the shared error shape used by all page-understanding tools) and add a `RECOVERY_HINTS` lookup table alongside the existing `TRANSIENT_ERRORS` table. This avoids refactoring call sites while unifying the contract.

2. **`buildStructuredError` gains `recoveryHints` automatically.** A new `RECOVERY_HINTS: Record<string, string>` map (keyed by error code) is queried inside `buildStructuredError`. No call-site changes needed — every existing caller gets recovery hints for free.

3. **`elapsedMs` bug fix is isolated to one line in `wait-tool.ts`.** The inline handler (`handleWaitForInline` in `page-tool-handlers-impl.ts` line 569-579) already captures `startMs` and computes real elapsed. Only the standalone `handleWaitFor` in `wait-tool.ts` line 249 uses `timeoutMs` (the clamped config value) instead of real elapsed. Fix: capture `startMs = Date.now()` before the relay call, use `Date.now() - startMs` in the fallback.

4. **F2 — readonly detection is already implemented.** The extension's `collectElementStates()` already detects `readonly` for `<input>` and `<textarea>`. `<select>` has no native `readOnly` property — this is correct. The gap is on the MCP type side: `InspectElementResponse.element` is typed as `Record<string, unknown>`, making it invisible to the eval harness. We add an `ElementStates` type and narrow the `element.states` field.

5. **I1 — `redactPII` added to `CaptureRegionArgs` using the same pattern as every other tool.** The handler already forwards `redactPatterns` from global config; the change gates that forwarding on `args.redactPII !== false` (default: honour global config, explicit `false` suppresses).

### How It Connects to the System

All changes are in `packages/browser/src/` — the Hub-side MCP server. No changes to the Chrome extension, Hub relay protocol, or Bridge. The type changes are internal to `page-tool-types.ts`; MCP schemas in tool definitions auto-derive from these types.

### Requirements Gaps Found

- **None.** All three targets map cleanly to existing requirement IDs (MCP-ER-001/002, MCP-SEC-002, B2-SV-003). No new requirements needed.

---

## 3. Target H2/H3/H4 — Error Contract Uniformity

### 3.1 Interface Changes

#### 3.1.1 `PageToolError` — add `recoveryHints` field

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** 346 (after `details`)

```typescript
// CURRENT (line 337-350):
export interface PageToolError {
  success: false;
  error: string;
  retryable?: boolean;
  retryAfterMs?: number;
  details?: string;
  pageUrl?: null;
  found?: false;
}

// PROPOSED — add one field after `details`:
export interface PageToolError {
  success: false;
  error: string;
  retryable?: boolean;
  retryAfterMs?: number;
  details?: string;
  /** Human-readable recovery guidance for the caller. MCP-ER-002. */
  recoveryHints?: string;
  pageUrl?: null;
  found?: false;
}
```

**Rationale:** This aligns `PageToolError` with `WaitToolError` (wait-tool.ts line 112-113) which already has `recoveryHints`. The field is optional so all existing callers are unaffected.

#### 3.1.2 `RECOVERY_HINTS` lookup table

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** 579 (after `TRANSIENT_ERRORS` closing brace)

```typescript
// NEW — add after TRANSIENT_ERRORS:
/** Human-readable recovery hints per error code. MCP-ER-002. */
const RECOVERY_HINTS: Record<string, string> = {
  "browser-not-connected":
    "Check that the browser relay is running and the Chrome extension is connected.",
  "timeout":
    "The operation timed out. Retry with a longer timeout or verify the page has loaded.",
  "action-failed":
    "The browser action failed. The element may have changed — take a fresh snapshot and retry.",
  "detached-node":
    "The target element was removed from the DOM. Take a new snapshot to find the updated element.",
  "capture-failed":
    "Screenshot capture failed. The tab may still be loading — wait briefly and retry.",
  "element-off-screen":
    "The element is outside the visible viewport. Scroll it into view before retrying.",
  "origin-blocked":
    "This origin is blocked by the security policy. Check allowedOrigins/deniedOrigins.",
  "invalid-request":
    "The request parameters are invalid. Check required fields and value constraints.",
};
```

#### 3.1.3 `buildStructuredError` — emit `recoveryHints`

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** 594-609 (the function body)

```typescript
// CURRENT (line 602-609):
  return {
    success: false,
    error: errorCode,
    ...(retryable ? { retryable: true, retryAfterMs } : { retryable: false }),
    ...(details !== undefined ? { details } : {}),
    pageUrl: null,
    found: false,
  };

// PROPOSED — add recoveryHints spread:
  const recoveryHints = RECOVERY_HINTS[errorCode];
  return {
    success: false,
    error: errorCode,
    ...(retryable ? { retryable: true, retryAfterMs } : { retryable: false }),
    ...(details !== undefined ? { details } : {}),
    ...(recoveryHints !== undefined ? { recoveryHints } : {}),
    pageUrl: null,
    found: false,
  };
```

**No call-site changes required.** Every handler that calls `buildStructuredError(code, details)` automatically gets `recoveryHints` in the response.

#### 3.1.4 `handleWaitFor` — fix `elapsedMs` bug

**File:** `packages/browser/src/wait-tool.ts`  
**Lines:** 234 and 249

```typescript
// CURRENT (line 234):
  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, RELAY_TIMEOUT_MS);

// PROPOSED — capture startMs before relay call:
  const startMs = Date.now();
  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, RELAY_TIMEOUT_MS);

// CURRENT (line 249):
    return response.data as WaitForResult ?? { met: false, error: "timeout", elapsedMs: timeoutMs, retryable: true, retryAfterMs: 1000 };

// PROPOSED — use real elapsed:
    return response.data as WaitForResult ?? { met: false, error: "timeout", elapsedMs: Date.now() - startMs, retryable: true, retryAfterMs: 1000 };
```

### 3.2 Implementation Notes

1. **`PageToolError` interface change** — purely additive, one optional field. No downstream breakage.
2. **`RECOVERY_HINTS` table** — co-located with `TRANSIENT_ERRORS` in the same file. Same key space. Easy to extend for future error codes.
3. **`buildStructuredError` change** — two lines added (const + spread). All 15+ existing callers benefit automatically.
4. **`handleWaitFor` elapsedMs fix** — move `const startMs = Date.now()` before the `try` block; replace `timeoutMs` with `Date.now() - startMs` in the fallback return on line 249. The `handleWaitForInline` (page-tool-handlers-impl.ts line 569) already does this correctly — no change needed there.
5. **Confirmed:** `buildStructuredError` already correctly populates `retryAfterMs` from `TRANSIENT_ERRORS` (line 599-600). The v4 eval gap was about `recoveryHints` being absent, not `retryAfterMs` being wrong.

### 3.3 Test Cases

**File:** `packages/browser/src/__tests__/security-structured-errors.test.ts`

| # | Test Name | Assertion |
|---|---|---|
| H2-1 | `buildStructuredError includes recoveryHints for transient error codes` | For each key in `TRANSIENT_ERRORS`, call `buildStructuredError(key)`, assert `result.recoveryHints` is a non-empty string. |
| H2-2 | `buildStructuredError includes recoveryHints for non-transient known codes` | Call `buildStructuredError("origin-blocked")`, assert `result.recoveryHints` is defined and `result.retryable` is false. |
| H2-3 | `buildStructuredError omits recoveryHints for unknown error codes` | Call `buildStructuredError("some-unknown-code")`, assert `result.recoveryHints` is undefined. |
| H3-1 | `PageToolError type accepts recoveryHints field` | Type-level test — construct a `PageToolError` with `recoveryHints`, verify it compiles (covered implicitly by H2 tests). |

**File:** `packages/browser/src/__tests__/wait-tool.test.ts`

| # | Test Name | Assertion |
|---|---|---|
| H4-1 | `handleWaitFor returns real elapsed time on timeout fallback` | Mock relay to return `{ success: false, error: "timeout" }` with a 50ms artificial delay. Assert `result.elapsedMs >= 50` and `result.elapsedMs < 200` (not equal to `timeoutMs`). |
| H4-2 | `handleWaitFor returns real elapsed time when relay data is undefined` | Mock relay to return `{ success: false, data: undefined }` after 30ms delay. Assert `result.elapsedMs >= 30`. |

---

## 4. Target F2 — disabled/readonly Actionability Taxonomy

### 4.1 Interface Changes

#### 4.1.1 `ElementStates` type — new type for structured element states

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** After `InspectElementResponse` (around line 370)

```typescript
// NEW — typed element states for actionability taxonomy:
/**
 * Typed actionability states for interactive elements.
 * F2: Agents can check disabled/readonly without parsing untyped string arrays.
 */
export interface ElementStates {
  /** Raw state strings from the browser extension (e.g. "disabled", "readonly", "required"). */
  states?: string[];
  /** Whether the element is disabled (non-interactive). */
  disabled?: boolean;
  /** Whether the element is read-only (visible but not editable). */
  readonly?: boolean;
  /** Whether the element is required in a form context. */
  required?: boolean;
  /** Whether the element is checked (checkboxes, radio buttons). */
  checked?: boolean;
  /** Whether the element is expanded (details, comboboxes). */
  expanded?: boolean;
}
```

#### 4.1.2 `InspectElementResponse.element` — narrow type

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** 360 (the `element` field on `InspectElementResponse`)

```typescript
// CURRENT:
  element?: Record<string, unknown>;

// PROPOSED:
  element?: Record<string, unknown> & Partial<ElementStates>;
```

**Rationale:** The intersection `Record<string, unknown> & Partial<ElementStates>` preserves backward compatibility (arbitrary keys still allowed) while making the known actionability fields visible to TypeScript. Agents accessing `response.element?.disabled` get type-safe access.

### 4.2 Implementation Notes

1. **No handler code changes.** The extension already populates `disabled`, `readonly`, `states` on the `element` object. The MCP handler passes through `response.data` as-is. The only change is the type annotation.
2. **No Chrome extension changes.** `collectElementStates()` in `semantic-graph-helpers.ts` already detects readonly for `HTMLInputElement` and `HTMLTextAreaElement`. `HTMLSelectElement` does not have a native `readOnly` property — this is correct behaviour, not a gap.
3. **The `ElementStates` type is a documentation/type-safety improvement**, not a runtime change. It makes the contract explicit so eval harnesses and agents can check fields without `as any` casts.

### 4.3 Test Cases

**File:** `packages/browser/src/__tests__/mcp-a11y-states.test.ts`

| # | Test Name | Assertion |
|---|---|---|
| F2-1 | `InspectElementResponse.element exposes typed disabled field` | Mock a relay response with `element: { disabled: true, states: ["disabled"] }`. Assert `result.element?.disabled === true`. Verify TypeScript accepts this without type assertion. |
| F2-2 | `InspectElementResponse.element exposes typed readonly field` | Mock a relay response with `element: { readonly: true, states: ["readonly"] }`. Assert `result.element?.readonly === true`. |
| F2-3 | `InspectElementResponse.element preserves arbitrary extra fields` | Mock with `element: { disabled: true, customProp: 42 }`. Assert both `disabled` and `customProp` are accessible. |

---

## 5. Target I1 — redactPII on capture_region

### 5.1 Interface Changes

#### 5.1.1 `CaptureRegionArgs` — add `redactPII` field

**File:** `packages/browser/src/page-tool-types.ts`  
**Line:** 163 (after `deniedOrigins`, before `transport`)

```typescript
// CURRENT (lines 160-169):
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  transport?: "inline" | "file-ref";

// PROPOSED — add redactPII between deniedOrigins and transport:
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  /** I1-text: When true, scan text content for PII and replace with [REDACTED].
   *  When false, suppress PII redaction even if global policy has patterns.
   *  When omitted, honour the global redaction policy. MCP-SEC-002. */
  redactPII?: boolean;
  transport?: "inline" | "file-ref";
```

#### 5.1.2 MCP tool schema — add `redactPII` to `capture_region` inputSchema

The `capture_region` tool definition's `inputSchema.properties` needs a `redactPII` entry. This is defined in the tool registration (wherever `capture_region`'s MCP schema is built).

**File:** Wherever the tool's JSON schema is constructed — likely in `page-tool-handlers-impl.ts` or a tool-definition file. Add:

```typescript
redactPII: {
  type: "boolean",
  description: "I1-text: When true, scan text content for PII and replace with [REDACTED].",
},
```

### 5.2 Implementation Notes

**File:** `packages/browser/src/page-tool-handlers-impl.ts`  
**Lines:** 438-442 (inside `handleCaptureRegionInline`)

```typescript
// CURRENT (lines 438-442):
    const payload: Record<string, unknown> = { ...args };
    const hasRedactPatterns = security.redactionPolicy.redactPatterns.length > 0;
    if (hasRedactPatterns) {
      payload.redactPatterns = security.redactionPolicy.redactPatterns.map((p: { pattern: string }) => p.pattern);
    }

// PROPOSED — gate on args.redactPII:
    const payload: Record<string, unknown> = { ...args };
    const hasRedactPatterns = security.redactionPolicy.redactPatterns.length > 0;
    // I1: redactPII controls whether global redaction patterns are forwarded.
    // undefined → honour global config (existing behaviour).
    // true → forward patterns (same as global, but explicit opt-in).
    // false → suppress redaction even if global patterns exist.
    const shouldRedact = args.redactPII !== false && hasRedactPatterns;
    if (shouldRedact) {
      payload.redactPatterns = security.redactionPolicy.redactPatterns.map((p: { pattern: string }) => p.pattern);
    }
```

**Behaviour matrix:**

| `args.redactPII` | Global patterns exist? | `redactPatterns` forwarded? |
|---|---|---|
| `undefined` | Yes | ✅ Yes (backward-compatible) |
| `undefined` | No | ❌ No |
| `true` | Yes | ✅ Yes |
| `true` | No | ❌ No (no patterns to forward) |
| `false` | Yes | ❌ No (explicit suppression) |
| `false` | No | ❌ No |

### 5.3 Test Cases

**File:** `packages/browser/src/__tests__/security-redaction.test.ts`

| # | Test Name | Assertion |
|---|---|---|
| I1-1 | `capture_region forwards redactPatterns when redactPII is undefined and global patterns exist` | Set global redaction patterns. Call handler with `redactPII: undefined`. Assert relay payload includes `redactPatterns`. |
| I1-2 | `capture_region forwards redactPatterns when redactPII is true` | Set global patterns. Call with `redactPII: true`. Assert relay payload includes `redactPatterns`. |
| I1-3 | `capture_region suppresses redactPatterns when redactPII is false` | Set global patterns. Call with `redactPII: false`. Assert relay payload does NOT include `redactPatterns`. |
| I1-4 | `capture_region does not forward redactPatterns when no global patterns exist` | No global patterns. Call with `redactPII: true`. Assert relay payload does NOT include `redactPatterns`. |
| I1-5 | `CaptureRegionArgs accepts redactPII field` | Type-level — construct `CaptureRegionArgs` with `redactPII: true`, verify compilation (implicit in I1-1..4). |

---

## 6. Decision Record

### ADR-W5-001: Recovery hints via lookup table, not per-call-site strings

**Context:** We need `recoveryHints` on every error response. Options: (a) add a hints parameter to `buildStructuredError` and require every call site to pass it, (b) use a lookup table keyed by error code.

**Decision:** Option (b) — `RECOVERY_HINTS` lookup table alongside `TRANSIENT_ERRORS`.

**Consequences:** Zero call-site changes. Hints are centralised and consistent. If a hint needs to be context-specific (e.g., including the failing element ID), the caller can pass it via the existing `details` field. `recoveryHints` is for generic, actionable guidance; `details` is for specifics.

### ADR-W5-002: `ElementStates` as intersection type, not replacement

**Context:** `InspectElementResponse.element` is `Record<string, unknown>`. We could replace it with a strict `ElementStates` type or intersect.

**Decision:** Intersection — `Record<string, unknown> & Partial<ElementStates>`. This preserves arbitrary extension fields while adding type-safe access to known states.

**Consequences:** No runtime change. Existing code that accesses arbitrary keys continues to work. New code gets autocompletion for `disabled`, `readonly`, etc. The tradeoff is that the type is permissive — but this matches the runtime reality where the extension may add new fields at any time.

### ADR-W5-003: `redactPII: false` explicitly suppresses, `undefined` honours global

**Context:** Other tools treat `redactPII` as a simple boolean flag. For `capture_region`, we need to decide what `undefined` means because the handler already has global-config-driven redaction.

**Decision:** Three-state: `undefined` = honour global config (backward-compatible), `true` = explicit opt-in, `false` = explicit suppression.

**Consequences:** Backward-compatible — existing callers that don't pass `redactPII` get the same behaviour as before. Agents that want to suppress redaction for a specific screenshot (e.g., capturing a non-sensitive page where redaction would damage the image) can pass `false`.

---

## Summary of Changes

| File | Change | Lines Affected |
|---|---|---|
| `page-tool-types.ts` | Add `recoveryHints?: string` to `PageToolError` | ~346 |
| `page-tool-types.ts` | Add `RECOVERY_HINTS` lookup table | ~580 (new block) |
| `page-tool-types.ts` | `buildStructuredError` emits `recoveryHints` | ~601-602 (2 lines) |
| `page-tool-types.ts` | Add `ElementStates` interface | ~370 (new block) |
| `page-tool-types.ts` | Narrow `InspectElementResponse.element` type | ~360 |
| `page-tool-types.ts` | Add `redactPII?: boolean` to `CaptureRegionArgs` | ~163 |
| `wait-tool.ts` | Capture `startMs` before relay call | ~234 |
| `wait-tool.ts` | Use `Date.now() - startMs` instead of `timeoutMs` | ~249 |
| `page-tool-handlers-impl.ts` | Gate redactPatterns forwarding on `args.redactPII` | ~438-442 |
| Tool schema definition | Add `redactPII` to `capture_region` inputSchema | TBD |

**Total: ~25 lines changed/added across 3 files + 1 schema update.**

All changes are additive. No existing field semantics change. No function signatures change. No new dependencies.
