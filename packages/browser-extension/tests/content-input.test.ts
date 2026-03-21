/**
 * M80-CS-INPUT — content-input.test.ts
 *
 * Tests for Content Script: Comment Input & Popovers.
 * Runs in jsdom environment (DOM available via vitest environment: "jsdom").
 *
 * Protects: BR-F-51 through BR-F-56
 *
 * API checklist:
 * ✓ injectContextMenu — 2 tests
 * ✓ removeContextMenu — 1 test
 * ✓ showCommentForm — 2 tests
 * ✓ hideCommentForm — 1 test
 * ✓ showThreadPopover — 2 tests
 * ✓ hideThreadPopover — 1 test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import type { BrowserCommentThread, BrowserComment } from "../src/types.js";
import {
  injectContextMenu,
  removeContextMenu,
  showCommentForm,
  hideCommentForm,
  showThreadPopover,
  hideThreadPopover,
} from "../src/content-input.js";

/** Factory for a minimal BrowserComment */
function makeComment(id: string, threadId: string): BrowserComment {
  return {
    id,
    threadId,
    createdAt: new Date().toISOString(),
    author: { kind: "user", name: "Alice" },
    body: `Comment ${id}`,
    anchorKey: "div:0:hello",
    pageUrl: "https://example.com",
    status: "open",
  };
}

/** Factory for a BrowserCommentThread with comments */
function makeThread(id: string, commentCount = 1): BrowserCommentThread {
  const comments: BrowserComment[] = [];
  for (let i = 0; i < commentCount; i++) {
    comments.push(makeComment(`${id}-c${i}`, id));
  }
  return {
    id,
    anchorKey: "div:0:hello",
    pageUrl: "https://example.com",
    status: "open",
    comments,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("M80-CS-INPUT — Content Script Input & Popovers", () => {
  beforeEach(() => {
    resetChromeMocks();
    document.body.innerHTML = "";
  });

  describe("injectContextMenu", () => {
    it("BR-F-55: injectContextMenu adds a context menu element to the DOM", () => {
      // BR-F-55: Context menu item for 'Add Comment' injected into DOM overlay
      injectContextMenu();
      const menuEl = document.querySelector("[data-accordo-context-menu]");
      expect(menuEl).not.toBeNull();
    });

    it("BR-F-55: injectContextMenu is idempotent (does not add duplicate menus)", () => {
      // BR-F-55: Calling twice should not create two menus
      injectContextMenu();
      injectContextMenu();
      const menus = document.querySelectorAll("[data-accordo-context-menu]");
      expect(menus.length).toBe(1);
    });
  });

  describe("removeContextMenu", () => {
    it("BR-F-59: removeContextMenu removes the context menu element from DOM", () => {
      // BR-F-59: Context menu cleaned up when Comments Mode is OFF
      injectContextMenu();
      removeContextMenu();
      const menuEl = document.querySelector("[data-accordo-context-menu]");
      expect(menuEl).toBeNull();
    });
  });

  describe("showCommentForm", () => {
    it("BR-F-55: showCommentForm renders an input form in the DOM", () => {
      // BR-F-55: Inline comment input form shown near the right-clicked element
      showCommentForm("div:0:hello");
      const form = document.querySelector("[data-accordo-comment-form]");
      expect(form).not.toBeNull();
    });

    it("BR-F-56: form contains a submit button to send CREATE_THREAD message", () => {
      // BR-F-56: Submitting form sends create-comment message
      showCommentForm("div:0:hello");
      const form = document.querySelector("[data-accordo-comment-form]");
      expect(form).not.toBeNull();
      // Form should have a submit button or input
      const submitButton = form?.querySelector("button") ?? form?.querySelector('[type="submit"]');
      expect(submitButton).not.toBeNull();
    });
  });

  describe("hideCommentForm", () => {
    it("BR-F-55: hideCommentForm removes the comment form from DOM", () => {
      // BR-F-55: Escape or click-away dismisses the form
      showCommentForm("div:0:hello");
      hideCommentForm();
      const form = document.querySelector("[data-accordo-comment-form]");
      expect(form).toBeNull();
    });
  });

  describe("showThreadPopover", () => {
    it("BR-F-51: showThreadPopover renders thread popover in the DOM", () => {
      // BR-F-51: Clicking a pin opens a popover showing the thread
      const thread = makeThread("t001", 2);
      showThreadPopover(thread);
      const popover = document.querySelector("[data-accordo-popover]");
      expect(popover).not.toBeNull();
    });

    it("BR-F-54: popover includes a delete button per comment", () => {
      // BR-F-54: Delete button per comment sends delete-comment message
      const thread = makeThread("t002", 1);
      showThreadPopover(thread);
      const popover = document.querySelector("[data-accordo-popover]");
      const deleteBtn = popover?.querySelector("[data-action='delete']") ?? popover?.querySelector("[data-accordo-delete]");
      expect(deleteBtn).not.toBeNull();
    });

    it("BR-F-52: popover includes a reply input field", () => {
      // BR-F-52: Popover reply input field sends reply-comment message on submit
      const thread = makeThread("t003", 1);
      showThreadPopover(thread);
      const popover = document.querySelector("[data-accordo-popover]");
      const replyInput = popover?.querySelector("textarea") ?? popover?.querySelector("input[type='text']");
      expect(replyInput).not.toBeNull();
    });

    it("BR-F-53: popover includes resolve/reopen button based on current thread status", () => {
      // BR-F-53: Resolve/reopen button label matches thread status
      const openThread = makeThread("t-open");
      openThread.status = "open";
      showThreadPopover(openThread);
      const popover = document.querySelector("[data-accordo-popover]");
      const actionBtn = popover?.querySelector("[data-action='resolve']") ?? popover?.querySelector("[data-action='reopen']") ?? popover?.querySelector("[data-accordo-status]");
      expect(actionBtn).not.toBeNull();
    });

    it("BR-F-53: resolve button label changes to reopen when thread is resolved", () => {
      // BR-F-53: Button reflects current status
      const resolved = makeThread("t-resolved");
      resolved.status = "resolved";
      showThreadPopover(resolved);
      const popover = document.querySelector("[data-accordo-popover]");
      // Should show a reopen button since the thread is already resolved
      const reopenBtn = popover?.querySelector("[data-action='reopen']");
      expect(reopenBtn).not.toBeNull();
    });
  });

  describe("hideThreadPopover", () => {
    it("BR-F-51: hideThreadPopover removes the popover from DOM", () => {
      // BR-F-51: Popover is removed when pin click-away or close
      const thread = makeThread("t003");
      showThreadPopover(thread);
      hideThreadPopover();
      const popover = document.querySelector("[data-accordo-popover]");
      expect(popover).toBeNull();
    });
  });
});
