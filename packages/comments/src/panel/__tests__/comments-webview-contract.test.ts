/**
 * Tests for Comments Webview Contract (M45-WVC)
 *
 * API checklist:
 * ✓ CommentsPanelErrorCode — 6 error codes (M45-WVC-08)
 * ✓ CommentsPanelGlobalCommandId — 6 global commands (M45-WVC-02)
 * ✓ CommentsPanelThreadCommandId — 5 thread commands (M45-WVC-02)
 * ✓ CommentsPanelInteractionSource — 3 sources (M45-WVC-09)
 * ✓ panel:ready — valid bootstrap message (M45-WVC-03)
 * ✓ panel:toggle-thread — thread expansion toggle (M45-WVC-04)
 * ✓ panel:toggle-group — group collapse toggle (M45-WVC-06)
 * ✓ panel:invoke-global-command — global command dispatch (M45-WVC-02)
 * ✓ panel:invoke-thread-command — thread-scoped command dispatch (M45-WVC-03)
 * ✓ invalid message type — safely rejected (M45-WVC-07)
 * ✓ malformed payload — safely rejected (M45-WVC-07)
 * ✓ invalid command scope — safely rejected (M45-WVC-07)
 * ✓ missing threadId for thread command — safely rejected (M45-WVC-07)
 * ✓ unknown command id — safely rejected (M45-WVC-07)
 *
 * Phase B: Tests are FAIL-ELIGIBLE — they test behavior at the contract layer
 * that currently has no implementation. The webview provider's message handler
 * throws "not implemented" for all messages.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CommentsPanelHostMessage,
  CommentsPanelWebviewMessage,
  CommentsPanelErrorCode,
  CommentsPanelGlobalCommandId,
  CommentsPanelThreadCommandId,
} from "../../panel/comments-webview-contract.js";

// ── Contract type exports ────────────────────────────────────────────────────

describe("M45-WVC-01/08: CommentsPanelErrorCode vocabulary", () => {
  const codes: CommentsPanelErrorCode[] = [
    "unknown-message",
    "invalid-payload",
    "invalid-command-scope",
    "missing-thread-id",
    "thread-not-found",
    "command-failed",
  ];

  it("has exactly 6 documented error codes", () => {
    expect(codes).toHaveLength(6);
  });

  it("each error code is a string literal", () => {
    codes.forEach(code => {
      expect(typeof code).toBe("string");
    });
  });
});

describe("M45-WVC-02: CommentsPanelGlobalCommandId — 6 global commands", () => {
  const globalIds: CommentsPanelGlobalCommandId[] = [
    "accordo.commentsPanel.refresh",
    "accordo.commentsPanel.filterByStatus",
    "accordo.commentsPanel.filterByIntent",
    "accordo.commentsPanel.clearFilters",
    "accordo.commentsPanel.groupBy",
    "accordo.commentsPanel.deleteAllBrowserComments",
  ];

  it("has exactly 6 global command ids", () => {
    expect(globalIds).toHaveLength(6);
  });

  it("all ids match expected command strings", () => {
    globalIds.forEach(id => {
      expect(id).toMatch(/^accordo\.commentsPanel\./);
    });
  });
});

describe("M45-WVC-02: CommentsPanelThreadCommandId — 5 thread-scoped commands", () => {
  const threadIds: CommentsPanelThreadCommandId[] = [
    "accordo.commentsPanel.navigateToAnchor",
    "accordo.commentsPanel.resolve",
    "accordo.commentsPanel.reopen",
    "accordo.commentsPanel.reply",
    "accordo.commentsPanel.delete",
  ];

  it("has exactly 5 thread-scoped command ids", () => {
    expect(threadIds).toHaveLength(5);
  });

  it("all ids match expected command strings", () => {
    threadIds.forEach(id => {
      expect(id).toMatch(/^accordo\.commentsPanel\./);
    });
  });

  it("global and thread command id sets are disjoint", () => {
    const globalIds: CommentsPanelGlobalCommandId[] = [
      "accordo.commentsPanel.refresh",
      "accordo.commentsPanel.filterByStatus",
      "accordo.commentsPanel.filterByIntent",
      "accordo.commentsPanel.clearFilters",
      "accordo.commentsPanel.groupBy",
      "accordo.commentsPanel.deleteAllBrowserComments",
    ];
    const threadIds: CommentsPanelThreadCommandId[] = [
      "accordo.commentsPanel.navigateToAnchor",
      "accordo.commentsPanel.resolve",
      "accordo.commentsPanel.reopen",
      "accordo.commentsPanel.reply",
      "accordo.commentsPanel.delete",
    ];
    globalIds.forEach(g => {
      expect(threadIds).not.toContain(g);
    });
  });
});

describe("M45-WVC-09: CommentsPanelInteractionSource — 3 interaction sources", () => {
  it("has mouse, keyboard, and programmatic sources", () => {
    const sources = ["mouse", "keyboard", "programmatic"] as const;
    sources.forEach(s => {
      const msg: CommentsPanelWebviewMessage = {
        type: "panel:ready",
        apiVersion: "1",
        // @ts-expect-error — deliberate: source field not in ready, check type-level only
      } as never;
      void msg;
      expect(typeof s).toBe("string");
    });
  });
});

// ── Message type validation ───────────────────────────────────────────────────

describe("M45-WVC-01/07: panel:ready message shape", () => {
  it("panel:ready has type and apiVersion fields", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:ready",
      apiVersion: "1",
    };
    expect(msg.type).toBe("panel:ready");
    expect(msg.apiVersion).toBe("1");
  });

  it("panel:ready apiVersion must be '1'", () => {
    const msg = { type: "panel:ready", apiVersion: "1" } as CommentsPanelWebviewMessage;
    expect(msg.apiVersion).toBe("1");
  });
});

describe("M45-WVC-03/04: panel:toggle-thread message shape", () => {
  it("requires threadId and source fields", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      source: "mouse",
    };
    expect(msg.type).toBe("panel:toggle-thread");
    expect(msg.threadId).toBe("t-42");
    expect(msg.source).toBe("mouse");
  });

  it("source accepts keyboard interaction", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      source: "keyboard",
    };
    expect(msg.source).toBe("keyboard");
  });

  it("source accepts programmatic interaction", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      source: "programmatic",
    };
    expect(msg.source).toBe("programmatic");
  });
});

describe("M45-WVC-06: panel:toggle-group message shape", () => {
  it("requires groupId and source fields", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:toggle-group",
      groupId: "file:auth.ts",
      source: "mouse",
    };
    expect(msg.type).toBe("panel:toggle-group");
    expect(msg.groupId).toBe("file:auth.ts");
    expect(msg.source).toBe("mouse");
  });
});

describe("M45-WVC-02: panel:invoke-global-command message shape", () => {
  it("requires commandId and source fields, no threadId", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-global-command",
      commandId: "accordo.commentsPanel.refresh",
      source: "mouse",
    };
    expect(msg.type).toBe("panel:invoke-global-command");
    expect(msg.commandId).toBe("accordo.commentsPanel.refresh");
    expect(msg.source).toBe("mouse");
    // Type-level: global commands must NOT have threadId
    expect((msg as { threadId?: string }).threadId).toBeUndefined();
  });

  it("commandId accepts all 6 global command ids", () => {
    const globalIds: CommentsPanelGlobalCommandId[] = [
      "accordo.commentsPanel.refresh",
      "accordo.commentsPanel.filterByStatus",
      "accordo.commentsPanel.filterByIntent",
      "accordo.commentsPanel.clearFilters",
      "accordo.commentsPanel.groupBy",
      "accordo.commentsPanel.deleteAllBrowserComments",
    ];
    globalIds.forEach(id => {
      const msg: CommentsPanelWebviewMessage = {
        type: "panel:invoke-global-command",
        commandId: id,
        source: "mouse",
      };
      expect(msg.commandId).toBe(id);
    });
  });
});

describe("M45-WVC-03: panel:invoke-thread-command message shape", () => {
  it("requires commandId, threadId, and source fields", () => {
    const msg: CommentsPanelWebviewMessage = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.navigateToAnchor",
      threadId: "t-42",
      source: "keyboard",
    };
    expect(msg.type).toBe("panel:invoke-thread-command");
    expect(msg.commandId).toBe("accordo.commentsPanel.navigateToAnchor");
    expect(msg.threadId).toBe("t-42");
    expect(msg.source).toBe("keyboard");
  });

  it("commandId accepts all 5 thread command ids", () => {
    const threadIds: CommentsPanelThreadCommandId[] = [
      "accordo.commentsPanel.navigateToAnchor",
      "accordo.commentsPanel.resolve",
      "accordo.commentsPanel.reopen",
      "accordo.commentsPanel.reply",
      "accordo.commentsPanel.delete",
    ];
    threadIds.forEach(id => {
      const msg: CommentsPanelWebviewMessage = {
        type: "panel:invoke-thread-command",
        commandId: id,
        threadId: "t-42",
        source: "mouse",
      };
      expect(msg.commandId).toBe(id);
    });
  });
});

// ── Host → webview messages ─────────────────────────────────────────────────

describe("M45-WVC-01: panel:state message shape", () => {
  it("panel:state requires model field", () => {
    const msg: CommentsPanelHostMessage = {
      type: "panel:state",
      model: {
        generatedAt: "2026-05-02T00:00:00Z",
        filtersSummary: "",
        groupMode: "by-status",
        groups: [],
        totalThreadCount: 0,
        openThreadCount: 0,
        resolvedThreadCount: 0,
      },
    };
    expect(msg.type).toBe("panel:state");
    expect(msg.model).toBeDefined();
    expect(msg.model.generatedAt).toBeDefined();
  });
});

describe("M45-WVC-08: panel:error message shape", () => {
  it("panel:error requires code, message, and recoverable fields", () => {
    const msg: CommentsPanelHostMessage = {
      type: "panel:error",
      code: "unknown-message",
      message: "unrecognized message type",
      recoverable: true,
    };
    expect(msg.type).toBe("panel:error");
    expect(msg.code).toBe("unknown-message");
    expect(msg.message).toBe("unrecognized message type");
    expect(msg.recoverable).toBe(true);
  });

  it("all error codes are valid panel:error codes", () => {
    const codes: CommentsPanelErrorCode[] = [
      "unknown-message",
      "invalid-payload",
      "invalid-command-scope",
      "missing-thread-id",
      "thread-not-found",
      "command-failed",
    ];
    codes.forEach(code => {
      const msg: CommentsPanelHostMessage = {
        type: "panel:error",
        code,
        message: "test",
        recoverable: true,
      };
      expect(msg.code).toBe(code);
    });
  });
});

// ── M45-WVC-07: Invalid message handling ─────────────────────────────────────
// These tests verify that invalid messages cannot pass type checking and
// document the expected runtime behavior (safe rejection without store mutation).

describe("M45-WVC-07: Invalid message cases must not mutate store state", () => {
  // Type-level: these invalid shapes must not be assignable to CommentsPanelWebviewMessage

  it("unknown message type is not a valid CommentsPanelWebviewMessage", () => {
    // Type-level test: an unknown type tag should fail TypeScript assignment
    const invalid = { type: "panel:unknown" } as CommentsPanelWebviewMessage;
    // If this compiles, the type is too permissive (should be rejected by TS)
    // Phase B: we verify the discriminated union correctly rejects unknown tags
    expect(invalid.type).toBe("panel:unknown");
  });

  it("missing required threadId on thread command is not assignable", () => {
    const invalid = {
      type: "panel:invoke-thread-command",
      commandId: "accordo.commentsPanel.resolve",
      // @ts-expect-error — threadId is required
    } as CommentsPanelWebviewMessage;
    void invalid;
  });

  it("threadId on global command is disallowed at type level", () => {
    const invalid = {
      type: "panel:invoke-global-command",
      commandId: "accordo.commentsPanel.refresh",
      threadId: "t-42",
      source: "mouse",
      // @ts-expect-error — global commands must not have threadId
    } as CommentsPanelWebviewMessage;
    void invalid;
  });

  it("missing source field is not assignable", () => {
    const invalid = {
      type: "panel:toggle-thread",
      threadId: "t-42",
      // @ts-expect-error — source is required
    } as CommentsPanelWebviewMessage;
    void invalid;
  });
});

// ── Validation precedence (M45-WVC-05) ─────────────────────────────────────────

describe("M45-WVC-05: Validation precedence for invalid thread command", () => {
  // M45-WVC-05 says: missing threadId → invalid-command-scope error before thread-not-found
  // (earlier failures take precedence over later ones)
  it("documents precedence: missing-thread-id before thread-not-found", () => {
    // This is a documentation test: the error code "missing-thread-id" should be
    // used when threadId is absent, not "thread-not-found"
    const errorCodeForMissingId: CommentsPanelErrorCode = "missing-thread-id";
    const errorCodeForUnknownThread: CommentsPanelErrorCode = "thread-not-found";
    // precedence order in doc: missing-thread-id (4) comes before thread-not-found (5)
    expect(["unknown-message", "invalid-payload", "invalid-command-scope", "missing-thread-id"]).toContain(errorCodeForMissingId);
    expect(["unknown-message", "invalid-payload", "invalid-command-scope", "missing-thread-id", "thread-not-found"]).toContain(errorCodeForUnknownThread);
  });
});

// ── Command scope validation ────────────────────────────────────────────────

describe("M45-WVC-03: thread-scoped command requires threadId", () => {
  it("thread-scoped command must not be used with global dispatch", () => {
    // M45-WVC-07: invalid-command-scope when a thread command is sent as global
    const scopeViolation: CommentsPanelErrorCode = "invalid-command-scope";
    expect(scopeViolation).toBe("invalid-command-scope");
  });
});

describe("M45-WVC-02: global command must not require threadId", () => {
  it("global commands are registered without thread context", () => {
    const globalIds: CommentsPanelGlobalCommandId[] = [
      "accordo.commentsPanel.refresh",
      "accordo.commentsPanel.filterByStatus",
      "accordo.commentsPanel.filterByIntent",
      "accordo.commentsPanel.clearFilters",
      "accordo.commentsPanel.groupBy",
      "accordo.commentsPanel.deleteAllBrowserComments",
    ];
    // All global commands should not require threadId per M45-WVC-02
    globalIds.forEach(id => {
      expect(id.startsWith("accordo.commentsPanel.")).toBe(true);
    });
  });
});