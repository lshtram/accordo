## Review — voice-simplification-second-pass — Phase D2

### A) Overall verdict

**FAIL**

The second pass is **not yet acceptable as done** for the intended simplification. The core direction is correct (TTS-only, STT removed, Hub narration directives removed), but there are still functional and coherence defects that must be fixed first.

---

### B) Findings grouped by severity

#### Critical

- **`.opencode/plugins/narration.ts:230-235, 347, 359` — narration control-plane likely broken for real sessions**
  - `handleSessionIdle()` ignores `sessionId` and calls `extractLastAssistantText(client, "idle")`.
  - The plugin also passes `DEBOUNCE_KEY` (`"idle"`) into `handleSessionIdle`.
  - Impact: plugin may query a non-existent session id and fail to narrate actual assistant responses.
  - Fix: thread the real session id through debounce (or explicitly resolve active session id) and use it in `extractLastAssistantText()`.

#### High

- **`packages/voice/src/voice-adapters.ts:4, 13` + `docs/module-map-voice.md:17` — architecture/docs contradiction**
  - File comment says “No `vscode` imports”, but `voice-adapters.ts` imports `vscode`.
  - Module map repeats the same now-false claim.
  - Fix: either remove `vscode` dependency from adapter factory (preferred for clean boundaries), or update docs and comments to reflect actual boundary.

- **`packages/voice/package.json:50-52` vs docs (`voice-architecture.md:21`, `requirements-voice.md:73`) — keybinding mismatch**
  - mac binding is `ctrl+alt+r`, docs specify `Cmd+Alt+R`.
  - Fix: align implementation and docs (recommended: mac `cmd+alt+r`).

#### Medium

- **`packages/voice/src/tools/read-aloud.ts:47-50, 54-108` — schema advertises `block`, implementation ignores it**
  - Contract drift: argument is documented in tool schema but not used.
  - Fix: implement `block` behavior or remove it from schema/docs.

- **`packages/voice/package.json:6` — outdated package description**
  - Still says “via Kokoro” despite external-first strategy.
  - Fix: update description to external-first + Kokoro fallback wording.

- **`docs/20-requirements/requirements-voice.md:341` — dependency declaration mismatch**
  - Requirements table says `kokoro-js` is `peerDependencies`; actual manifest uses `dependencies`.
  - Fix: make docs match reality or change manifest intentionally.

- **`packages/voice/src/extension.ts:50` + `.opencode/plugins/narration.ts:336,338,342,358` — debug/prod logging concerns**
  - Default logger uses `console.log`; narration plugin logs each event at info level.
  - This conflicts with simplification/minimality intent and coding-guidelines “no leftover debug logs” standard.
  - Fix: reduce to essential logs only; avoid raw console logging in production paths.

#### Low / Follow-up

- **`packages/voice/src/core/audio/playback.ts:33-34, 114-129` — unused pause/resume complexity**
  - Minimal module still exposes pause/resume although main flow is single-shot readAloud.
  - Follow-up: remove if not needed by any current caller.

- **`packages/voice/src/voice-adapters.ts:49-70` — `buildReadyChimePcm()` appears leftover**
  - Not part of minimal readAloud path.
  - Follow-up: remove or document active use.

---

### C) Exact files/areas affected

1. `/data/projects/accordo/.opencode/plugins/narration.ts`
2. `/data/projects/accordo/packages/voice/src/voice-adapters.ts`
3. `/data/projects/accordo/docs/module-map-voice.md`
4. `/data/projects/accordo/packages/voice/package.json`
5. `/data/projects/accordo/docs/10-architecture/voice-architecture.md`
6. `/data/projects/accordo/docs/20-requirements/requirements-voice.md`
7. `/data/projects/accordo/packages/voice/src/tools/read-aloud.ts`
8. `/data/projects/accordo/packages/voice/src/extension.ts`
9. `/data/projects/accordo/packages/voice/src/core/audio/playback.ts` (follow-up only)

---

### D) Must fix before considering this done

1. Fix narration plugin session-id flow (`narration.ts`) so idle narration operates on real session messages.
2. Resolve adapter boundary contradiction (`voice-adapters.ts` vs docs/comments): either remove vscode import or update architecture/module-map claims.
3. Align mac keybinding with documented contract.
4. Resolve `read-aloud` schema/implementation drift for `block` arg.
5. Clean remaining high-noise debug logging in production paths.

---

### E) Can be follow-up

1. Remove or justify pause/resume surface in playback handle.
2. Remove or justify `buildReadyChimePcm()` leftover utility.
3. Tighten docs wording around dependency model (`dependencies` vs `peerDependencies`) and external-first messaging.

---

### Verification evidence executed

- `packages/voice`
  - `pnpm test` → **95 passed, 0 failed**
  - `pnpm typecheck` → **clean**
  - `pnpm lint` → **not a real lint gate** (`echo 'no lint configured yet'`)
- `packages/hub`
  - `pnpm test -- --run src/__tests__/prompt-engine.test.ts` triggered full run → **548 passed, 0 failed**
  - `pnpm typecheck` → **clean**
  - `pnpm lint` → **fails (pre-existing + touched file warning includes `prompt-engine.ts:107`)**
