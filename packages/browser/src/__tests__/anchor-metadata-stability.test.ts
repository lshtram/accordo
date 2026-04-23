import { describe, it, expect } from "vitest";
import { resolveAnchorMetadata } from "../page-tool-anchor-metadata.js";

describe("anchor metadata stability", () => {
  it("prefers nodeId over selector for rerender-resistant anchor identity", () => {
    const result = resolveAnchorMetadata({
      nodeId: 42,
      selector: ".dynamic-card.reordered.active",
    });

    expect(result).toEqual({
      anchorKey: "nodeId:42",
      anchorStrategy: "nodeId",
      anchorConfidence: "high",
    });
  });

  it("keeps id-based anchors stable even when surrounding selector classes change", () => {
    const first = resolveAnchorMetadata({ selector: "#composer" });
    const rerendered = resolveAnchorMetadata({ selector: "#composer" });

    expect(first).toEqual({
      anchorKey: "id:composer",
      anchorStrategy: "id",
      anchorConfidence: "high",
    });
    expect(rerendered).toEqual(first);
  });

  it("extracts the same data-testid anchor from repeated SPA inspections", () => {
    const first = resolveAnchorMetadata({ selector: "button[data-testid='send-message']" });
    const rerendered = resolveAnchorMetadata({ selector: "button[data-testid='send-message']" });

    expect(first).toEqual({
      anchorKey: "data-testid:send-message",
      anchorStrategy: "data-testid",
      anchorConfidence: "high",
    });
    expect(rerendered).toEqual(first);
  });

  it("falls back to css-path when only a volatile selector is available", () => {
    const result = resolveAnchorMetadata({ selector: ".list-item.dynamic-class-9f3ab2" });

    expect(result).toEqual({
      anchorKey: "css:.list-item.dynamic-class-9f3ab2",
      anchorStrategy: "css-path",
      anchorConfidence: "medium",
    });
  });

  it("marks body-level fallback anchors as low-confidence viewport anchors", () => {
    const result = resolveAnchorMetadata({ selector: "body" });

    expect(result).toEqual({
      anchorKey: "viewport-pct:50x50",
      anchorStrategy: "viewport-pct",
      anchorConfidence: "low",
    });
  });
});
