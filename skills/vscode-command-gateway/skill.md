---
id: accordo-vscode-command-gateway
version: 0.2.0
author: Accordo IDE
tags: [vscode, commands, gateway, catalog, migration]
knowledge: []
---

# Skill: VS Code Command Gateway

## When to Use This Skill

Load this skill when:
- You need a long-tail VS Code capability that does not justify a dedicated MCP tool.
- You are migrating from a specialized MCP wrapper to the generic command gateway.
- You need to discover candidate VS Code command IDs before execution.

## Default Workflow

1. Prefer an existing first-class `accordo_*` tool when one still exists for the intent.
2. For migrated wrapper scenarios, use the exact command mapping below rather than rediscovering the command ad hoc.
3. Use `accordo_vscode_command_list` when you need to confirm a command ID or inspect current policy metadata.
4. Use `accordo_vscode_command_execute` only for commands marked allow/confirm by policy.
5. Do not call `accordo_vscode_command_execute` with `accordo_*` command IDs.
6. Treat this skill as supplemental maintainer guidance only; runtime-safe usage guidance for any MCP client must come from tool descriptions plus MCP docs resources under `accordo://docs/tool-reference` and `accordo://docs/troubleshooting`.

## Command ID Lookup

Before executing, verify the command ID and policy classification using:

```
accordo_vscode_command_list({ query: "<command substring>", limit: 50 })
```

Returns command IDs with their policy metadata. Use this to:
- Confirm an exact command ID spelling
- Check whether a command requires confirmation (`requiresConfirmation: true`)
- Audit available commands in a category

For bulk discovery, paginate with `offset` and `limit`.

## M76-VCGM Migration Table (MCP → Gateway)

### Command-backed removals

| Removed MCP tool | VS Code command ID | Policy | Confirmation required |
|---|---|---|---|
| `accordo_editor_split` (right) | `workbench.action.splitEditorRight` | allow | No |
| `accordo_editor_split` (down) | `workbench.action.splitEditorDown` | allow | No |
| `accordo_editor_reveal` | `revealInExplorer` | allow | No |
| `accordo_editor_save` | `workbench.action.files.save` | confirm | **Yes** |
| `accordo_editor_saveAll` | `workbench.action.files.saveAll` | confirm | **Yes** |
| `accordo_editor_format` | `editor.action.formatDocument` | confirm | **Yes** |
| `accordo_editor_scroll` | `editorScroll` | allow | No |
| `accordo_layout_joinGroups` | `workbench.action.joinAllGroups` | allow | No |
| `accordo_layout_evenGroups` | `workbench.action.evenEditorWidths` | allow | No |
| `accordo_layout_zen` | `workbench.action.toggleZenMode` | allow | No |
| `accordo_layout_fullscreen` | `workbench.action.toggleFullScreen` | allow | No |

### Confirmation payload examples

For `confirm` policy commands, you **must** include a `confirmation` payload:

```typescript
// Save active editor — requires confirmation
accordo_vscode_command_execute({
  command: "workbench.action.files.save",
  confirmation: {
    confirmed: true,
    command: "workbench.action.files.save",
    reason: "save active editor"
  }
})

// Save all dirty editors — requires confirmation
accordo_vscode_command_execute({
  command: "workbench.action.files.saveAll",
  confirmation: {
    confirmed: true,
    command: "workbench.action.files.saveAll",
    reason: "save all dirty files"
  }
})

// Format active document — requires confirmation
accordo_vscode_command_execute({
  command: "editor.action.formatDocument",
  confirmation: {
    confirmed: true,
    command: "editor.action.formatDocument",
    reason: "format active document"
  }
})
```

### Allow-policy commands (no confirmation needed)

```typescript
// Split editor right
accordo_vscode_command_execute({ command: "workbench.action.splitEditorRight" })

// Split editor down
accordo_vscode_command_execute({ command: "workbench.action.splitEditorDown" })

// Reveal file in Explorer (pass path as vscode.Uri string in args)
accordo_vscode_command_execute({
  command: "revealInExplorer",
  args: ["/absolute/path/to/file.txt"]
})

// Join all editor groups
accordo_vscode_command_execute({ command: "workbench.action.joinAllGroups" })

// Equalize editor group widths
accordo_vscode_command_execute({ command: "workbench.action.evenEditorWidths" })

// Toggle Zen mode
accordo_vscode_command_execute({ command: "workbench.action.toggleZenMode" })

// Toggle fullscreen
accordo_vscode_command_execute({ command: "workbench.action.toggleFullScreen" })

// Scroll the active editor down by one page
accordo_vscode_command_execute({
  command: "editorScroll",
  args: [{ to: "down", by: "page", value: 1, revealCursor: false }]
})

// Scroll the active editor up by one line
accordo_vscode_command_execute({
  command: "editorScroll",
  args: [{ to: "up", by: "line", value: 1, revealCursor: false }]
})
```

