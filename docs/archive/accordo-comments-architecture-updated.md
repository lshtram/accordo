# Accordo Comments Modality (VS Code + Browser) --- Updated MVP Architecture

*Last updated: 2026-03-02T21:41:31.423749 UTC*

This document defines the updated MVP architecture for a **comments
modality** inside **VS Code** (and later the browser) integrated with
**Accordo's MCP/Hub**.

The design prioritizes: - Ephemeral, location-locked comments - Minimal
anchoring complexity - High agent usability - Forward compatibility for
future persistent comment threads

------------------------------------------------------------------------

## Core Philosophy

Comments are:

-   Location-aware
-   Context-injected
-   Agent-addressable
-   Ephemeral by default

They behave more like **micro-tasks with spatial grounding** than
traditional IDE comments.

------------------------------------------------------------------------

# Goals

-   Allow commenting on **any VS Code surface**
    -   Code editors
    -   Markdown
    -   Webviews
    -   Diagrams
    -   Images
    -   Slides
-   Display comments at their exact location
-   Emit structured `CommentEvent` objects to Accordo Hub
-   Support agent resolution with feedback
-   Keep anchoring simple for MVP

------------------------------------------------------------------------

# Enhanced MVP Features

## 1. Viewport Snapping (Context Injection)

To reduce latency and avoid additional LLM round-trips, comments now
capture a **Viewport Snap** at creation time.

### Captured Context

-   \~20 lines above anchor
-   \~20 lines below anchor
-   Selected text (if any)
-   `languageId`
-   Optional diagnostics
-   Git branch + commit (if available)

### Recommended Structure

``` ts
viewportSnap: {
  before: string;   // capped (~1KB)
  selected?: string;
  after: string;    // capped (~1KB)
}
```

Context should be size-bounded (2--4KB total recommended).

------------------------------------------------------------------------

## 2. Diff-Aware Staling

Instead of marking comments stale on any file change, the system now:

-   Tracks document version at creation
-   Listens to `TextDocumentChangeEvent`
-   Marks comment `stale` **only if edits intersect anchor range**

### Smart Adjustment (Optional but Recommended)

If edits occur strictly above anchor: - Shift anchor line numbers
accordingly

If edits overlap anchor: - Mark as `stale`

This keeps behavior resilient without implementing full re-anchoring
logic.

------------------------------------------------------------------------

## 3. Agent-to-User Feedback Loop

Agents can now attach a resolution summary.

``` ts
resolutionNote?: string
agentId?: string
```

This enables:

-   Explainability
-   Trust-building
-   Transaction-style workflows
-   Future threaded expansion

------------------------------------------------------------------------

# Data Model (Updated)

``` ts
type Pos = { line: number; character: number };

type CommentAnchor =
  | {
      kind: "text";
      uri: string;
      range: { start: Pos; end: Pos };
      docVersion?: number;
    }
  | {
      kind: "surface";
      surfaceId: string;
      x: number; // normalized 0..1
      y: number; // normalized 0..1
      bbox?: { x: number; y: number; w: number; h: number };
    }
  | {
      kind: "file";
      uri: string;
    };

type CommentEvent = {
  id: string;
  createdAt: string;

  author: {
    kind: "user" | "agent";
    name?: string;
    agentId?: string;
  };

  message: string;
  status: "open" | "acked" | "resolved" | "stale";

  resolutionNote?: string;
  intent?: "fix" | "explain" | "refactor" | "review" | "design";
  expiresAt?: string;

  anchor: CommentAnchor;

  artifact: {
    uri?: string;
    languageId?: string;
    surface: "vscode.editor" | "vscode.webview" | "browser.dom";
  };

  context?: {
    viewportSnap?: {
      before: string;
      selected?: string;
      after: string;
    };
    selectionText?: string;
    diagnostics?: any[];
    git?: { branch?: string; commit?: string };
  };
};
```

------------------------------------------------------------------------

# Lifecycle

State machine:

-   `open`
-   `acked`
-   `resolved`
-   `stale`
-   `deleted`

### Auto Cleanup

Recommended policy:

-   Auto-delete after resolve
-   OR keep 24 hours
-   OR use `expiresAt` for scheduled cleanup

------------------------------------------------------------------------

# VS Code Extension Architecture

## Core Modules

-   `CommentStore`
-   `HubClient`
-   `SurfaceAdapterRegistry`
-   `Renderer` (text + overlay)

## Adapter Interface

``` ts
interface SurfaceAdapter {
  canHandle(target: any): boolean;
  createAnchor(target: any): Promise<CommentAnchor>;
  render(comment: CommentEvent): vscode.Disposable;
  isStale?(comment: CommentEvent): Promise<boolean>;
  extractContext?(comment: CommentEvent): Promise<CommentEvent["context"]>;
}
```

------------------------------------------------------------------------

# Implementation Phases

## Phase 0 --- Text Adapter

-   Decorations + gutter icons
-   Inline input widget
-   Diff-aware staling
-   Viewport snap capture
-   Hub emission

## Phase 1 --- Ghost Overlay (Webviews)

-   Transparent VS Code overlay layer
-   Normalized coordinates
-   Optional bounding box
-   Avoid DOM injection

## Phase 2 --- Browser Extension

-   DOM-based anchors
-   Same `CommentEvent` schema
-   Emit to Accordo Hub

------------------------------------------------------------------------

# Strategic Positioning

This architecture turns comments into:

> Location-aware agent tasks with contextual snapshots and resolution
> receipts.

It enables:

-   Fast agent turnaround
-   Clear user feedback
-   Minimal anchoring complexity
-   Forward-compatible expansion into persistent threaded discussions

------------------------------------------------------------------------

# Future Extensions (Not MVP)

-   TextQuote anchoring
-   Re-attach logic
-   Threaded conversations
-   Permission models
-   Git integration with PR linking
-   Rich screenshot embedding
-   Multi-agent negotiation workflows

------------------------------------------------------------------------

End of Document
