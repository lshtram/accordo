# Test Plan — Priority S Terminal Output Readback

**Module:** Priority S — `accordo_terminal_read` + observed `accordo_terminal_run`
**Phase A status:** design/stubs only

---

## 1. Traceability matrix

| Requirement | Planned verification | Phase |
|---|---|---|
| S-TR-01 | handler tests resolve explicit `terminalId` first, then active-terminal fallback, including active untracked terminal adoption | B/C |
| S-TR-02 | cursor tests prove incremental read semantics and reject cross-terminal cursor reuse | B/C |
| S-TR-03 | bounds tests prove default limits, hard caps, and `truncated` signaling | B/C |
| S-TR-04 | redaction tests prove obvious secrets are scrubbed before MCP response payloads | B/C |
| S-TR-05 | lifecycle tests prove close/reset clears retained output and invalidates stale cursors | B/C |
| S-TR-06 | validation tests prove deterministic error precedence/messages for missing target, bad bounds, and cursor mismatch | B/C |
| S-TR-07 | terminal.run tests prove command dispatch remains the only execution path while optional observe preview is additive | B/C |
| S-TR-08 | backward-compatibility tests prove omitted/zero `observeMaxLines` keeps the legacy dispatch-only response shape | B/C |
| S-TR-09 | preview/read continuity tests prove inline observe and terminal.read share the same cursor lineage, bounds, and redaction pipeline | B/C |
| S-TR-10 | terminal.run validation tests prove command validation precedes observe validation, which precedes terminal resolution | B/C |
| S-TR-11 | follow-up read tests prove `accordo_terminal_read` remains the authoritative incremental continuation surface after inline preview | B/C |

---

## 2. Planned test files

| File | Requirement scope | Focus |
|---|---|---|
| `terminal-read.test.ts` | S-TR-01 (terminalId resolution) | Handler resolves explicit then fallback |
| `terminal-read-cursor.test.ts` | S-TR-02 (cursor semantics) | Incremental reads, cross-terminal rejection |
| `terminal-read-bounds.test.ts` | S-TR-03-01..04 (default limits, custom bounds) | Defaults applied to buffer.read |
| `terminal-read-truncated.test.ts` | S-TR-03-05..11 (truncated signaling, bounds validation) | Signal passthrough, error vocabulary |
| `terminal-read-redaction.test.ts` | S-TR-04 (redaction) | Redactor via real runtime pipeline |
| `terminal-read-lifecycle.test.ts` | S-TR-05 (close/reset lifecycle) | Registered close event clears buffer, stale cursors rejected |
| `terminal-read-precedence.test.ts` | S-TR-06 (deterministic validation precedence) | Error precedence order |
| `terminal-read-registration.test.ts` | S-TR-REG (tool registration metadata) | Static tool definition |
| `terminal-observe-legacy.test.ts` | S-TR-07..08 (dispatch-only, backward compat) | No observe field when observeMaxLines=0/omitted |
| `terminal-observe-preview.test.ts` | S-TR-09..10 (observe preview, validation precedence) | Observe via real shared pipeline, observeMaxChars validation |
| `terminal-observe-authority.test.ts` | S-TR-11 (run→read continuity authority) | Runtime continuation through real cursor path |

---

## 3. Contract-hardening closure matrix

### 3.1 Contract scope

- Module: Priority S terminal output readback + observed terminal.run preview
- Public surfaces affected: `accordo_terminal_read` MCP contract, `accordo_terminal_run` MCP contract, editor tool registration, terminal command shim surface
- Requirements/IDs: S-TR-01..11

### 3.2 Input invariants

- `terminalId`, when provided, must identify a live tracked terminal.
- If `terminalId` is omitted, a live active terminal must exist.
- `since`, when provided, is opaque and valid only for the same terminal lineage that produced it.
- `maxLines` and `maxChars` are optional positive integers with hard caps.
- `observeMaxLines` is optional for `terminal.run`; omitted or `0` disables inline preview.
- `observeMaxChars` is only meaningful when `observeMaxLines > 0`.

### 3.3 Invalid combinations

