import { describe, expect, it } from "vitest";
import { handlePageUnderstandingActionMessage } from "../src/content/message-page-router.js";

describe("query target validation", () => {
  it("returns no-target when inspect_element gets no usable target", async () => {
    let response: unknown;
    await handlePageUnderstandingActionMessage("inspect_element", {}, (value) => { response = value; });
    expect(response).toEqual({ error: "no-target" });
  });

  it("returns invalid-request for malformed uid syntax", async () => {
    let response: unknown;
    await handlePageUnderstandingActionMessage("inspect_element", { uid: "baduid" }, (value) => { response = value; });
    expect(response).toEqual({ error: "invalid-request" });
  });

  it("returns invalid-request for malformed framed uid syntax", async () => {
    let response: unknown;
    await handlePageUnderstandingActionMessage("inspect_element", { uid: "main:notnum" }, (value) => { response = value; });
    expect(response).toEqual({ error: "invalid-request" });
  });

  it("returns invalid-request for malformed inspect_element selector syntax", async () => {
    let response: unknown;
    await handlePageUnderstandingActionMessage("inspect_element", { selector: "div[" }, (value) => { response = value; });
    expect(response).toEqual({ error: "invalid-request" });
  });

  it("returns invalid-request for malformed selector syntax", async () => {
    let response: unknown;
    await handlePageUnderstandingActionMessage("get_dom_excerpt", { selector: "div[" }, (value) => { response = value; });
    expect(response).toEqual({ error: "invalid-request" });
  });

  it("ignores malformed lower-priority selector when a valid anchorKey is present", async () => {
    let response: any;
    await handlePageUnderstandingActionMessage("get_dom_excerpt", { anchorKey: "id:main", selector: "div[" }, (value) => { response = value; });
    expect(response.error).toBeUndefined();
    expect(response.data.found).toBe(true);
  });

  it("keeps found:false for a valid lookup miss", async () => {
    let response: any;
    await handlePageUnderstandingActionMessage("get_dom_excerpt", { selector: ".missing-target" }, (value) => { response = value; });
    expect(response.data.found).toBe(false);
  });
});
