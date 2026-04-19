/**
 * sw-comment-sync-contract.test.ts
 *
 * Tests for decodeHubThreadsPayload() and encodeBrowserCommentAction() in:
 * packages/browser-extension/src/sw-comment-sync-contract.ts
 *
 * API checklist:
 * - decodeHubThreadsPayload(data: unknown): HubCommentThread[]    [6 tests]
 * - encodeBrowserCommentAction(action, payload): unknown          [4 tests]
 *
 * Requirement trace:
 * - BR-F-146: Browser-extension tolerates legacy bare-array while preferring canonical envelope
 * - BR-F-144: Read envelope must be { threads } — mode-invariant
 * - BR-F-145: Mutation notify semantics equivalent in both relay modes
 */

import { describe, it, expect } from "vitest";
import { decodeHubThreadsPayload, encodeBrowserCommentAction } from "../src/sw-comment-sync-contract.js";
import type { BrowserRelayCommentAction } from "../src/sw-comment-sync-contract.js";
import type { HubCommentThread } from "../src/sw-comment-sync.js";

type Action = BrowserRelayCommentAction;

// ── Test fixtures ─────────────────────────────────────────────────────────────

const canonicalEnvelope: { threads: HubCommentThread[] } = {
  threads: [
    {
      id: "t1",
      anchor: {
        kind: "surface",
        uri: "https://example.com/page",
        surfaceType: "browser",
        coordinates: { type: "normalized", x: 0.5, y: 0.5 },
      },
      status: "open",
      commentCount: 1,
      lastActivity: "2024-01-01T00:00:00.000Z",
      lastAuthor: "Alice",
      firstComment: {
        id: "c1",
        threadId: "t1",
        createdAt: "2024-01-01T00:00:00.000Z",
        author: { kind: "user", name: "Alice" },
        body: "Hello",
        status: "open",
      },
      comments: [
        {
          id: "c1",
          threadId: "t1",
          createdAt: "2024-01-01T00:00:00.000Z",
          author: { kind: "user", name: "Alice" },
          body: "Hello",
          status: "open",
        },
      ],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ],
};

const legacyBareArray: HubCommentThread[] = [
  {
    id: "t1",
    anchor: {
      kind: "surface",
      uri: "https://example.com/page",
      surfaceType: "browser",
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    },
    status: "open",
    commentCount: 1,
    lastActivity: "2024-01-01T00:00:00.000Z",
    lastAuthor: "Alice",
    firstComment: {
      id: "c1",
      threadId: "t1",
      createdAt: "2024-01-01T00:00:00.000Z",
      author: { kind: "user", name: "Alice" },
      body: "Hello",
      status: "open",
    },
    comments: [
      {
        id: "c1",
        threadId: "t1",
        createdAt: "2024-01-01T00:00:00.000Z",
        author: { kind: "user", name: "Alice" },
        body: "Hello",
        status: "open",
      },
    ],
    createdAt: "2024-01-01T00:00:00.000Z",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("decodeHubThreadsPayload", () => {
  it("BR-F-146-01: Canonical { threads } envelope is decoded correctly", () => {
    const result = decodeHubThreadsPayload(canonicalEnvelope);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("t1");
    expect(result[0]?.anchor?.uri).toBe("https://example.com/page");
  });

  it("BR-F-146-02: Legacy bare array is decoded and wrapped as { threads: [...] } (backward compat)", () => {
    const result = decodeHubThreadsPayload(legacyBareArray);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("t1");
  });

  it("BR-F-146-03: null input returns [] (does not throw)", () => {
    const result = decodeHubThreadsPayload(null);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("BR-F-146-03: undefined input returns [] (does not throw)", () => {
    const result = decodeHubThreadsPayload(undefined);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("BR-F-146-04: Malformed { threads: null } returns [] (defensive)", () => {
    const result = decodeHubThreadsPayload({ threads: null } as unknown);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("BR-F-146-04: Malformed { threads: 'bad' } returns [] (defensive)", () => {
    const result = decodeHubThreadsPayload({ threads: "bad" } as unknown);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("BR-F-146-05: Each thread in result has required fields validated (id, anchor, comments)", () => {
    const result = decodeHubThreadsPayload(canonicalEnvelope);

    for (const thread of result) {
      expect(thread).toHaveProperty("id");
      expect(typeof thread.id).toBe("string");
      expect(thread).toHaveProperty("anchor");
      expect(typeof thread.anchor).toBe("object");
      // Deep: anchor must have uri
      expect(thread.anchor).toHaveProperty("uri");
      expect(typeof thread.anchor.uri).toBe("string");
      // Deep: anchor must have surfaceType
      expect(thread.anchor).toHaveProperty("surfaceType");
      expect(typeof thread.anchor.surfaceType).toBe("string");
      expect(thread).toHaveProperty("comments");
      expect(Array.isArray(thread.comments)).toBe(true);
      // Deep: first comment must have author
      if (thread.comments.length > 0) {
        expect(thread.comments[0]).toHaveProperty("author");
        expect(typeof thread.comments[0].author).toBe("object");
        expect(thread.comments[0].author).toHaveProperty("name");
        expect(typeof thread.comments[0].author.name).toBe("string");
      }
    }
  });
});

describe("encodeBrowserCommentAction", () => {
  it("BR-F-146-06: get_comments action encodes to correct wire format", () => {
    const result = encodeBrowserCommentAction(
      "get_comments" as Action,
      { url: "https://example.com/page" },
    );

    // Wire format: { action: string, payload: unknown, requestId: string }
    expect(result).toHaveProperty("action", "get_comments");
    expect(result).toHaveProperty("payload");
    expect((result as Record<string, unknown>).payload).toHaveProperty("url", "https://example.com/page");
  });

  it("BR-F-146-07: create_comment action encodes with all required fields from payload", () => {
    const result = encodeBrowserCommentAction(
      "create_comment" as Action,
      {
        url: "https://example.com/page",
        anchorKey: "body:center",
        body: "New comment",
        authorName: "Agent",
      },
    );

    expect(result).toHaveProperty("action", "create_comment");
    const payload = (result as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload).toHaveProperty("url", "https://example.com/page");
    expect(payload).toHaveProperty("anchorKey", "body:center");
    expect(payload).toHaveProperty("body", "New comment");
    expect(payload).toHaveProperty("authorName", "Agent");
  });

  it("BR-F-146-07: reply_comment action encodes with threadId and body", () => {
    const result = encodeBrowserCommentAction(
      "reply_comment" as Action,
      { threadId: "t123", body: "reply text" },
    );

    expect(result).toHaveProperty("action", "reply_comment");
    const payload = (result as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload).toHaveProperty("threadId", "t123");
    expect(payload).toHaveProperty("body", "reply text");
  });

  it("BR-F-146-08: Unknown action throws Error('not implemented')", () => {
    // The contract specifies unknown actions throw exactly Error("not implemented")
    const doEncode = () =>
      encodeBrowserCommentAction("invalid_action" as Action, {});

    expect(doEncode).toThrow(Error("not implemented"));
  });
});