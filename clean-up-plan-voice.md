# Voice Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-voice.md`
- [ ] Reconcile the requirements doc with the actual simplified TTS-only implementation
- [ ] Remove or rewrite references that still imply removed STT/dictation/runtime pieces if any remain
- [ ] Fix dependency contract drift for `kokoro-js`:
  - docs say `peerDependency`
  - package currently uses `dependencies`
- [ ] Reconcile default language if `en-US` is canonical but internal defaults still use `en`
- [ ] Remove or update references to missing test files such as `session-fsm.test.ts`
- [ ] Verify current requirement numbering and ensure tests/comments use the same IDs

### `docs/10-architecture/architecture.md`
- [ ] Update the top-level voice summary so it no longer says “TTS + STT + summary narration”
- [ ] Point to the current simplified voice architecture truth
- [ ] Remove stale descriptions of removed voice surfaces/features

### `docs/20-requirements/README.md`
- [ ] Fix package classification for voice
- [ ] Stop describing the active module as “TTS, dictation, voice policy tools” if dictation is removed

### `docs/testing-guide-narration-plugin.md`
- [ ] Reconcile plugin docs with the current narration control plane
- [ ] Replace stale mode names if needed (`narrate-full` vs `narrate-everything`)
- [ ] Remove outdated guidance that implies VS Code voice settings are the primary plugin control when `ACCORDO_NARRATION_MODE` is canonical
- [ ] Remove stale double-trigger / prompt-injection assumptions if no longer current

### `docs/20-requirements/requirements-narration-plugin.md`
- [ ] Reconcile whether the plugin is “alternative” narration control or the canonical control plane
- [ ] Align this doc with `voice-architecture.md` and current implementation reality

## B. High-priority code/behavior cleanup

### `packages/voice/src/extension.ts`
- [ ] Ensure MCP tool playback path has the same state/context parity guarantees as the VS Code command path
- [ ] Reconcile whether MCP-triggered narration should update `accordo.voice.narrating` context key
- [ ] Reconcile whether MCP-triggered narration should publish updated voice state through the bridge during playback

### `packages/voice/src/tools/read-aloud.ts`
- [ ] Reconcile tool schema and implementation if `block` or other historical fields still appear in docs/reviews
- [ ] Decide whether forcing `narrate-everything` when policy is `narrate-off` is intentional policy or doc drift
- [ ] Document the current tool behavior clearly as canonical

### `packages/voice/src/voice-bootstrap.ts`
- [ ] Decide whether `readVoiceConfig()` is still needed; remove if unused
- [ ] Replace old `REQ-VB-*` traceability comments with current requirement IDs or neutral comments
- [ ] Add/keep tests for config loading, state publish, and context-sync behavior

### `packages/voice/src/voice-adapters.ts`
- [ ] Remove or justify `buildReadyChimePcm()` if not part of current product scope
- [ ] Keep adapter selection logic documented as external-first, Kokoro fallback

## C. Test cleanup / additions

### Missing tests to add
- [ ] Add `session-fsm` tests or remove the requirements claim that they exist
- [ ] Add `external-tts` adapter tests
- [ ] Add `voice-bootstrap` tests
- [ ] Add integration-parity tests covering command path vs MCP tool path state/context behavior

### Existing tests needing wording cleanup
- [ ] Remove stale requirement-ID ranges/comments in:
  - `src/__tests__/extension.test.ts`
  - `src/__tests__/read-aloud.test.ts`
- [ ] Make test traceability map to current requirements, not legacy numbering

### Test support cleanup
- [ ] Review `src/__tests__/mocks/vscode.ts` and remove stale removed config keys (`whisper*`, `llm*`, etc.)

## D. Tooling / repo hygiene

### `packages/voice/package.json`
- [ ] Replace placeholder lint script with real linting
- [ ] Review setting descriptions so they match current product strategy (external-first vs Kokoro-only wording)
- [ ] Decide whether `kokoro-js` should remain a runtime dependency or move to peer/optional dependency, then align docs

### Generated/package-local artifacts
- [ ] Confirm `packages/voice/dist/**` is treated as generated output only
- [ ] Clean or ignore `packages/voice/tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

## E. Documentation / archive cleanup

### Active docs to refresh
- [ ] `docs/module-map-voice.md` — verify it reflects the current minimal package and not stale leftovers
- [ ] `docs/reviews/voice-simplification-second-pass-D2.md` — mark which findings are now fixed vs still open

### Historical docs to archive harder or mark clearly
- [ ] `docs/reviews/voice-modularity-A.md`
- [ ] `docs/00-workplan/handoff-B3-voice-diagram-editor.md`
- [ ] `docs/00-workplan/phase-2-handoff.md`
- [ ] `docs/00-workplan/workplan-modularity-waves.md`
- [ ] `docs/00-workplan/session-handoff-2026-03-29.md`
- [ ] `docs/00-workplan/architecture-presentation.md` voice references
- [ ] old archive testing guides that still describe STT/dictation/panel-era behavior

### Deprecated artifacts
- [ ] Remove or archive `scripts/demo-voice-script.mjs` if it only references removed tooling
- [ ] Review `skills/script-authoring/knowledge/voice-reference.md` for stale voice names / stale architecture assumptions

## F. Cross-module contract cleanup

### Voice ↔ narration plugin contract
- [ ] Align plugin docs, voice docs, and actual plugin code on one narration control story
- [ ] Make explicit which settings are authoritative:
  - `ACCORDO_NARRATION_MODE`
  - VS Code voice config
  - any Hub prompt behavior (if any remains)

### Voice ↔ Hub/Bridge state expectations
- [ ] Clarify which voice state fields are expected by Hub consumers
- [ ] Ensure docs match actual published state shape (`policy`, `ttsAvailable`, etc.)

## Recommended execution order
1. update voice requirements and top-level architecture summary
2. align narration-plugin docs with current control plane
3. fix MCP tool vs command-path state/context parity
4. add missing tests (`session-fsm`, `external-tts`, `voice-bootstrap`)
5. replace placeholder lint with real linting
6. remove/justify dead helpers and stale mocks
7. archive or mark historical old voice-era docs/artifacts more clearly
