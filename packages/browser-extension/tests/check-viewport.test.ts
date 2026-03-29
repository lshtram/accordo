import { it, expect } from "vitest";
it("check viewport dims", () => {
  console.log("innerWidth:", window.innerWidth);
  console.log("innerHeight:", window.innerHeight);
  console.log("clientWidth:", document.documentElement.clientWidth);
  console.log("clientHeight:", document.documentElement.clientHeight);
  expect(true).toBe(true);
});
