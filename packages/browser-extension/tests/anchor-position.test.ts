import { describe, it, expect, beforeEach } from "vitest";
import { resolveAnchorPagePosition } from "../src/content/anchor-position.js";
import { normalizeAnchorFingerprint } from "../src/content-anchor.js";

describe("anchor-position — enhanced + legacy key resolution", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  it("PIN-FIX-01: resolves id: anchor keys to page coordinates", () => {
    const heading = document.createElement("h1");
    heading.id = "firstHeading";
    heading.textContent = "Prince of Wales";
    heading.getBoundingClientRect = () => ({
      x: 400,
      y: 100,
      width: 300,
      height: 40,
      top: 100,
      right: 700,
      bottom: 140,
      left: 400,
      toJSON: () => ({}),
    });
    document.body.appendChild(heading);

    const pos = resolveAnchorPagePosition("id:firstHeading");
    expect(pos).toEqual({ x: 688, y: 104 });
  });

  it("PIN-FIX-02: resolves css: anchor keys to page coordinates", () => {
    const container = document.createElement("div");
    container.className = "infobox-image";
    const img = document.createElement("img");
    img.className = "mw-file-element";
    img.getBoundingClientRect = () => ({
      x: 1189,
      y: 314,
      width: 100,
      height: 113,
      top: 314,
      right: 1289,
      bottom: 427,
      left: 1189,
      toJSON: () => ({}),
    });
    container.appendChild(img);
    document.body.appendChild(container);

    const pos = resolveAnchorPagePosition("css:.infobox-image > img.mw-file-element");
    expect(pos).toEqual({ x: 1277, y: 318 });
  });

  it("PIN-FIX-03: preserves legacy offset placement when key includes @x,y", () => {
    const el = document.createElement("div");
    el.textContent = "hello world";
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
    document.body.appendChild(el);

    const legacyKey = `div:0:${normalizeAnchorFingerprint("hello world")}@120,45`;
    const pos = resolveAnchorPagePosition(legacyKey);
    expect(pos).toEqual({ x: 118, y: 69 });
  });

  it("PIN-FIX-04: falls back to viewport anchors when element not found", () => {
    const pos = resolveAnchorPagePosition("body:25%x50%");
    expect(pos).toEqual({ x: 238, y: 404 });
  });

  it("PIN-FIX-05: preserves offset placement for enhanced keys with @x,y suffix", () => {
    const img = document.createElement("img");
    img.id = "hero";
    img.getBoundingClientRect = () => ({
      x: 40,
      y: 50,
      width: 300,
      height: 200,
      top: 50,
      right: 340,
      bottom: 250,
      left: 40,
      toJSON: () => ({}),
    });
    document.body.appendChild(img);

    const pos = resolveAnchorPagePosition("id:hero@120,45");
    expect(pos).toEqual({ x: 148, y: 99 });
  });
});
