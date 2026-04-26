---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
header: "Accordo IDE"
footer: "Generic VS Code Command Gateway"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Generic VS Code Command Gateway
## Phase A Review — PM + TL Briefing

Safely unlock long-tail VS Code capabilities through one guarded surface.

---

# Phase A Status (Reviewed)

- **Reviewer verdict:** PASS (`docs/reviews/vscode-command-gateway-A.md`)
- Contracts/stubs/tool-definitions split into focused modules
- Architecture + requirements + runtime docs contract aligned
- Tool descriptions now point to MCP-visible docs resources

**Checkpoint ask:** approve moving from Phase A → Phase B test authoring.

---

# Why This Matters (PM View)

- We cannot keep building one MCP tool per minor VS Code action.
- Agent workflows stall on "one missing command" gaps.
- A guarded gateway unlocks breadth without exploding maintenance cost.

**Outcome:** faster edge-workflow delivery, fewer bespoke wrappers to maintain.

---

# Access This Gateway Unlocks (Examples)

| Intent | Candidate command ID |
|---|---|
| Open command palette | `workbench.action.showCommands` |
| Split editor right | `workbench.action.splitEditorRight` |
| Save all files | `workbench.action.files.saveAll` |
| Toggle Zen mode | `workbench.action.toggleZenMode` |

---

# Proposed MCP Surface

1. `accordo_vscode_command_list`
   - discover commands (paged + filtered + policy metadata)
2. `accordo_vscode_command_execute`
   - execute command with args under policy guardrails

Both are **additive**. First-class `accordo_*` tools remain authoritative.

---

# Example Calls (Agent Side)

```json
{
  "name": "accordo_vscode_command_list",
  "arguments": {"query": "split", "limit": 20}
}
```

```json
{
  "name": "accordo_vscode_command_execute",
  "arguments": {"command": "workbench.action.splitEditorRight", "args": []}
}
```

---

# Safety & Policy Model (TL View)

- Per-command decision: `allow | confirm | deny`
- `accordo_*` command IDs are denied through gateway (`preferredTool` guidance)
- High-risk commands can require explicit confirmation payload
- Result envelope normalized for MCP (`void | json | unsupported`)
- Every attempt audit-logged (command, args shape, policy, outcome)

---

# Architecture (Proposed Runtime Flow)

Agent → Hub MCP → Bridge → `accordo-editor`

Inside `accordo-editor` gateway:
1. Catalog (`vscode.commands.getCommands`)
2. Policy classifier (risk + action)
3. Guarded executor (`vscode.commands.executeCommand`)
4. Audit sink (structured event)
5. MCP-safe response envelope

---

# Simplification / Tool Retirement Path

Priority W migration candidates from workplan:

- `accordo_editor_reveal`, `accordo_editor_split`
- `accordo_editor_save`, `accordo_editor_saveAll`, `accordo_editor_format`
- `accordo_layout_zen`, `accordo_layout_fullscreen`
- `accordo_layout_evenGroups`, `accordo_layout_joinGroups`

**Plan:** migrate in controlled batches, keep first-class fallbacks until stable.

---

# Risks & Mitigations

- **Internal command instability** → default hide internals + explicit opt-in
- **Interactive UI commands** → structured error codes + troubleshooting docs
- **Overuse vs purpose-built tools** → policy + `preferredTool` nudges
- **State ambiguity (toggle commands)** → explicit post-command state probes

---

# Phase B Test Plan (Next Gate)

- List command pagination/filters/internal visibility
- Policy classification coverage (`allow/confirm/deny`)
- Execute path: success + confirmation-required + denied
- Audit trail write assertions (no raw secret arg dumps)
- Result normalization assertions (serializable envelope)

---

<!-- _class: lead -->

# Decision Request

Approve Phase A and proceed to Phase B tests for
contracts, policy/audit behavior, and migration guardrails.

**Proceed to Phase B now?**