- `terminalId` missing + no active terminal → reject with `"No active terminal"`.
- `terminalId` provided but not live → reject with `"Terminal <id> not found"`.
- `since` cursor from another terminal → reject with `"Cursor does not belong to terminal <id>"`.
- `maxLines` or `maxChars` outside allowed bounds → reject with the documented argument error before any read attempt.
- `observeMaxLines` negative/non-integer/out of range → reject with the documented observe argument error before terminal resolution.
- `observeMaxChars` invalid while `observeMaxLines > 0` → reject with the documented observe char error.
- `observeMaxChars` supplied while `observeMaxLines` is omitted/0 → ignored for backward compatibility; no preview is attempted.

### 3.4 Validation and error precedence

Order of checks (highest precedence first):

1. `terminal.run`: command validation.
2. Numeric bound validation for `maxLines` / `maxChars` / `observeMaxLines`, plus `observeMaxChars` only when `observeMaxLines > 0` enables preview.
3. Terminal target resolution (`terminalId` first, else active terminal or create-on-run behavior).
4. Cursor/terminal compatibility validation for `terminal.read`.
5. Dispatch (`terminal.run`) or bounded read (`terminal.read`).
6. Optional inline preview + truncation + redaction using the shared read pipeline.

### 3.5 Public error vocabulary

- Allowed messages:
  - `"Argument 'command' must be a non-empty string"`
  - `"No active terminal"`
  - `"Terminal <id> not found"`
  - `"Cursor does not belong to terminal <id>"`
  - `"Argument 'maxLines' must be an integer between 1 and 500"`
  - `"Argument 'maxChars' must be an integer between 1 and 20000"`
  - `"Argument 'observeMaxLines' must be 0 or an integer between 1 and 500"`
  - `"Argument 'observeMaxChars' must be an integer between 1 and 20000"`
- Forbidden degradations:
  - silent fallback from an invalid explicit `terminalId` to the active terminal
  - replaying unbounded output
  - leaking unredacted obvious secrets when redaction rules match
  - diverging preview vs read cursor lineages for the same terminal output stream

### 3.6 Proof boundary plan

- Unit/helper tests: request validation, cursor semantics, truncation, redaction, inline-preview continuity, close/reset lifecycle.
- Package integration tests: tool registration count/metadata, command shim registration, activation wiring.
- Runtime/public-boundary proof: one real MCP `terminal_run(observeMaxLines>0)` preview flow and one `terminal_run` → `terminal_read` continuation flow in editor package or live validation session.
- Real E2E: recommended after implementation because VS Code terminal output fidelity is the main residual risk.

### 3.7 Runtime documentation impact

- Tool descriptions updated: yes — `accordo_terminal_read` remains the incremental contract, and `accordo_terminal_run` now documents optional inline observe preview plus backward-compatible omission behavior.
- Runtime instructions updated: no new instruction clause planned in Phase A.
- MCP docs resources updated: none in Phase A; tool description is the runtime-authoritative guidance for this additive tool.

### 3.8 Modularity/extraction plan

- Touched production files and expected sizes:
  - `packages/editor/src/tools/terminal-read/` — focused readback module family (`index.ts`, `contracts.ts`, `stubs.ts`, `tools.ts`)
  - `packages/editor/src/tools/terminal/` — focused terminal control split (`terminal-state.ts`, `terminal-open.ts`, `terminal-run.ts`, `terminal-close.ts`, tool-definition files)
  - `packages/editor/src/tools/terminal.ts` — thin public barrel only
  - `packages/editor/src/extension.ts` — minimal registration/init wiring
  - `packages/editor/src/tools/command-shims.ts` — one new shim slot
- Touched test files and focus boundaries:
  - `terminal-read.test.ts` — S-TR-01 (terminalId resolution)
  - `terminal-read-cursor.test.ts` — S-TR-02 (cursor semantics)
  - `terminal-read-bounds.test.ts` — S-TR-03-01..04 (default limits)
  - `terminal-read-truncated.test.ts` — S-TR-03-05..11 (truncation, bounds validation)
  - `terminal-read-redaction.test.ts` — S-TR-04 (redaction)
  - `terminal-read-lifecycle.test.ts` — S-TR-05 (close/reset lifecycle)
  - `terminal-read-precedence.test.ts` — S-TR-06 (validation precedence)
  - `terminal-read-registration.test.ts` — S-TR-REG (registration metadata)
  - `terminal-observe-legacy.test.ts` — S-TR-07..08 (dispatch-only, backward compat)
  - `terminal-observe-preview.test.ts` — S-TR-09..10 (observe preview, precedence)
  - `terminal-observe-authority.test.ts` — S-TR-11 (run→read authority)
