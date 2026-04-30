# Testing Guide — Priority X/Y MCP Skill Resources

## Scope

Validate thin runtime guidance and MCP-readable Accordo skill resources.

## Automated Checks

Run in `packages/hub`:

```bash
pnpm test -- mcp-skill-resources runtime-directives
```

Run in `packages/editor`:

```bash
pnpm test -- runtime-directives-tool-description-parity vscode-command-list-description
```

## Manual MCP Checks

1. Connect an MCP client to Accordo.
2. Inspect the `initialize` response.
3. Confirm `capabilities.resources` is present.
4. Confirm `instructions` mentions:
   - `accordo://skills/accordo`
   - `accordo://skills/diagram`
   - `accordo://skills/browser`
   - `accordo://skills/presentation`
   - `accordo://skills/walkthrough`
5. Call `resources/list` and verify all five skill resources are listed.
6. Call `resources/read` for each skill URI and verify Markdown is returned.
7. Ask the agent to use a diagram, browser, presentation, walkthrough, and generic VS Code command workflow; verify it reads or follows the relevant skill.

## Effectiveness Notes

Manual testing is expected to refine skill wording. If agents still misuse a tool family, update the relevant `accordo://skills/*` resource rather than expanding `initialize.instructions` or duplicating full workflows in tool descriptions.
