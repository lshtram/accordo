# Review — S-02 Protocol Message Stubs + S-03 Roundness Comment

**Date:** 2026-04-02  
**Reviewer:** Reviewer agent  
**Files changed:**
- `packages/diagram/src/webview/panel-core.ts` (S-02)
- `packages/diagram/src/webview/scene-adapter.ts` (S-03, plus unrelated FNV fix)

---

## Test Suite

```
Test Files  22 passed (22)
     Tests  543 passed (543)
  Duration  2.85s
```

Zero failures, zero regressions.

## Type Checker

```
tsc --noEmit → (no output, exit 0)
```

Zero errors.

---

## S-02 — Protocol Message Stubs (`panel-core.ts`)

### Review point 1 — Case placement in switch

**PASS.**

The five new cases are placed at lines 177–185, immediately after the existing
`canvas:timing` case (line 175) and immediately before `comment:create` (line 187).
The `default:` handler remains last (line 202). Ordering is correct; the new cases
cannot shadow any existing case and cannot fall through to the wrong handler.

```
case "canvas:timing":       ← existing, line 174
    …
    break;
case "canvas:edge-routed":  ← new, line 177   ← ✓ before default
    …
    break;
case "canvas:node-added":   ← new, line 181
case "canvas:node-deleted":
case "canvas:edge-added":
case "canvas:edge-deleted": ← new, line 184
    …
    break;
case "comment:create":      ← existing, line 187
    …
default:                    ← existing, line 202
```

### Review point 2 — `msg.type` cast / narrowing correctness

**PASS — with one observation worth noting (not a defect).**

In both new case arms the only field accessed from `msg` is `msg.type`, which is the
discriminant present on every member of `WebviewToHostMessage`. This is unconditionally
safe regardless of payload shape.

The five message types and their relevant payload fields are:

| Message type | Protocol payload fields | Fields accessed in handler |
|---|---|---|
| `canvas:edge-routed` | `edgeKey: EdgeKey`, `waypoints: Array<{x,y}>` | `type` only |
| `canvas:node-added` | `id: string`, `label: string`, `position: {x,y}` | `type` only |
| `canvas:node-deleted` | `nodeId: NodeId` | `type` only |
| `canvas:edge-added` | `from: NodeId`, `to: NodeId`, `label?: string` | `type` only |
| `canvas:edge-deleted` | `edgeKey: EdgeKey` | `type` only |

The `canvas:edge-routed` case is intentionally kept separate from the four-way
fall-through because its future implementation comment is specific:
`patchEdge(layout, msg.edgeKey, { waypoints: msg.waypoints })`. When that is
implemented, `msg.edgeKey` and `msg.waypoints` will need to be accessed — keeping
the case isolated now means zero structural churn at that point. ✓

**Observation (informational):** `canvas:node-added`, `canvas:node-deleted`,
`canvas:edge-added`, and `canvas:edge-deleted` are grouped in a single fall-through.
Their future implementations will need separate cases (they have different payload
shapes). The grouping is fine for the stub phase but will need to be split at
implementation time. No action required now; document this for the implementer.

### Review point 3 — Log message clarity / `[diag.2]` tag

**PASS.**

Both log lines use the `[diag.2]` prefix, matching the naming convention used
elsewhere in the codebase for future-phase work. The messages are:

```
[diag.2] canvas:edge-routed — not yet implemented
[diag.2] canvas:node-added — not yet implemented
[diag.2] canvas:node-deleted — not yet implemented
[diag.2] canvas:edge-added — not yet implemented
[diag.2] canvas:edge-deleted — not yet implemented
```

`${msg.type}` is interpolated directly, so each case logs its own discriminant — no
chance of a wrong label.

---

## S-03 — Roundness Explanatory Comment (`scene-adapter.ts`)

### Review point 1 — Comment accuracy

**PASS — fully verified against Excalidraw source.**

The Excalidraw `ROUNDNESS` constant (confirmed from
`node_modules/@excalidraw/excalidraw/types/constants.d.ts`) is:

```
ROUNDNESS = {
  LEGACY: 1,
  PROPORTIONAL_RADIUS: 2,
  ADAPTIVE_RADIUS: 3,
}
```

The comment states `{ type: 2 } = PROPORTIONAL_RADIUS` — this is correct.

The comment further states that the radius "scales with element dimensions" — this is
the definition of `PROPORTIONAL_RADIUS` (as opposed to `ADAPTIVE_RADIUS = 3`, which
uses an absolute pixel radius capped at `DEFAULT_ADAPTIVE_RADIUS = 32`). Correct.

The comment states our numeric `roundness` value (8=rounded, 32=stadium) "controls
SHAPE selection in shape-map.ts" — this is a correct description of the internal
meaning of `ExcalidrawElement.roundness: number` before it is converted to
`ExcalidrawAPIElement.roundness: {type:2}|null`. The shape-map assigns roundness
values to shapes (e.g. `stadium` → higher value), and `toExcalidrawPayload` converts
any non-null value to `{type:2}` regardless of the original numeric magnitude.

The comment states "No user-settable 'amount' field exists in Excalidraw" — this is
accurate. The `roundness` object in the Excalidraw API has only `type: RoundnessType`
with no `value` or `radius` override field in this version.

### Review point 2 — Comment placement

**PASS.**

The comment is placed on lines 163–166, immediately above the `roundness:` assignment
on line 167. It replaced the single-line comment `// roundness: number → { type: 2 }
(PROPORTIONAL_RADIUS) | null` with a four-line block that provides the same
information plus the why. Placement is correct.

---

## Additional observation — unrelated change in same diff

The diff to `scene-adapter.ts` also contains an unrelated but correct change:
`Math.random()` seeds replaced with `fnv1a32()` deterministic seeds for `versionNonce`
and `seed`. This is the fix from module C4 (c4-deterministic-seed-D2.md) and was
previously reviewed. It is correctly landed here and causes no issues for this review.
All 8 scene-adapter tests continue to pass.

---

## Summary

| Item | Status |
|---|---|
| Tests: 543 passing, zero failures | ✅ PASS |
| Type checker: zero errors | ✅ PASS |
| S-02: case placement before `default:` | ✅ PASS |
| S-02: `msg.type` narrowing — only discriminant accessed, safe for all 5 types | ✅ PASS |
| S-02: `[diag.2]` log messages clearly mark future features | ✅ PASS |
| S-03: comment accuracy — `type:2 = PROPORTIONAL_RADIUS` verified | ✅ PASS |
| S-03: comment placement immediately above `roundness:` line | ✅ PASS |
| No banned patterns introduced (`any`, `!` without comment, TODO/FIXME) | ✅ PASS |
| No debug logs in production paths | ✅ PASS |

## Verdict

**PASS.** Both changes are correct, accurate, and clean. No defects found.

One informational note for the implementer: when the four grouped stub cases
(`canvas:node-added`, `canvas:node-deleted`, `canvas:edge-added`, `canvas:edge-deleted`)
are wired up in diag.2, they will need to be split into separate `case` arms because
their payload shapes differ.
