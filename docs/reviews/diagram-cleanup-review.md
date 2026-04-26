# Diagram Cleanup Review (2026-04-21)

## Scope reviewed

- `docs/30-development/module-maps/module-map-diagram.md`
- `docs/20-requirements/requirements-diagram.md`
- `docs/10-architecture/diagram-architecture.md`
- `docs/10-architecture/architecture.md` (diagram/comments navigation contract section)
- `packages/diagram/src/layout/layout-store.ts`
- `packages/diagram/src/extension.ts`
- `docs/40-testing/testing-guide-diagram.md` (new canonical testing guide)

## Findings addressed

1. **Module-map drift corrected**
   - Rewrote module map to match current package layout and active boundaries.
   - Removed stale/non-existent file references and corrected tool/command inventory.
   - Removed stale “single vscode importer” claim.

2. **Requirements status consistency**
   - Updated metadata and wording to align with current active architecture state.
   - Clarified open-items language so shipped parser families (state/class) are not described as pending.
   - Confirmed current test total remains **1016 passing**.

3. **Diagram architecture command/tool alignment**
   - Updated command IDs to current extension contributions (`accordo-diagram.open`, `accordo-diagram.newCanvas`) and internal focus command (`accordo_diagram_focusThread`).
   - Updated active MCP tool table to current shipped surface.
   - Added explicit historical/deferred note for fine-grained proposed tool family.
   - Updated Mermaid pin reference to current package version (`11.12.3`).

4. **Cross-module contract clarity**
   - Top-level architecture now explicitly documents command ownership chain:
     capabilities constant → diagram extension implementation → comments router consumption.

5. **Code comment hygiene**
   - Updated stale source references in `layout-store.ts` comments to current canonical docs.
   - Clarified `extension.ts` 2-second focus wait as conservative synchronization strategy, with event-driven migration intent.

6. **Canonical testing guide added**
   - Added `docs/40-testing/testing-guide-diagram.md` with validated automated commands and user-journey checks.

## Deferred / intentionally unchanged

- Placeholder lint script in `packages/diagram/package.json` remains unchanged (`no lint configured yet`) to stay consistent with current package policy.
- Historical roadmap/changelog material in `diagram-architecture.md` was not removed wholesale; it remains documented as historical planning context where applicable.
