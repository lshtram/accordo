import { afterEach, describe, expect, it } from "vitest";
import { resolveElementTarget } from "../src/content/message-action-helpers.js";
import { clearRefIndex, registerNode } from "../src/content/page-map-ref-index.js";

describe("resolveElementTarget UID fallback", () => {
  afterEach(() => {
    clearRefIndex();
    document.body.innerHTML = "";
  });

  it("resolves colon-containing frame UIDs through the canonical nodeId parser", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    registerNode("ref-12", button, 12, "https://example.test/frame:12");

    await expect(resolveElementTarget("https://example.test/frame:12")).resolves.toBe(button);
  });

  it("does not partially parse malformed UID suffixes into ref lookups", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    registerNode("ref-12", button, 12, "https://example.test/frame:12");

    await expect(resolveElementTarget("https://example.test/frame:12junk")).resolves.toBeNull();
  });

  it("does not resolve leading-zero UID node IDs through ref fallback", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    registerNode("ref-1", button, 1, "main:1");

    await expect(resolveElementTarget("main:01")).resolves.toBeNull();
  });
});
