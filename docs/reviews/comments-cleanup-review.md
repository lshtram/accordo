# Comments Cleanup Review (2026-04-21)

## Scope reviewed

- `docs/20-requirements/requirements-comments.md`
- `docs/20-requirements/requirements-comments-panel.md`
- `docs/module-map-comments.md`
- `docs/10-architecture/comments-panel-architecture.md`
- `docs/10-architecture/architecture.md` (comments-navigation sections)
- `packages/comments/src/panel/__tests__/navigation-registry-integration.test.ts`
- `docs/testing-guide-comments.md` (new canonical testing guide)

## Findings addressed

1. **Tool naming drift removed**
   - Requirements now consistently document the canonical 8-tool `comment_*` MCP surface.
   - Internal inter-extension command IDs were corrected to the current underscore form (`accordo_comments_internal_*`).

2. **Comments panel docs aligned with implementation**
   - Container/view IDs, group modes, and in-context reply behavior now match current code paths.
   - Navigation requirements now reflect command-plan-driven dispatch in `navigation-router.ts` + `navigation-contract.ts`.

3. **Architecture wording normalized**
   - Top-level architecture no longer describes the custom comments panel as deferred backlog work.
   - Navigation registry section now documents current mixed state: command-driven runtime with registry contracts retained.

4. **Historical wording cleanup in tests**
   - `navigation-registry-integration.test.ts` comments now describe current guarantees instead of old “Phase A/B failing tests” framing.

5. **Canonical testing guide created**
   - Added `docs/testing-guide-comments.md` with:
     - automated checks and exact commands,
     - explicit verification from outside repo root (`/tmp`),
     - user-journey scenarios for panel and cross-surface navigation.

## Deferred / intentionally unchanged

- `packages/comments/package.json` lint script remains placeholder (`no lint configured yet`) to stay consistent with current package policy; this state is now explicitly documented in the testing guide.
- Archive documents under `docs/90-archive/` were not rewritten; they remain historical references.
