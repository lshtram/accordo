import { describe, expect, it } from "vitest";
import {
  BRIDGE_SECRET_KEY,
  HUB_TOKEN_KEY,
  getProjectId,
  scopedSecretKey,
} from "../project-identity.js";

describe("project-identity", () => {
  it("returns stable IDs for the same workspace path", () => {
    const path = "/Users/test/workspaces/accordo";
    expect(getProjectId(path)).toBe(getProjectId(path));
  });

  it("returns different IDs for different workspace paths", () => {
    const a = getProjectId("/work/a");
    const b = getProjectId("/work/b");
    expect(a).not.toBe(b);
  });

  it("uses deterministic 32-char hex ID for empty workspace", () => {
    const id = getProjectId("");
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(id).toBe(getProjectId("   "));
  });

  it("scopes secret keys with accordo.<projectId>.<suffix>", () => {
    expect(scopedSecretKey(BRIDGE_SECRET_KEY, "p1")).toBe("accordo.p1.bridgeSecret");
    expect(scopedSecretKey(HUB_TOKEN_KEY, "p1")).toBe("accordo.p1.hubToken");
  });
});
