# MCP Skill Resources and Thin Runtime Guidance — Requirements

**Scope:** Cross-cutting Accordo MCP usage guidance  
**Priority:** X/Y — merged Skill-First Workflow Enforcement + Runtime Directives Source-of-Truth  
**Date:** 2026-04-30

---

## 1. Purpose

Accordo must guide MCP clients to correct tool-use patterns without duplicating long instructions across server prompts and tool descriptions.

The runtime model is intentionally thin:

1. `initialize.instructions` and `GET /instructions` route agents to MCP-readable skill resources.
2. Tool descriptions state immediate preconditions and point to the relevant skill resource.
3. Procedural guidance lives in `accordo://skills/*` resources.

---

## 2. Skill Resources

| URI | Scope |
|---|---|
| `accordo://skills/accordo` | General IDE workflows: layout, editor, terminal, comments, voice, and generic VS Code command gateway examples. |
| `accordo://skills/diagram` | Diagram creation, styling, patching, and rendering. |
| `accordo://skills/browser` | Browser inspection, tab targeting, snapshots, screenshots, and control recovery. |
| `accordo://skills/presentation` | Marp deck authoring, navigation, narration generation, and capture. |
| `accordo://skills/walkthrough` | Presentation shows, code-review walkthroughs, narrated demos, highlights, and voice sequencing. |

---

## 3. Requirements

| ID | Requirement |
|---|---|
| XY-01 | MCP `initialize` responses advertise the `resources` capability. |
| XY-02 | `resources/list` returns every `accordo://skills/*` resource with `text/markdown` MIME type. |
| XY-03 | `resources/read` returns Markdown contents for each listed skill resource. |
| XY-04 | `resources/read` returns a resource-not-found JSON-RPC error for unknown skill URIs. |
| XY-05 | `initialize.instructions` includes a short skill-router section that points to the five skill resources. |
| XY-06 | `GET /instructions` includes the same skill-router guidance before dynamic prompt content. |
| XY-07 | Tool descriptions may point to skill resources and state immediate preconditions, but they must not duplicate long procedural guidance. |
| XY-08 | The generic VS Code command gateway examples live in `accordo://skills/accordo`. |
| XY-09 | Presentation, code-review, and feature-demo walkthrough guidance lives in `accordo://skills/walkthrough`. |
| XY-10 | Automated tests fail when tool descriptions reference a missing `accordo://skills/*` URI. |

---

## 4. Scope Guardrails

| ID | Requirement |
|---|---|
| XY-11 | This priority does not change tool execution semantics, confirmation policy, or tool authorization behavior. |
| XY-12 | `/runtime-directives` may remain as compatibility/debug infrastructure, but it is not the primary procedural guidance surface. |
| XY-13 | Repo-local `skills/*` files may mirror or inform content, but MCP clients must be able to retrieve the authoritative operational guidance through `resources/read`. |

---

## 5. Acceptance Criteria

1. `initialize` returns `capabilities.resources` and instructions mentioning all five skill URIs.
2. `resources/list` and `resources/read` work for all five skill resources.
3. Command gateway usage examples are available in `accordo://skills/accordo`.
4. Walkthrough guidance covers presenting topics, code-review walkthroughs, and feature demos in `accordo://skills/walkthrough`.
5. Relevant tool descriptions point to the correct skill resources.
6. Existing tool behavior remains unchanged.