### Workflows for path-based commands

Some commands operate on the active editor or a specific path. For commands that don't accept a direct path argument:

**Save specific file:**
```
1. accordo_editor_open({ path: "/path/to/file.txt" })  // open and focus
2. accordo_vscode_command_execute({
     command: "workbench.action.files.save",
     confirmation: { confirmed: true, command: "workbench.action.files.save", reason: "save active editor" }
   })
```

**Format specific file:**
```
1. accordo_editor_open({ path: "/path/to/file.txt" })  // open and focus
2. accordo_vscode_command_execute({
     command: "editor.action.formatDocument",
     confirmation: { confirmed: true, command: "editor.action.formatDocument", reason: "format active document" }
   })
```

**Reveal in Explorer:**
```
1. accordo_vscode_command_execute({
     command: "revealInExplorer",
     args: ["/absolute/path/to/file.txt"]  // pass as vscode.Uri fsPath string
   })
```

## M76-DGM Migration Table (Diagram Trio)

The diagram trio (`accordo_diagram_list`, `accordo_diagram_get`, `accordo_diagram_style_guide`) are **not** VS Code commands — they are extension-private helpers. They do not map to `accordo_vscode_command_execute`.

### Replacement paths

| Removed tool | Replacement approach |
|---|---|
| `accordo_diagram_list` | Use workspace file discovery: `glob("**/*.mmd")` to enumerate all diagram files, then read each `.mmd` file individually. Each `.mmd` file contains Mermaid source text you can parse directly. |
| `accordo_diagram_get` | Read the `.mmd` file content directly (it is plain text Mermaid source), then use the standard parser + script workflow to emit the semantic graph `{ source, type, nodes, edges, clusters, layout }`. The handlers `listHandler`, `getHandler`, and `styleGuideHandler` are still exported from `diagram-tools.ts` as internal helpers. |
| `accordo_diagram_style_guide` | Use `skills/diagrams/skill.md` which contains the colour palette, starter template, and styling conventions. The critical rules (nodeStyles, edgeStyles, clusterStyles via `accordo_diagram_patch` — never classDef) are also documented in the MCP tool descriptions for `accordo_diagram_patch`. |

### Diagram file workflow

To get equivalent of `accordo_diagram_get`:
```
1. Read the .mmd file with accordo_editor_open or file system tool
2. Parse the Mermaid source manually or use skills/diagrams/skill.md parser guidance
3. The result shape: { source: string, type: "flowchart"|"class"|"state"|..., nodes: {...}, edges: [...], clusters: {...}, layout: { width, height } }
```

The three remaining diagram tools (`accordo_diagram_create`, `accordo_diagram_patch`, `accordo_diagram_render`) stay as first-class MCP tools and are unaffected by this removal wave.

## Important Compatibility Decisions

1. No compatibility alias is planned for the removed wrappers.
2. `revealInExplorer` requires argument hydration (JSON string → `vscode.Uri`); pass the absolute file path as a string in `args`.
3. Save / format are confirm-class at the gateway policy level even though the old wrappers were tool-level safe.
4. Zen / fullscreen are write-only toggles — no deterministic readback in current MCP surface.
5. Diagram create / patch / render remain first-class tools and are **not** affected by this removal wave.

## Known Caveats

- Internal VS Code commands (underscore-prefixed) are less stable than public documented commands.
- Interactive commands may open UI flows that are hard for agents to verify deterministically.
- Command results must be normalized to JSON-safe output before returning over MCP.
- Do not rely on repo-local skill text alone; Phase B/C must mirror the critical guidance into MCP-visible runtime docs.

## Phase Status

Phase C (implementation) complete. These mappings are wired into the gateway skill and ready for client use.
