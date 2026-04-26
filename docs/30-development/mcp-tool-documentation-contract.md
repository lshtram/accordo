# MCP Tool Documentation Contract (Runtime-Facing)

**Status:** Active (2026-04-23)  
**Purpose:** Define where tool-usage guidance must live so agents can use Accordo tools correctly without reading internal requirements/test docs.

---

## Why this exists

Accordo is delivered as an MCP server. External agents (outside this repository) cannot be expected to read `requirements-*.md` or testing guides before every tool call. Tool guidance must travel with the MCP surface.

---

## Authoritative runtime layers (in order)

> **Priority Y clarification:** For mandatory Accordo-wide directives, the primary
> runtime source of truth is the Hub-delivered directive bundle in
> `initialize.instructions` plus `GET /instructions`. Tool descriptions remain
> reinforcement layers. If an MCP-readable docs/resource path is referenced, it
> must be backed by an implemented and testable runtime mechanism.

1. **Tool description in `tools/list` (mandatory)**
   - Must include critical preconditions and call-order constraints.
   - Example: `accordo_diagram_render` must state that the target diagram panel must already be open.

2. **MCP server resources (mandatory for extended guidance)**
   - Hub should expose read-only resources for operational docs at these canonical roots:
     - `accordo://docs/tool-reference`
     - `accordo://docs/troubleshooting`
   - Feature-specific guidance should live as sections or subpaths beneath those roots, for example `vscode-command-gateway`.
   - These resources are available to any connected agent, including non-repo clients.

3. **Server instructions / skill playbook (recommended)**
   - Concise "how to operate this server" guidance with common sequences and anti-footgun examples.
   - Server instructions are MCP-visible and should point agents to the resource paths above for deeper details.
   - Repo-local skills may mirror the same guidance for maintainers, but must not be the only source of safety-critical usage information.
   - Include migration examples for generic VS Code command gateway usage.

Repository markdown files remain the maintainer source of truth, but **runtime-facing guidance must be exported through MCP surfaces** (description/resources/instructions).

**Design rule:** Avoid dedicated "documentation pointer" tools whose only purpose is to redirect agents to a file/skill. Prefer embedding guidance directly into runtime documentation layers.

---

## Required content for each tool

Every production tool must document, at minimum:

- What it does
- Required preconditions
- Expected success shape
- Typical failure modes + recovery hint
- Whether it is deterministic/idempotent

---

## Current critical preconditions (must be reflected in runtime descriptions)

- **`accordo_diagram_render`**
  - **Precondition:** Target `.mmd` must already be open in a diagram panel.
  - **Failure mode if unmet:** `PANEL_NOT_OPEN`.
  - **Recovery:** call `accordo_editor_open` on the `.mmd` (diagram surface), then retry `accordo_diagram_render`.

---

## Operational principle

When there is mismatch between schema and runtime behavior, fix runtime-facing guidance first (tool description/resources), then align implementation/tests.

For Accordo-wide mandatory directives, parity checks must also confirm that the
same directive set appears in `initialize.instructions` and `GET /instructions`.
