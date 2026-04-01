import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["../../test-setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    // Phase B tests intentionally trigger unhandled rejections because the stub
    // rejects every enqueue() call. These are assertion-level failures, not bugs.
    unhandledRejections: "warn",

    // ── Process-safety settings (prevent worker hangs from crashing the system) ──
    // See docs/reviews/audio-queue-phase-a.md §8 for rationale.

    // Individual test timeout: 5 seconds. Audio mock tests resolve in <50ms.
    // If a test blocks for 5s, something is genuinely hung (unmocked I/O,
    // missing mock resolution, etc.). 5s is long enough for slow CI machines
    // but short enough that a hung test is killed before it consumes resources.
    testTimeout: 5_000,

    // Hook timeout: setup/teardown that does async work (creating queues,
    // disposing them) gets 5s — same rationale as testTimeout.
    hookTimeout: 5_000,

    // Teardown timeout: if afterAll/afterEach cleanup hangs (e.g. a dispose()
    // that waits on a process that never exits), kill it after 3s.
    teardownTimeout: 3_000,

    // Pool: use 'forks' (child processes) rather than 'threads' (worker_threads).
    // Forks provide full process isolation — a hung test in one fork cannot
    // block the main vitest process. If a fork exceeds testTimeout, vitest
    // kills the entire fork process (clean kill, no zombie).
    pool: "forks",
    poolOptions: {
      forks: {
        // Limit concurrent forks to 2. On a 4-core dev machine, this leaves
        // 2 cores for the OS, editor, and the audio player process.
        // On CI (usually 2-core), this still works — vitest schedules test
        // files across forks, not individual tests.
        maxForks: 2,
        minForks: 1,
      },
    },

    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**"],
    },
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});
