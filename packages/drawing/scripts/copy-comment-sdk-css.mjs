import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const SOURCE_CSS = join(PKG_ROOT, "..", "comment-sdk", "src", "sdk.css");
const TARGET_CSS = join(PKG_ROOT, "dist", "webview", "comment-sdk.css");

await mkdir(dirname(TARGET_CSS), { recursive: true });
await cp(SOURCE_CSS, TARGET_CSS);
