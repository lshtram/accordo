import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(TEST_DIR, "..", "..", "..");
const COPIED_CSS_PATH = join(PKG_DIR, "dist", "webview", "comment-sdk.css");
const BUILD_COPY_SCRIPT = join(PKG_DIR, "scripts", "copy-comment-sdk-css.mjs");

describe("comment-sdk css packaging boundary", () => {
  it("copies canonical SDK css into dist/webview artifact path used by drawing webview", async () => {
    await execFileAsync("node", [BUILD_COPY_SCRIPT], { cwd: PKG_DIR });
    await access(COPIED_CSS_PATH);
    const css = await readFile(COPIED_CSS_PATH, "utf8");
    expect(css).toContain(".accordo-pin");
    expect(css).toContain(".accordo-popover");
  });
});
