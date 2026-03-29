/**
 * Integration tests for CommentStore atomic write durability.
 *
 * These tests use the real node:fs/promises.rename (NOT mocked) and have the
 * vscode.workspace.fs.writeFile mock write actual bytes to a real temp
 * directory. This exercises the full write→rename path end-to-end on disk.
 *
 * Requirements covered:
 *   §5.1  Persistence — atomic write: .tmp → rename → final file
 *   §5.1  Crash safety — original file intact if write throws
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetMockState } from "./mocks/vscode.js";
import { CommentStore, type CreateCommentParams } from "../comment-store.js";
import type { CommentStoreFile } from "@accordo/bridge-types";

// ── Real-fs vscode mock setup ─────────────────────────────────────────────────
//
// We import workspace from the mock, then override writeFile and createDirectory
// to use the real filesystem so fsRename operates on actual files.

import { workspace, Uri } from "./mocks/vscode.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let testRoot: string;
let accordoDir: string;
let commentsFile: string;
let tmpFile: string;

function makeParams(overrides?: Partial<CreateCommentParams>): CreateCommentParams {
  return {
    uri: "file:///project/src/auth.ts",
    anchor: {
      kind: "text",
      uri: "file:///project/src/auth.ts",
      range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 },
      docVersion: 1,
    },
    body: "Initial comment",
    author: { kind: "user", name: "Developer" },
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockState();

  // Create a real temp workspace for this test
  testRoot = join(tmpdir(), `accordo-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  accordoDir = join(testRoot, ".accordo");
  commentsFile = join(accordoDir, "comments.json");
  tmpFile = commentsFile + ".tmp";

  mkdirSync(accordoDir, { recursive: true });

  // Wire vscode mock to use real fs
  workspace.fs.createDirectory.mockImplementation(async () => undefined);
  workspace.fs.writeFile.mockImplementation(async (uri: Uri, data: Uint8Array) => {
    writeFileSync(uri.fsPath, data);
  });
  workspace.fs.readFile.mockRejectedValue(new Error("FileNotFound"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("§5.1 Atomic write — real filesystem integration", () => {

  it("create: final comments.json is valid JSON after createThread", async () => {
    const store = new CommentStore();
    await store.load(testRoot);

    const { threadId } = await store.createThread(makeParams({ body: "Hello world" }));

    expect(existsSync(commentsFile)).toBe(true);
    expect(existsSync(tmpFile)).toBe(false); // .tmp cleaned up by rename

    const parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.version).toBe("1.0");
    expect(parsed.threads).toHaveLength(1);
    expect(parsed.threads[0].id).toBe(threadId);
    expect(parsed.threads[0].comments[0].body).toBe("Hello world");
  });

  it("reply: comments.json updated correctly after reply", async () => {
    const store = new CommentStore();
    await store.load(testRoot);

    const { threadId } = await store.createThread(makeParams({ body: "First comment" }));
    await store.reply({ threadId, body: "Agent reply", author: { kind: "agent", name: "Copilot" } });

    const parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.threads[0].comments).toHaveLength(2);
    expect(parsed.threads[0].comments[1].body).toBe("Agent reply");
    expect(parsed.threads[0].comments[1].author.kind).toBe("agent");
  });

  it("delete: thread removed from comments.json after delete", async () => {
    const store = new CommentStore();
    await store.load(testRoot);

    const { threadId } = await store.createThread(makeParams({ body: "To be deleted" }));
    expect(JSON.parse(readFileSync(commentsFile, "utf8")).threads).toHaveLength(1);

    await store.delete({ threadId });

    const parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.threads).toHaveLength(0);
  });

  it("create → reply → delete cycle: file is valid at every step", async () => {
    const store = new CommentStore();
    await store.load(testRoot);

    // Step 1: create
    const { threadId } = await store.createThread(makeParams({ body: "Step 1" }));
    let parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.threads).toHaveLength(1);
    expect(existsSync(tmpFile)).toBe(false);

    // Step 2: reply
    await store.reply({ threadId, body: "Step 2", author: { kind: "agent", name: "Bot" } });
    parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.threads[0].comments).toHaveLength(2);
    expect(existsSync(tmpFile)).toBe(false);

    // Step 3: delete
    await store.delete({ threadId });
    parsed = JSON.parse(readFileSync(commentsFile, "utf8")) as CommentStoreFile;
    expect(parsed.threads).toHaveLength(0);
    expect(existsSync(tmpFile)).toBe(false);
  });

  it("crash safety: original file untouched when writeFile throws", async () => {
    const store = new CommentStore();
    await store.load(testRoot);

    // Write a known-good initial state
    await store.createThread(makeParams({ body: "Good state" }));
    const goodContent = readFileSync(commentsFile, "utf8");

    // Now make writeFile throw on the next call (simulates disk-full mid-write)
    workspace.fs.writeFile.mockImplementationOnce(async () => {
      throw new Error("ENOSPC: no space left on device");
    });

    await expect(
      store.createThread(makeParams({ body: "This should not persist" }))
    ).rejects.toThrow("ENOSPC");

    // Original file must be intact and unchanged
    expect(readFileSync(commentsFile, "utf8")).toBe(goodContent);
    // .tmp must not exist (write never completed)
    expect(existsSync(tmpFile)).toBe(false);
  });
});
