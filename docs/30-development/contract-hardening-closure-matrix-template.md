# Contract-Hardening Closure Matrix Template

Use this template in Phase A whenever a task changes a public contract
(MCP/runtime/API/relay/error taxonomy/validation precedence).

---

## 1) Contract scope

- Module:
- Public surfaces affected:
- Requirements/IDs:

## 2) Input invariants

- Invariant 1:
- Invariant 2:

## 3) Invalid combinations

- Case A → expected rejection/error:
- Case B → expected rejection/error:

## 4) Validation and error precedence

Order of checks (highest precedence first):

1.
2.
3.

## 5) Public error vocabulary

- Allowed error codes/messages:
- Forbidden degradations (must not happen):

## 6) Proof boundary plan

- Unit/helper tests:
- Package integration tests:
- Runtime/public-boundary proof:
- Real E2E (if applicable):

## 7) Runtime documentation impact

- Tool descriptions updated:
- Runtime instructions updated:
- MCP docs resources updated:

## 8) Modularity/extraction plan

- Touched production files and expected sizes:
- Touched test files and focus boundaries:
- Planned helper/module extraction seams:

## 9) PASS-ELIGIBLE-IN-B register (if needed)

Only include tests that can legitimately pass against stubs.

| Test ID | Why pass-eligible in B | Proof moved to phase |
|---|---|---|
|  |  |  |
