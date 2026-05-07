import { describe, expect, it } from "vitest";
import { annotateManagedElements } from "../../webview/managed-metadata.js";

describe("managed-metadata", () => {
  it("DRW-C02: annotates browser-bootstrap node and edge elements from Mermaid source", () => {
    const elements = [
      { id: "A", type: "rectangle" },
      { id: "A_B", type: "arrow" },
      { id: "label-1", type: "text" },
    ] as never;

    const annotated = annotateManagedElements(
      elements,
      "flowchart LR\nA[Alpha] --> B[Beta]",
      "/workspace/demo.mmd",
    ) as Array<{ customData?: { accordo?: { entityKind: string; identity: string; sceneRole: string; status: string } } }>;

    expect(annotated[0]?.customData?.accordo).toMatchObject({
      entityKind: "node",
      identity: "A",
      sceneRole: "primary",
      status: "active",
    });
    expect(annotated[1]?.customData?.accordo).toMatchObject({
      entityKind: "edge",
      identity: "A->B:0",
      sceneRole: "primary",
      status: "active",
    });
    expect(annotated[2]?.customData?.accordo).toBeUndefined();
  });
});
