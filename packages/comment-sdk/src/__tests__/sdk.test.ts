/**
 * AccordoCommentSDK — unit tests (Phase B — all must fail on stubs)
 *
 * Requirements tested:
 *   M41-SDK-01  init() — attaches layer, enables Alt+click
 *   M41-SDK-02  loadThreads() — renders pins for all threads
 *   M41-SDK-03  addThread() — adds one pin without clearing others
 *   M41-SDK-04  updateThread() — updates pin CSS class on state change
 *   M41-SDK-05  removeThread() — removes pin from DOM
 *   M41-SDK-06  Pin CSS classes: pin--open, pin--updated, pin--resolved
 *   M41-SDK-07  Alt+click → onCreate callback after input submission
 *   M41-SDK-08  Click pin → thread popover with comment list
 *   M41-SDK-09  Popover: reply input, resolve button (open); reopen (resolved)
 *   M41-SDK-10  Popover actions → onReply / onResolve / onDelete callbacks
 *   M41-SDK-11  Only one popover at a time
 *   M41-SDK-12  Click outside → close popover
 *   M41-SDK-13  destroy() — removes all pins, listeners, layer
 *   M41-SDK-14  resolvePinState() — open, updated, resolved state mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccordoCommentSDK } from "../sdk.js";
import type { SdkThread, SdkCallbacks, SdkInitOptions, SdkComment } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.position = "relative";
  el.style.width = "800px";
  el.style.height = "1200px";
  document.body.appendChild(el);
  return el;
}

function makeCallbacks(): SdkCallbacks {
  return {
    onCreate: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onDelete: vi.fn(),
  };
}

function makeThread(overrides: Partial<SdkThread> = {}): SdkThread {
  const comment: SdkComment = {
    id: "c1",
    author: { kind: "user", name: "Alice" },
    body: "This heading needs work",
    createdAt: "2026-03-04T10:00:00Z",
  };
  return {
    id: "thread-1",
    blockId: "heading:1:introduction",
    status: "open",
    hasUnread: false,
    comments: [comment],
    ...overrides,
  };
}

function makeInitOpts(
  container: HTMLElement,
  callbacks: SdkCallbacks,
  screenPos: { x: number; y: number } | null = { x: 100, y: 200 },
): SdkInitOptions {
  return {
    container,
    coordinateToScreen: () => screenPos,
    callbacks,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccordoCommentSDK", () => {
  let container: HTMLElement;
  let callbacks: SdkCallbacks;
  let sdk: AccordoCommentSDK;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = makeContainer();
    callbacks = makeCallbacks();
    sdk = new AccordoCommentSDK();
  });

  // ── M41-SDK-01: init ───────────────────────────────────────────────────────

  describe("M41-SDK-01: init()", () => {
    it("creates a .accordo-sdk-layer div inside the container", () => {
      sdk.init(makeInitOpts(container, callbacks));
      const layer = container.querySelector(".accordo-sdk-layer");
      expect(layer).not.toBeNull();
      expect(layer!.parentElement).toBe(container);
    });

    it("layer has .accordo-sdk-layer class (CSS provides pointer-events:none)", () => {
      sdk.init(makeInitOpts(container, callbacks));
      const layer = container.querySelector<HTMLElement>(".accordo-sdk-layer")!;
      expect(layer.classList.contains("accordo-sdk-layer")).toBe(true);
    });

    it("layer is positioned absolutely (via .accordo-sdk-layer CSS class)", () => {
      sdk.init(makeInitOpts(container, callbacks));
      const layer = container.querySelector<HTMLElement>(".accordo-sdk-layer")!;
      // Position comes from the CSS class, not inline style
      expect(layer.classList.contains("accordo-sdk-layer")).toBe(true);
      expect(layer.style.position).toBe(""); // no inline override
    });
  });

  // ── M41-SDK-02: loadThreads ────────────────────────────────────────────────

  describe("M41-SDK-02: loadThreads()", () => {
    it("renders one pin per thread with a resolved screen position", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1" }), makeThread({ id: "t2", blockId: "p:3" })]);
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(2);
    });

    it("skips threads whose coordinateToScreen returns null (not visible)", () => {
      sdk.init(makeInitOpts(container, callbacks, null));
      sdk.loadThreads([makeThread()]);
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(0);
    });

    it("clears previously rendered pins before re-rendering", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1" })]);
      sdk.loadThreads([makeThread({ id: "t2" }), makeThread({ id: "t3", blockId: "p:2" })]);
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(2);
    });

    it("pins carry a data-thread-id attribute matching their thread id", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      const thread = makeThread({ id: "thread-xyz" });
      sdk.loadThreads([thread]);
      const pin = container.querySelector("[data-thread-id='thread-xyz']");
      expect(pin).not.toBeNull();
    });
  });

  // ── M41-SDK-03: addThread ─────────────────────────────────────────────────

  describe("M41-SDK-03: addThread()", () => {
    it("adds a new pin without removing existing ones", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1" })]);
      sdk.addThread(makeThread({ id: "t2", blockId: "p:3" }));
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(2);
    });

    it("does nothing if coordinateToScreen returns null for the new thread", () => {
      // First load with visible coords, then addThread with invisible
      let callCount = 0;
      sdk.init({
        container,
        callbacks,
        coordinateToScreen: (blockId) => {
          callCount++;
          return blockId === "heading:1:introduction" ? { x: 100, y: 200 } : null;
        },
      });
      sdk.loadThreads([makeThread({ id: "t1" })]);
      sdk.addThread(makeThread({ id: "t2", blockId: "invisible-block" }));
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(1);
    });
  });

  // ── M41-SDK-04: updateThread ──────────────────────────────────────────────

  describe("M41-SDK-04: updateThread()", () => {
    it("updates pin CSS class when status changes to resolved", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1", status: "open" })]);
      sdk.updateThread("t1", { status: "resolved" });
      const pin = container.querySelector("[data-thread-id='t1']")!;
      expect(pin.classList.contains("accordo-pin--resolved")).toBe(true);
      expect(pin.classList.contains("accordo-pin--open")).toBe(false);
    });

    it("updates pin CSS class when hasUnread becomes true", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1", hasUnread: false })]);
      sdk.updateThread("t1", { hasUnread: true });
      const pin = container.querySelector("[data-thread-id='t1']")!;
      expect(pin.classList.contains("accordo-pin--updated")).toBe(true);
    });

    it("silently does nothing if threadId not found", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1" })]);
      // Should not throw
      expect(() => sdk.updateThread("unknown-id", { status: "resolved" })).not.toThrow();
    });
  });

  // ── M41-SDK-05: removeThread ──────────────────────────────────────────────

  describe("M41-SDK-05: removeThread()", () => {
    it("removes the pin element from the DOM", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "t1" }), makeThread({ id: "t2", blockId: "p:2" })]);
      sdk.removeThread("t1");
      const pins = container.querySelectorAll(".accordo-pin");
      expect(pins.length).toBe(1);
      expect(container.querySelector("[data-thread-id='t1']")).toBeNull();
    });

    it("silently does nothing if threadId not found", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      expect(() => sdk.removeThread("ghost")).not.toThrow();
    });
  });

  // ── M41-SDK-06: Pin CSS classes ───────────────────────────────────────────

  describe("M41-SDK-06: pin CSS class states", () => {
    it("open thread → .accordo-pin--open", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ status: "open", hasUnread: false })]);
      const pin = container.querySelector(".accordo-pin")!;
      expect(pin.classList.contains("accordo-pin--open")).toBe(true);
    });

    it("open thread with unread → .accordo-pin--updated", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ status: "open", hasUnread: true })]);
      const pin = container.querySelector(".accordo-pin")!;
      expect(pin.classList.contains("accordo-pin--updated")).toBe(true);
    });

    it("resolved thread → .accordo-pin--resolved", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ status: "resolved", hasUnread: false })]);
      const pin = container.querySelector(".accordo-pin")!;
      expect(pin.classList.contains("accordo-pin--resolved")).toBe(true);
    });

    it("pin shows reply count badge", () => {
      const thread = makeThread({
        comments: [
          { id: "c1", author: { kind: "user", name: "A" }, body: "first", createdAt: "2026-03-04T10:00:00Z" },
          { id: "c2", author: { kind: "agent", name: "Bot" }, body: "second", createdAt: "2026-03-04T10:01:00Z" },
        ],
      });
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([thread]);
      const pin = container.querySelector(".accordo-pin")!;
      expect(pin.textContent).toContain("2");
    });
  });

  // ── M41-SDK-07: Alt+click → onCreate ─────────────────────────────────────

  describe("M41-SDK-07: Alt+click creates new comment input", () => {
    it("Alt+click on a block element opens an inline input form", () => {
      // Simulate a block element inside the container
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "p:5");
      container.appendChild(block);
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));

      const event = new MouseEvent("click", { bubbles: true, altKey: true });
      block.dispatchEvent(event);

      const input = container.querySelector(".accordo-inline-input");
      expect(input).not.toBeNull();
    });

    it("submitting the inline input calls callbacks.onCreate with blockId and body", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "p:5");
      container.appendChild(block);
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));

      const altClick = new MouseEvent("click", { bubbles: true, altKey: true });
      block.dispatchEvent(altClick);

      const textarea = container.querySelector<HTMLTextAreaElement>(".accordo-inline-input textarea")!;
      textarea.value = "This paragraph needs revision";

      const submitBtn = container.querySelector<HTMLButtonElement>(".accordo-inline-input .accordo-btn--primary")!;
      submitBtn.click();

      expect(callbacks.onCreate).toHaveBeenCalledWith("p:5", "This paragraph needs revision", undefined);
    });

    it("cancelling the inline input removes the form without calling onCreate", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "p:5");
      container.appendChild(block);
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));

      block.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
      const cancelBtn = container.querySelector<HTMLButtonElement>(".accordo-inline-input .accordo-btn--secondary")!;
      cancelBtn.click();

      expect(callbacks.onCreate).not.toHaveBeenCalled();
      expect(container.querySelector(".accordo-inline-input")).toBeNull();
    });

    it("Alt+click outside any [data-block-id] element does NOT open the input form", () => {
      // Container has no child with data-block-id
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));

      const event = new MouseEvent("click", { bubbles: true, altKey: true });
      container.dispatchEvent(event);

      const input = container.querySelector(".accordo-inline-input");
      expect(input).toBeNull();
      expect(callbacks.onCreate).not.toHaveBeenCalled();
    });
  });

  // ── M41-SDK-08: Click pin → popover ──────────────────────────────────────

  describe("M41-SDK-08: clicking a pin opens the thread popover", () => {
    it("clicking a pin renders a .accordo-popover element", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread()]);
      const pin = container.querySelector<HTMLElement>(".accordo-pin")!;
      pin.click();
      const popover = container.querySelector(".accordo-popover");
      expect(popover).not.toBeNull();
    });

    it("popover shows the comment author and body", () => {
      const thread = makeThread({
        comments: [{ id: "c1", author: { kind: "user", name: "Alice" }, body: "Needs revision", createdAt: "2026-03-04T10:00:00Z" }],
      });
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([thread]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();

      const popover = container.querySelector(".accordo-popover")!;
      expect(popover.textContent).toContain("Alice");
      expect(popover.textContent).toContain("Needs revision");
    });
  });

  // ── M41-SDK-09: Popover buttons ───────────────────────────────────────────

  describe("M41-SDK-09: popover contains correct action buttons", () => {
    it("open thread popover has a reply textarea and a resolve button", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ status: "open" })]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      const popover = container.querySelector(".accordo-popover")!;
      expect(popover.querySelector("textarea")).not.toBeNull();
      const resolveBtn = Array.from(popover.querySelectorAll("button")).find(
        (b) => b.textContent?.toLowerCase().includes("resolve"),
      );
      expect(resolveBtn).not.toBeNull();
    });

    it("resolved thread popover has a reopen button (no resolve button)", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ status: "resolved" })]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      const popover = container.querySelector(".accordo-popover")!;
      const reopenBtn = Array.from(popover.querySelectorAll("button")).find(
        (b) => b.textContent?.toLowerCase().includes("reopen"),
      );
      expect(reopenBtn).not.toBeNull();
      const resolveBtn = Array.from(popover.querySelectorAll("button")).find(
        (b) => b.textContent?.toLowerCase().includes("resolve"),
      );
      expect(resolveBtn).toBeUndefined();
    });
  });

  // ── M41-SDK-10: Popover action callbacks ──────────────────────────────────

  describe("M41-SDK-10: popover action callbacks", () => {
    it("submitting a reply calls onReply with threadId and body", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "thread-abc", status: "open" })]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      const textarea = container.querySelector<HTMLTextAreaElement>(".accordo-popover textarea")!;
      textarea.value = "LGTM after the fix";
      const replyBtn = Array.from(container.querySelectorAll<HTMLButtonElement>(".accordo-popover button")).find(
        (b) => b.textContent?.toLowerCase().includes("reply"),
      )!;
      replyBtn.click();
      expect(callbacks.onReply).toHaveBeenCalledWith("thread-abc", "LGTM after the fix");
    });

    it("clicking resolve calls onResolve with threadId and note", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "thread-r", status: "open" })]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      // Fill in resolve note (if a textarea exists for it, otherwise direct resolve)
      const resolveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>(".accordo-popover button")).find(
        (b) => b.textContent?.toLowerCase().includes("resolve"),
      )!;
      resolveBtn.click();
      expect(callbacks.onResolve).toHaveBeenCalledWith("thread-r", expect.any(String));
    });

    it("clicking delete calls onDelete with threadId", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread({ id: "thread-d" })]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      const deleteBtn = Array.from(container.querySelectorAll<HTMLButtonElement>(".accordo-popover button")).find(
        (b) => b.textContent?.toLowerCase().includes("delete"),
      )!;
      deleteBtn.click();
      expect(callbacks.onDelete).toHaveBeenCalledWith("thread-d", undefined);
    });
  });

  // ── M41-SDK-11: Only one popover ──────────────────────────────────────────

  describe("M41-SDK-11: only one popover open at a time", () => {
    it("opening a second pin closes the first popover", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([
        makeThread({ id: "t1", blockId: "heading:1:intro" }),
        makeThread({ id: "t2", blockId: "p:2" }),
      ]);
      const [pin1, pin2] = container.querySelectorAll<HTMLElement>(".accordo-pin");
      pin1.click();
      expect(container.querySelectorAll(".accordo-popover").length).toBe(1);
      pin2.click();
      expect(container.querySelectorAll(".accordo-popover").length).toBe(1);
    });
  });

  // ── M41-SDK-12: Click outside → close ────────────────────────────────────

  describe("M41-SDK-12: clicking outside closes the popover", () => {
    it("click outside the popover removes it from DOM", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread()]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      expect(container.querySelector(".accordo-popover")).not.toBeNull();
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(container.querySelector(".accordo-popover")).toBeNull();
    });
  });

  // ── M41-SDK-13: destroy ───────────────────────────────────────────────────

  describe("M41-SDK-13: destroy()", () => {
    it("removes the layer element from the container", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread()]);
      sdk.destroy();
      expect(container.querySelector(".accordo-sdk-layer")).toBeNull();
    });

    it("removes all pins", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread()]);
      sdk.destroy();
      expect(container.querySelectorAll(".accordo-pin").length).toBe(0);
    });

    it("closes any open popover", () => {
      sdk.init(makeInitOpts(container, callbacks, { x: 100, y: 200 }));
      sdk.loadThreads([makeThread()]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      sdk.destroy();
      expect(container.querySelector(".accordo-popover")).toBeNull();
    });
  });

  // ── M41-SDK-14: resolvePinState ───────────────────────────────────────────

  describe("M41-SDK-14: resolvePinState()", () => {
    it("resolved thread → 'resolved'", () => {
      sdk.init(makeInitOpts(container, callbacks));
      expect(sdk.resolvePinState(makeThread({ status: "resolved", hasUnread: false }))).toBe("resolved");
    });

    it("open thread with unread → 'updated'", () => {
      sdk.init(makeInitOpts(container, callbacks));
      expect(sdk.resolvePinState(makeThread({ status: "open", hasUnread: true }))).toBe("updated");
    });

    it("open thread without unread → 'open'", () => {
      sdk.init(makeInitOpts(container, callbacks));
      expect(sdk.resolvePinState(makeThread({ status: "open", hasUnread: false }))).toBe("open");
    });

    it("resolved always wins over hasUnread", () => {
      sdk.init(makeInitOpts(container, callbacks));
      expect(sdk.resolvePinState(makeThread({ status: "resolved", hasUnread: true }))).toBe("resolved");
    });
  });

  // ── openPopover (programmatic focus from Comments panel) ──────────────────

  describe("openPopover()", () => {
    it("opens popover for a known threadId", () => {
      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);
      expect(container.querySelector(".accordo-popover")).toBeNull();

      sdk.openPopover("thread-1");

      expect(container.querySelector(".accordo-popover")).not.toBeNull();
    });

    it("does nothing for an unknown threadId", () => {
      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);

      sdk.openPopover("does-not-exist");

      expect(container.querySelector(".accordo-popover")).toBeNull();
    });

    it("only one popover open at a time", () => {
      sdk.init(makeInitOpts(container, callbacks));
      const thread2 = makeThread({ id: "thread-2", blockId: "p:0" });
      sdk.loadThreads([makeThread(), thread2]);

      sdk.openPopover("thread-1");
      sdk.openPopover("thread-2");

      expect(container.querySelectorAll(".accordo-popover")).toHaveLength(1);
    });
  });

  // ── Gutter markers & anchor highlight ─────────────────────────────────────

  describe("gutter markers and anchor highlight", () => {
    it("loadThreads adds .accordo-block--has-comments to anchored block elements", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "heading:1:introduction");
      container.appendChild(block);

      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);

      expect(block.classList.contains("accordo-block--has-comments")).toBe(true);
    });

    it("loadThreads clears old gutter markers before re-applying", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "heading:1:introduction");
      container.appendChild(block);

      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);
      expect(block.classList.contains("accordo-block--has-comments")).toBe(true);

      // Reload with no threads — marker removed
      sdk.loadThreads([]);
      expect(block.classList.contains("accordo-block--has-comments")).toBe(false);
    });

    it("clicking a pin adds .accordo-block--active-comment to the anchor element", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "heading:1:introduction");
      container.appendChild(block);

      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);

      container.querySelector<HTMLElement>(".accordo-pin")!.click();

      expect(block.classList.contains("accordo-block--active-comment")).toBe(true);
    });

    it("closing the popover removes .accordo-block--active-comment", () => {
      const block = document.createElement("p");
      block.setAttribute("data-block-id", "heading:1:introduction");
      container.appendChild(block);

      sdk.init(makeInitOpts(container, callbacks));
      sdk.loadThreads([makeThread()]);
      container.querySelector<HTMLElement>(".accordo-pin")!.click();
      expect(block.classList.contains("accordo-block--active-comment")).toBe(true);

      // Click outside to close popover
      document.body.click();

      expect(block.classList.contains("accordo-block--active-comment")).toBe(false);
    });
  });
});
