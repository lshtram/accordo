import { describe, expect, it } from "vitest";
import { getDomExcerpt } from "../src/content/element-inspector.js";

describe("dom excerpt truncation", () => {
  it("bounds both html and text and truncates sanitized output", () => {
    document.body.innerHTML = `
      <div id="target">
        <style>.secret{display:none}</style>
        <p>${"hello ".repeat(40)}</p>
      </div>
    `;

    const result = getDomExcerpt("#target", 3, 40);

    expect(result.truncated).toBe(true);
    expect((result.html ?? "").length).toBeLessThanOrEqual(40);
    expect((result.text ?? "").length).toBeLessThanOrEqual(40);
    expect(result.html).not.toContain("display:none");
    expect(result.text).not.toContain("display:none");
  });

  it("excludes nested forbidden content even below the depth cutoff", () => {
    document.body.innerHTML = `
      <div id="target">
        <section>
          <article>
            <style>.hidden{color:blue}</style>
            <script>nestedLeak()</script>
            <p>Deep text</p>
          </article>
        </section>
      </div>
    `;

    const result = getDomExcerpt("#target", 1, 2000);

    expect(result.html).not.toContain("hidden{color:blue}");
    expect(result.html).not.toContain("nestedLeak");
    expect(result.text).not.toContain("hidden{color:blue}");
    expect(result.text).not.toContain("nestedLeak");
  });
});
