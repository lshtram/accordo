/**
 * relay-select-page-input.test.ts — Input validation for handleSelectPage.
 *
 * @module
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectPage } from "../src/relay-tab-handlers.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("handleSelectPage — input validation", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("invalid-request when tabId is not a number", async () => {
    const result = await handleSelectPage({
      requestId: "req-1",
      action: "select_page",
      payload: { tabId: "7" as unknown as number },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is a float", async () => {
    const result = await handleSelectPage({
      requestId: "req-2",
      action: "select_page",
      payload: { tabId: 7.5 },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is zero", async () => {
    const result = await handleSelectPage({
      requestId: "req-3",
      action: "select_page",
      payload: { tabId: 0 },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is negative", async () => {
    const result = await handleSelectPage({
      requestId: "req-4",
      action: "select_page",
      payload: { tabId: -1 },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("invalid-request when tabId is missing", async () => {
    const result = await handleSelectPage({
      requestId: "req-5",
      action: "select_page",
      payload: {},
    } as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });
});