# @accordo/capabilities

Typed inter-extension capability interfaces for Accordo IDE.

Replaces string-based `vscode.commands.executeCommand` calls with typed interfaces.

## Package purpose

`@accordo/capabilities` provides:

- **Command ID constants** — canonical string values for all stable and deferred cross-extension commands
- **Capability interfaces** — typed contracts for comments, preview, diagram, presentation, and browser modalities
- **Navigation adapter registry** — a runtime factory (`createNavigationAdapterRegistry`) enabling surface packages to register navigation adapters for cross-surface comment routing

## Stable vs Deferred surface

The package exports two command constant namespaces:

| Namespace | Contents | Status |
|---|---|---|
| `CAPABILITY_COMMANDS` | 8 stable commands (comments, preview, diagram) | Active — consumers must use these |
| `DEFERRED_COMMANDS` | 3 deferred commands (presentation, browser focus) | Deferred — for fallback invocation only |

Three interfaces are also deferred and live in `deferred.ts` (not re-exported from package root as active contracts):

- `PresentationCapability`
- `BrowserCapability`

## Command naming conventions

**MCP tool names** use underscores: `accordo_<modality>_<action>`
e.g. `accordo_presentation_open`, `accordo_comments_get_store`

**Internal VS Code command names** use dots or underscores with `internal` segment:
e.g. `accordo.presentation.open`, `accordo_comments_internal_getStore`, `accordo_presentation_internal_goto`

The capability constants always match the internal VS Code command string values.

## Navigation registry API

The registry allows surface packages to register `NavigationAdapter` instances for cross-surface comment thread navigation:

```ts
import { createNavigationAdapterRegistry } from "@accordo/capabilities";

const registry = createNavigationAdapterRegistry();
registry.register({
  surfaceType: "slide",
  async navigateToAnchor(anchor, env) { /* ... */ },
  async focusThread(threadId, anchor, env) { /* ... */ },
});
```

Registered adapters are used by `navigateToThread` in `accordo-comments` for surface-aware dispatch.

## Usage

```ts
import { CommentsCapability, CAPABILITY_COMMANDS } from "@accordo/capabilities";
```
