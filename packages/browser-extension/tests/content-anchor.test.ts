import { describe, it, expect, beforeEach } from "vitest";
import {
  findAnchorElementByKey,
  normalizeAnchorFingerprint,
  parseAnchorKey,
  getAnchorPagePosition,
} from "../src/content-anchor.js";

describe("M80-CS-PINS — anchor rehydration", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("BR-F-50: finds matching element after refresh and rehydrates data-anchor", () => {
    const el = document.createElement("h1");
    el.textContent = "Welcome to Search";
    document.body.appendChild(el);

    const key = `h1:0:${normalizeAnchorFingerprint(el.textContent ?? "")}`;
    const found = findAnchorElementByKey(key);

    expect(found).toBe(el);
    expect(el.getAttribute("data-anchor")).toBe(key);
  });

  it("BR-F-50: falls back to fingerprint match when sibling index changed", () => {
    const a = document.createElement("p");
    a.textContent = "other";
    const b = document.createElement("p");
    b.textContent = "Target Node";
    document.body.appendChild(a);
    document.body.appendChild(b);

    const key = `p:99:${normalizeAnchorFingerprint("Target Node")}`;
    const found = findAnchorElementByKey(key);

    expect(found).toBe(b);
    expect(b.getAttribute("data-anchor")).toBe(key);
  });

  it("BR-F-50: returns null when no candidate matches", () => {
    const el = document.createElement("div");
    el.textContent = "something else";
    document.body.appendChild(el);

    const found = findAnchorElementByKey("span:0:does_not_exist");
    expect(found).toBeNull();
  });

  it("BR-F-50: parses optional click-offset metadata from anchor key", () => {
    const parsed = parseAnchorKey("div:3:title@120,45");
    expect(parsed).not.toBeNull();
    expect(parsed?.fingerprint).toBe("title");
    expect(parsed?.offsetX).toBe(120);
    expect(parsed?.offsetY).toBe(45);
  });

  it("BR-F-50: computes page position from click offset when available", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      top: 20,
      right: 410,
      bottom: 320,
      left: 10,
      toJSON: () => ({}),
    });

    const pos = getAnchorPagePosition("div:0:text@120,45", el);
    expect(pos).toEqual({ x: 118, y: 69 });
  });
});
