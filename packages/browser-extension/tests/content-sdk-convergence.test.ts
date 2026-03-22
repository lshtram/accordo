import { describe, it, expect, beforeEach, vi } from "vitest";
import { openSdkComposerAtAnchor } from "../src/content/sdk-convergence.js";

describe("M81-SDK — SDK convergence helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("BR-F-118: right-click anchor target is prepared with data-block-id for SDK composer", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    openSdkComposerAtAnchor(target, "div:0:title@10,8", 120, 45);

    expect(target.getAttribute("data-anchor")).toBe("div:0:title@10,8");
    expect(target.getAttribute("data-block-id")).toBe("div:0:title@10,8");
  });

  it("BR-F-127: helper dispatches synthetic Alt+click to enter SDK create flow", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const listener = vi.fn((e: Event) => {
      const evt = e as MouseEvent;
      expect(evt.altKey).toBe(true);
      expect(evt.clientX).toBe(300);
      expect(evt.clientY).toBe(220);
    });
    target.addEventListener("click", listener);

    openSdkComposerAtAnchor(target, "div:1:item@14,9", 300, 220);

    expect(listener).toHaveBeenCalledOnce();
  });
});
