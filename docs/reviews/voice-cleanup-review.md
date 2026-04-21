# Voice Cleanup Review (2026-04-21)

## Summary

Cleanup focused on contract drift and parity:
- aligned voice + narration docs with current TTS-only, plugin-controlled model
- removed stale voice bootstrap/API leftovers
- added missing tests for `SessionFsm`, `ExternalTtsAdapter`, and `voice-bootstrap`
- added MCP-vs-command state/context parity hook for `accordo_voice_readAloud`

## What was fixed

1. **MCP playback parity**
   - `createReadAloudTool()` now supports `onStateChange` callback
   - extension wires this to shared `syncUiAndState()`
   - tool path now updates context key + bridge state similarly to command path

2. **Default language coherence**
   - `DEFAULT_VOICE_POLICY.language` updated from `en` to `en-US`

3. **Dead helper removal**
   - removed `buildReadyChimePcm()` (unused in minimal TTS-only product)
   - removed unused `readVoiceConfig()` from `voice-bootstrap.ts`

4. **Test coverage additions**
   - `session-fsm.test.ts`
   - `external-tts.test.ts`
   - `voice-bootstrap.test.ts`
   - extension parity assertion for MCP tool path state/context sync

5. **Documentation alignment**
   - voice requirements, narration-plugin requirements, architecture section 16,
     requirements index, module map, and narration testing guide updated to current behavior

## Validation

- `packages/voice`: `pnpm test` ✅ (108 passing)
- `packages/voice`: `pnpm typecheck` ✅
- `packages/voice`: `pnpm lint` ✅ (still placeholder script by design)

Additional check (plugin tests via ad-hoc runner):
- `pnpm dlx vitest run .opencode/plugins/narration.test.ts .opencode/plugins/narration.resolve-config.test.ts`
  - 44 passing, 1 failing (`NP-02` debounce test currently flaky/failing)

## Remaining follow-up (not blocked for this cleanup)

- Replace placeholder voice lint script with a real lint gate once workspace ESLint/tooling baseline is standardized for this package.
- Investigate `.opencode/plugins/narration.test.ts` debounce assertion failure (`NP-02`) separately from this contract-cleanup batch.
