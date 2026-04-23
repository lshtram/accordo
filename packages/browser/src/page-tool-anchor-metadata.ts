import type { InspectElementArgs } from "./page-tool-handlers.js";

export function resolveAnchorMetadata(args: InspectElementArgs): {
  anchorStrategy: string;
  anchorConfidence: string;
  anchorKey: string;
} {
  const { ref, selector, nodeId } = args;

  if (nodeId !== undefined) {
    return {
      anchorKey: `nodeId:${nodeId}`,
      anchorStrategy: "nodeId",
      anchorConfidence: "high",
    };
  }

  const target = selector ?? ref ?? "";

  if (selector?.startsWith("#")) {
    const id = selector.slice(1);
    return {
      anchorKey: `id:${id}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  if (selector?.includes("data-testid")) {
    const match = /data-testid=['"]([^'"]+)['"]/.exec(selector);
    const testid = match ? match[1] : selector;
    return {
      anchorKey: `data-testid:${testid}`,
      anchorStrategy: "data-testid",
      anchorConfidence: "high",
    };
  }

  if (selector?.includes("aria-label")) {
    return {
      anchorKey: `aria:${selector}`,
      anchorStrategy: "aria",
      anchorConfidence: "high",
    };
  }

  if (selector === "body" || target === "body") {
    return {
      anchorKey: "viewport-pct:50x50",
      anchorStrategy: "viewport-pct",
      anchorConfidence: "low",
    };
  }

  if (ref) {
    return {
      anchorKey: `id:${ref}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  return {
    anchorKey: `css:${target}`,
    anchorStrategy: "css-path",
    anchorConfidence: "medium",
  };
}
