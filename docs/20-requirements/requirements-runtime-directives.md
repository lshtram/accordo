# Runtime Directives — Requirements Specification

**Scope:** Cross-cutting Accordo runtime guidance contract for MCP clients  
**Priority:** Y — MCP Runtime Directives Source-of-Truth  
**Date:** 2026-04-25

---

## 1. Purpose

Accordo must deliver mandatory operating directives to MCP clients through **runtime-visible channels**, not only through repository files. The runtime contract must be stable, testable, and diagnosable.

This module hardens guidance consistency only. It does **not** change tool execution semantics or gateway policy behavior.

---

## 2. Ownership Model

| Layer | Role | Owner |
|---|---|---|
| Canonical directive bundle | Single source of truth for mandatory directives, IDs, version, and digest | `accordo-hub` |
| `initialize.instructions` | Primary delivery channel for connected MCP clients | `accordo-hub` |
| `GET /instructions` | Human-readable runtime mirror of the same bundle | `accordo-hub` |
| Tool descriptions | Reinforcement only; must not contradict the canonical bundle | Tool-owning package |
| Requirements/docs | Normative wording and traceability | Documentation |
| Delivery diagnostics | Proof of what bundle/version a client received | `accordo-hub` |

---

## 3. Runtime Contract

### 3.1 Canonical bundle

The runtime directives contract is a versioned bundle with stable clause IDs.

```typescript
interface RuntimeDirectiveBundle {
  version: string;
  digest: string;
  clauses: RuntimeDirectiveClause[];
}

interface RuntimeDirectiveClause {
  id: string;
  summary: string;
  instruction: string;
  requirementIds: string[];
  parityTargets: Array<"initialize" | "instructions" | "tool-description" | "diagnostics">;
}
```

### 3.2 Mandatory delivery channels

| ID | Requirement |
|---|---|
| Y-01 | A single canonical runtime-directives bundle exists in code and is the only allowed source for mandatory directive wording used at runtime. |
| Y-02 | MCP `initialize` responses include a stable `## Runtime Directives` section rendered from that bundle. |
| Y-03 | `GET /instructions` includes the same directive bundle, in the same clause order, with the same version and digest metadata. |
| Y-04 | Mandatory directives required for safe Accordo operation must be fully understandable from `initialize.instructions` alone; repo files are supplemental only. |
| Y-05 | Tool descriptions may reinforce or specialize directives, but they must not contradict the canonical bundle. |

### 3.3 Versioning and diagnostics

| ID | Requirement |
|---|---|
| Y-06 | The bundle exposes a machine-testable `version` and `digest` so operators and tests can prove equivalence across runtime surfaces. |
| Y-07 | The Hub exposes authenticated JSON endpoints for (a) `GET /runtime-directives`, which returns the canonical bundle payload plus ownership metadata, and (b) `GET /runtime-directives/diagnostics`, which returns the active publication metadata plus per-session delivery receipts. |
| Y-08 | Delivery receipts record at minimum: MCP session ID, detected client/agent hint, delivery channel (`initialize` and optional `/instructions` fetch), bundle version, bundle digest, and timestamp. |

### 3.4 Parity protection

| ID | Requirement |
|---|---|
| Y-09 | Automated parity checks fail if any required clause is missing from `initialize.instructions`, `GET /instructions`, or declared tool-description reinforcement targets. |
| Y-10 | Automated parity checks fail if a tool description claims a runtime-doc location or directive path that is not implemented and testable. |
| Y-11 | Requirement-to-clause traceability is explicit: every mandatory directive clause references at least one requirement ID, and every Priority Y requirement maps to at least one clause or diagnostic assertion. |

### 3.5 Scope guardrails

| ID | Requirement |
|---|---|
| Y-12 | Priority Y must preserve existing tool behavior and confirmation policy; only guidance consistency, delivery, and diagnostics are in scope. |
| Y-13 | Existing runtime-doc references that are not backed by an implemented mechanism must either be replaced by implemented runtime paths or flagged by parity checks as invalid. |

---

## 4. Initial mandatory clauses for Priority Y

Priority Y only standardizes clauses that already exist as mandatory Accordo guidance:

1. Use Accordo tools for editor/file/UI operations when available.
2. Mandatory project skill routing for matching tasks.
3. Tool descriptions are secondary guidance; primary runtime directives come from initialize and `/instructions`.
4. Runtime guidance must not rely on repo-only files for external MCP clients.

Future priorities may add more clauses, but they must extend the same bundle rather than introduce a second source of truth.

---

## 5. Acceptance criteria

1. `GET /runtime-directives` requires bearer authentication and rejects missing or invalid tokens.
2. `GET /runtime-directives` returns one canonical publication payload with `bundle.version`, `bundle.digest`, ordered clauses, and ownership metadata identifying Hub as the owner.
3. `GET /runtime-directives/diagnostics` requires bearer authentication and rejects missing or invalid tokens.
4. `GET /runtime-directives/diagnostics` returns the same publication metadata as `GET /runtime-directives` plus delivery receipts for each observed MCP session/channel pair.
5. Delivery receipts include session ID, agent hint, delivery channel, bundle version, bundle digest, and timestamp.
6. Parity validation fails when initialize output, `/instructions`, tool-description reinforcement targets, or declared runtime-doc references drift from the canonical bundle.
7. Priority Y introduces no tool execution or confirmation-policy behavior change.
