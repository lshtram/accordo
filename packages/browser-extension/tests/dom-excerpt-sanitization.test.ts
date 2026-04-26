import { describe, expect, it } from "vitest";
import { getDomExcerpt } from "../src/content/element-inspector.js";

describe("dom excerpt sanitization and depth", () => {
  it("excludes forbidden tag text from both html and text", () => {
    document.body.innerHTML = `
      <div id="target">
        <style>.x{color:red}</style>
        <script>window.__secret=1</script>
        <p>Hello allowed</p>
      </div>
    `;

    const result = getDomExcerpt("#target", 3, 2000);

    expect(result.html).toContain("Hello allowed");
    expect(result.text).toContain("Hello allowed");
    expect(result.html).not.toContain("color:red");
    expect(result.html).not.toContain("window.__secret");
    expect(result.text).not.toContain("color:red");
    expect(result.text).not.toContain("window.__secret");
  });

  it("at maxDepth includes only direct text-node children of the cutoff element", () => {
    document.body.innerHTML = `
      <div id="target">
        <section>
          Direct text
          <p>Deep allowed</p>
          <script>deepSecret()</script>
        </section>
      </div>
    `;

    const result = getDomExcerpt("#target", 1, 2000);

    expect(result.html).toContain("<section>Direct text</section>");
    expect(result.html).not.toContain("Deep allowed");
    expect(result.html).not.toContain("deepSecret");
    expect(result.text).toContain("Direct text");
    expect(result.text).not.toContain("Deep allowed");
    expect(result.text).not.toContain("deepSecret");
  });

  it("keeps nodeCount behavior stable for allowed serialized elements", () => {
    document.body.innerHTML = `
      <div id="target">
        <section><p>Hello</p></section>
        <style>.x{color:red}</style>
      </div>
    `;

    const result = getDomExcerpt("#target", 3, 2000);

    expect(result.nodeCount).toBe(3);
  });
});