- Planned helper/module extraction seams:
  - `TerminalOutputSource`
  - `TerminalOutputBuffer`
  - `TerminalOutputRedactor`

---

## 4. PASS-ELIGIBLE-IN-B register

| Case | Why pass-eligible on stubs |
|---|---|
| `S-TR-REG-01..05` | Tool definition metadata is intentionally correct in Phase A stubs — registration shell is a deliberate Phase A deliverable. |
| `S-TR-07-01..02` | Stub correctly returns `{ sent: true, terminalId }` for dispatch-only path — no observe field present. |
| `S-TR-08-01..02` | Stub has no observe validation → dispatch-only path works → observeMaxChars ignored when observeMaxLines=0. |
| `S-TR-10-01` | Command validation is the only validation currently wired in stub. |
| `S-TR-10-03` | Stub does not validate observeMaxChars → observeMaxLines=0 bypasses all observe logic. |

### 4.1 Non-pass-eligible tests that must fail at assertion level

These tests verify runtime behavior not yet implemented in stubs — they MUST fail until Phase C:

| Test | Expected failure |
|---|---|
| `S-TR-01-01..05` | `expected spy to be called` — stub never calls buffer.read |
| `S-TR-02-01..03` | `expected spy to be called` — stub never calls buffer.read |
| `S-TR-03-01..04` | `expected spy to be called` — stub never calls buffer.read |
| `S-TR-03-05..11` | `expected 'not implemented' to be 'Argument ...'` — wrong error |
| `S-TR-04-01..02` | `expected spy to be called` — redactor never called |
| `S-TR-05-01..02` | `expected { error: 'not implemented' }` — handler returns "not implemented" |
| `S-TR-06-01..06` | Error string mismatch: 'not implemented' vs exact vocabulary |
| `S-TR-09-01..02` | `expected { sent: true } to have property "observe"` — observe not implemented |
| `S-TR-10-02,04,05,06,07` | `expected { sent: true } to have property "error"` — observe validation not wired |
| `S-TR-11-01..02` | `expected spy to be called` — observe pipeline not wired; static schema only proves registration, not continuation behavior |

### 4.2 Runtime-proof surface requirements

Phase B tests for S-TR-04, S-TR-05, S-TR-09, S-TR-11 must use real runtime dependencies (not hand-crafted mock returns) so that code cannot pass if the runtime pipeline is unwired or stub-only:

- **S-TR-04 runtime-proof**: Tests must exercise `terminalOutputRedactor` (the real redactor from `runtime-redactor.ts`) via the shared deps pipeline, not a spy with custom implementation.
- **S-TR-05 runtime-proof**: Tests must prove buffer.reset/clear occurs through the registered close lifecycle (VS Code `onDidCloseTerminal` or equivalent close handler), not through a manual `buffer.clearTerminal` call. S-TR-05-01 must verify the registered close handler is wired; S-TR-05-02 must prove stale cursors fail through the real handler path.
- **S-TR-09 runtime-proof**: `terminal_run(observeMaxLines>0)` tests must use `terminalOutputBuffer.read` from `runtime-buffer.ts` (or an equal real implementation) so that observe preview fails if the buffer's `append` path is unwired or the cursor encoder/decoder is mismatched.
- **S-TR-11 runtime-proof**: Tests must prove `terminal_read` continues from the cursor emitted by a prior `terminal_run(observe)` using the real runtime buffer's cursor format (not a synthetic mock cursor). The cursor continuation test uses the actual `makeCursor`/`cursorKey` format so that a format mismatch between encoder and decoder causes test failure.
- **Buffer cursor continuation**: Runtime cursor format is `t-{terminalId}:{base64url(timestamp:terminalId:lineIndex:charOffset)}`. Tests must assert the cursor returned by read is in this format and that using it in a subsequent read returns new content, not duplicates. This validates the encoder/decoder round-trip.

(End of file - total 180 lines)