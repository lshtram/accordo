/**
 * spatial-grammar.test.ts
 *
 * GAP-D1 — Spatial Relations Grammar Parsing Tests
 *
 * Tests for the canonical grammar parsers:
 * - parseSnapshotId: "{pageId}:{version}" format
 * - parseUid: "{frameId}:{nodeId}" format
 */

import { describe, it, expect } from "vitest";
import { parseSnapshotId, parseUid } from "../src/content/spatial-relations-grammar.js";

describe("parseSnapshotId", () => {
  it("parses valid snapshotId with canonical version", () => {
    expect(parseSnapshotId("page-001:1")).toEqual({ pageId: "page-001", version: 1 });
    expect(parseSnapshotId("page-001:0")).toEqual({ pageId: "page-001", version: 0 });
    expect(parseSnapshotId("x:999")).toEqual({ pageId: "x", version: 999 });
  });

  it("rejects snapshotId with leading zeros in version", () => {
    expect(parseSnapshotId("page-001:01")).toBeNull();
    expect(parseSnapshotId("page-001:00")).toBeNull();
  });

  it("rejects snapshotId with no colon", () => {
    expect(parseSnapshotId("page-001")).toBeNull();
  });

  it("rejects snapshotId with empty pageId", () => {
    expect(parseSnapshotId(":1")).toBeNull();
  });

  it("rejects snapshotId with whitespace", () => {
    expect(parseSnapshotId("page-001 :1")).toBeNull();
  });

  it("rejects snapshotId with non-numeric version", () => {
    expect(parseSnapshotId("page-001:abc")).toBeNull();
  });

  it("rejects snapshotId with negative version", () => {
    expect(parseSnapshotId("page-001:-1")).toBeNull();
  });
});

describe("parseUid", () => {
  it("parses valid UID with main frameId", () => {
    expect(parseUid("main:0")).toEqual({ frameId: "main", nodeId: 0 });
    expect(parseUid("main:1")).toEqual({ frameId: "main", nodeId: 1 });
    expect(parseUid("main:999")).toEqual({ frameId: "main", nodeId: 999 });
  });

  it("parses valid UID with iframe frameId", () => {
    expect(parseUid("iframe-embedded-0:1")).toEqual({ frameId: "iframe-embedded-0", nodeId: 1 });
  });

  it("parses valid UID when frameId contains colons", () => {
    expect(parseUid("https://example.test/frame:1")).toEqual({ frameId: "https://example.test/frame", nodeId: 1 });
  });

  it("rejects UID with no colon", () => {
    expect(parseUid("main1")).toBeNull();
  });

  it("rejects UID with empty frameId", () => {
    expect(parseUid(":1")).toBeNull();
  });

  it("rejects UID with non-numeric nodeId", () => {
    expect(parseUid("main:notanumber")).toBeNull();
    expect(parseUid("https://example.test/frame:12junk")).toBeNull();
  });

  it("rejects UID with negative nodeId", () => {
    expect(parseUid("main:-1")).toBeNull();
  });

  it("rejects UID with leading zeros in nodeId", () => {
    expect(parseUid("main:01")).toBeNull();
  });

  it("rejects UID with whitespace", () => {
    expect(parseUid("main :1")).toBeNull();
  });
});
