import { describe, it, expect, beforeEach } from "vitest";
import { handleRelayAction } from "../src/relay-actions.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("get_page_map local pagination", () => {
  beforeEach(() => {
    resetChromeMocks();
    document.body.innerHTML = `
      <button>One</button><button>Two</button><button>Three</button>
      <button>Four</button><button>Five</button>
    `;
  });

  it("applies offset and limit once and preserves node identity order", async () => {
    const response = await handleRelayAction({
      requestId: "test-pum-pagination",
      action: "get_page_map",
      payload: { interactiveOnly: true, offset: 1, limit: 2 },
    });

    expect(response.success).toBe(true);
    const data = response.data as {
      nodes: Array<{ nodeId: number; uid?: string; ref: string; text?: string; name?: string }>;
      totalAvailable?: number;
      hasMore?: boolean;
      nextOffset?: number;
    };

    expect(data.nodes).toHaveLength(2);
    expect(data.nodes.map((node) => node.nodeId)).toEqual([1, 2]);
    expect(data.nodes.map((node) => node.uid)).toEqual(["main:1", "main:2"]);
    expect(data.nodes.map((node) => node.ref)).toEqual(["ref-1", "ref-2"]);
    expect(data.nodes.map((node) => node.text ?? node.name)).toEqual(["Two", "Three"]);
    expect(data.totalAvailable).toBe(5);
    expect(data.hasMore).toBe(true);
    expect(data.nextOffset).toBe(3);
  });
});
