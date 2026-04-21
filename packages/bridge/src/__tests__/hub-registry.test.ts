import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REGISTRY_PATH,
  getEntry,
  probeRegistryEntry,
  readRegistry,
  removeStaleEntry,
  resolveRegistryPath,
} from "../hub-registry.js";

function tmpRegistryPath(name: string): string {
  return path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}.json`);
}

describe("hub-registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveRegistryPath uses env value when provided", () => {
    expect(resolveRegistryPath("/tmp/custom.json")).toBe("/tmp/custom.json");
    expect(resolveRegistryPath()).toBe(DEFAULT_REGISTRY_PATH);
  });

  it("readRegistry returns empty object for missing file", () => {
    const data = readRegistry(tmpRegistryPath("missing-registry"));
    expect(data).toEqual({});
  });

  it("getEntry reads existing project entry", () => {
    const registryPath = tmpRegistryPath("entry-registry");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({ projectA: { pid: 123, port: 3000, startedAt: new Date().toISOString() } }),
      "utf8",
    );

    expect(getEntry(registryPath, "projectA")?.port).toBe(3000);
  });

  it("removeStaleEntry deletes only target project key", () => {
    const registryPath = tmpRegistryPath("stale-registry");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        projectA: { pid: 1, port: 3000, startedAt: "a" },
        projectB: { pid: 2, port: 3001, startedAt: "b" },
      }),
      "utf8",
    );

    removeStaleEntry(registryPath, "projectA");
    const after = JSON.parse(fs.readFileSync(registryPath, "utf8")) as Record<string, unknown>;
    expect(after["projectA"]).toBeUndefined();
    expect(after["projectB"]).toBeDefined();
  });

  it("probeRegistryEntry removes dead PID entries and returns null", () => {
    const registryPath = tmpRegistryPath("probe-registry");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({ projectA: { pid: 999_999_999, port: 3000, startedAt: "now" } }),
      "utf8",
    );

    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const entry = probeRegistryEntry(registryPath, "projectA");
    expect(entry).toBeNull();

    const after = JSON.parse(fs.readFileSync(registryPath, "utf8")) as Record<string, unknown>;
    expect(after["projectA"]).toBeUndefined();
  });
});
