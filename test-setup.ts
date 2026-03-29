/**
 * Shared Vitest setup — test-run logger
 *
 * Logs a timestamped line to stderr AND to .accordo/test-runs.log at the
 * start of every test file.
 *
 * Format:  [TEST-RUN] 2026-03-29T12:34:56.789Z  packages/hub/src/__tests__/foo.test.ts
 *
 * Purpose: if tests ever run unexpectedly (e.g. due to a rogue scheduler or
 * an automated agent triggering pnpm test on a cycle), the persistent log
 * makes it easy to see exactly which file ran and at what time — even after
 * the terminal session is gone.
 *
 * Each package's vitest.config.ts adds this file to its setupFiles list.
 */

import { beforeAll } from "vitest";
import { relative, resolve } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";

// Log file lives at the repo root so all packages write to the same place
const REPO_ROOT = resolve(import.meta.dirname, ".");
const LOG_FILE = resolve(REPO_ROOT, ".accordo", "test-runs.log");

// Ensure .accordo directory exists (it always should, but be safe)
try { mkdirSync(resolve(REPO_ROOT, ".accordo"), { recursive: true }); } catch { /* ignore */ }

beforeAll(({ file }) => {
  const rel = relative(REPO_ROOT, file.filepath);
  const ts = new Date().toISOString();
  const line = `[TEST-RUN] ${ts}  ${rel}\n`;

  // Always write to stderr (visible in terminal)
  process.stderr.write(line);

  // Also append to persistent log file
  try {
    appendFileSync(LOG_FILE, line, "utf8");
  } catch {
    // Non-fatal — don't break tests if log write fails
  }
});
