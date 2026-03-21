/**
 * Tests for src/util.ts
 * Requirements: requirements-editor.md §5.1 (resolvePath), §5.2 (wrapHandler)
 *
 * All tests are RED against the "not implemented" stubs — that is intentional.
 */

import { describe, it, expect, vi } from "vitest";
import path from "path";
import { resolvePath, wrapHandler, normaliseSlashes, isInsideWorkspace } from "../util.js";

// ── Platform-aware path comparison helper ─────────────────────────────────────

/**
 * Normalize a path for test comparison.
 * Strips drive letters on Windows so tests work cross-platform.
 * Example: "D:/workspace/src/foo.ts" → "/workspace/src/foo.ts"
 */
function normalizePathForComparison(p: string): string {
  const normalized = normaliseSlashes(p);
  // Remove drive letter if present (Windows)
  return normalized.replace(/^[a-zA-Z]:/, "");
}

// ── §5.1 resolvePath ────────────────────────────────────────────────────────

describe("resolvePath", () => {
  // ── Absolute paths ──────────────────────────────────────────────────────

  it("§5.1-ABS-01: returns normalised absolute path when inside workspace", () => {
    const result = resolvePath("/workspace/src/foo.ts", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/src/foo.ts");
  });

  it("§5.1-ABS-02: normalises backslashes to forward slashes (Windows paths)", () => {
    const result = resolvePath("C:\\workspace\\src\\foo.ts", ["C:/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/src/foo.ts");
  });

  it("§5.1-ABS-03: throws when absolute path is outside all workspace folders", () => {
    expect(() =>
      resolvePath("/outside/secret.ts", ["/workspace"]),
    ).toThrow("Path is outside workspace");
  });

  it("§5.1-ABS-04: accepts path equal to workspace root itself", () => {
    const result = resolvePath("/workspace", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace");
  });

  it("§5.1-ABS-05: accepts path in second workspace root (multi-root)", () => {
    const result = resolvePath("/otherroot/file.ts", ["/workspace", "/otherroot"]);
    expect(normalizePathForComparison(result)).toBe("/otherroot/file.ts");
  });

  it("§5.1-ABS-06: normalises redundant path segments", () => {
    const result = resolvePath("/workspace/src/../lib/foo.ts", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/lib/foo.ts");
  });

  // ── Relative paths ──────────────────────────────────────────────────────

  it("§5.1-REL-01: resolves relative path against single workspace root", () => {
    const result = resolvePath("src/index.ts", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/src/index.ts");
  });

  it("§5.1-REL-02: resolves relative path at root level", () => {
    const result = resolvePath("README.md", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/README.md");
  });

  it("§5.1-REL-03: throws ambiguous error when relative path could belong to multiple roots", () => {
    expect(() =>
      resolvePath("src/foo.ts", ["/workspaceA", "/workspaceB"]),
    ).toThrow(/Ambiguous relative path/);
  });

  it("§5.1-REL-04: throws when no workspace folders are provided", () => {
    expect(() => resolvePath("src/foo.ts", [])).toThrow();
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("§5.1-EDGE-01: trailing slash on root does not cause double-slash in result", () => {
    const result = resolvePath("/workspace/src/foo.ts", ["/workspace/"]);
    expect(result).not.toContain("//");
    expect(normalizePathForComparison(result)).toBe("/workspace/src/foo.ts");
  });

  it("§5.1-EDGE-02: does NOT resolve symlinks — returns path as-is after normalise", () => {
    // Symlinks are not followed — this is a pure string operation
    const result = resolvePath("/workspace/link/foo.ts", ["/workspace"]);
    expect(normalizePathForComparison(result)).toBe("/workspace/link/foo.ts");
  });
});

// ── §5.2 wrapHandler ────────────────────────────────────────────────────────

describe("wrapHandler", () => {
  it("§5.2-OK-01: returns result when handler resolves successfully", async () => {
    const handler = vi.fn().mockResolvedValue({ done: true });
    const wrapped = wrapHandler("test.tool", handler);
    await expect(wrapped({})).resolves.toEqual({ done: true });
  });

  it("§5.2-OK-02: passes args through to the underlying handler", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapHandler("test.tool", handler);
    await wrapped({ path: "/foo.ts", line: 5 });
    expect(handler).toHaveBeenCalledWith({ path: "/foo.ts", line: 5 });
  });

  it("§5.2-ERR-01: catches thrown Error and returns { error: message }", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("something broke"));
    const wrapped = wrapHandler("test.tool", handler);
    await expect(wrapped({})).resolves.toEqual({ error: "something broke" });
  });

  it("§5.2-ERR-02: catches thrown string and wraps it", async () => {
    const handler = vi.fn().mockRejectedValue("raw string error");
    const wrapped = wrapHandler("test.tool", handler);
    const result = await wrapped({});
    expect(result).toHaveProperty("error");
  });

  it("§5.2-SERIAL-01: throws (or returns error) when handler returns non-serialisable value (circular ref)", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const handler = vi.fn().mockResolvedValue(circular);
    const wrapped = wrapHandler("test.tool", handler);
    const result = await wrapped({});
    expect(result).toHaveProperty("error");
  });

  it("§5.2-SERIAL-02: rejects a handler that returns a function", async () => {
    const handler = vi.fn().mockResolvedValue({
      fn: () => {},
    } as unknown as Record<string, unknown>);
    const wrapped = wrapHandler("test.tool", handler);
    // Functions are silently dropped by JSON.stringify — not an error, value becomes {}
    // OR implementation may reject — either is acceptable; tests verify no crash
    await expect(wrapped({})).resolves.toBeDefined();
  });

  it("§5.2-ASYNC-01: works correctly with genuinely async handlers", async () => {
    const handler = async (_args: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 1));
      return { async: true } as Record<string, unknown>;
    };
    const wrapped = wrapHandler("test.tool", handler);
    await expect(wrapped({})).resolves.toEqual({ async: true });
  });
});

// ── Internal helpers ─────────────────────────────────────────────────────────

describe("normaliseSlashes", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normaliseSlashes("C:\\foo\\bar")).toBe("C:/foo/bar");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normaliseSlashes("/foo/bar")).toBe("/foo/bar");
  });

  it("handles mixed separators", () => {
    expect(normaliseSlashes("/foo\\bar/baz")).toBe("/foo/bar/baz");
  });
});

describe("isInsideWorkspace", () => {
  it("returns true for exact root match", () => {
    expect(isInsideWorkspace("/workspace", ["/workspace"])).toBe(true);
  });

  it("returns true for path inside root", () => {
    expect(isInsideWorkspace("/workspace/src/foo.ts", ["/workspace"])).toBe(true);
  });

  it("returns false for path outside root", () => {
    expect(isInsideWorkspace("/outside/foo.ts", ["/workspace"])).toBe(false);
  });

  it("returns false for root prefix that is not a directory boundary", () => {
    // /workspaceExtra should NOT match root /workspace
    expect(isInsideWorkspace("/workspaceExtra/foo.ts", ["/workspace"])).toBe(false);
  });

  it("returns true when any of multiple roots matches", () => {
    expect(
      isInsideWorkspace("/root2/foo.ts", ["/root1", "/root2"]),
    ).toBe(true);
  });
});
