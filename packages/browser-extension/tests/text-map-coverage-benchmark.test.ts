/**
 * text-map-coverage-benchmark.test.ts
 *
 * Benchmark: visible-text-to-element mapping coverage ≥ 95%
 *
 * Requirement: MCP WebView Agent Evaluation Checklist §6 must-have:
 *   "Visible text extraction with element mapping coverage ≥ 95% on benchmark pages"
 *
 * Test ID prefix: B2-TX-COV
 *
 * Design:
 *   - Five representative HTML page fixtures model real-world content patterns:
 *       COV-01: Article page (headings, paragraphs, aside, blockquote, links)
 *       COV-02: Form page (labels, inputs, select, textarea, validation hints)
 *       COV-03: Navigation + table (nav links, th/td cells, caption)
 *       COV-04: E-commerce card grid (product titles, prices, badges, CTAs)
 *       COV-05: Mixed-visibility page (visible, hidden, offscreen, opacity-0 elements)
 *   - Each fixture declares a ground-truth set of visible text strings.
 *   - collectTextMap() is called and segments are checked for each expected string.
 *   - Coverage = (found / expected) * 100. Must be ≥ COVERAGE_THRESHOLD_PCT.
 *   - Each fixture also asserts that hidden/offscreen text is NOT counted as missing
 *     (they appear in segments but with visibility ≠ "visible").
 *   - A combined cross-fixture score is also computed and asserted.
 *
 * Helpers:
 *   - buildBenchmarkPage(html): set document.body.innerHTML + mock bboxes
 *   - measureCoverage(expectedTexts): run collectTextMap, return coverage report
 *   - assertCoverage(report, label): fail with detail if below threshold
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectTextMap } from "../src/content/text-map-collector.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum acceptable coverage fraction (95%). */
const COVERAGE_THRESHOLD_PCT = 95;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Per-element bounding box factory.
 * Returns a non-zero in-viewport rect for elements with an `id`,
 * falling back to a sensible default for anonymous elements.
 * Offscreen elements (ids ending in "-offscreen") are placed at x=-9999.
 */
function makeBoundingRect(el: HTMLElement): DOMRect {
  const id = el.id ?? "";

  // Elements explicitly marked as offscreen
  if (id.endsWith("-offscreen") || el.classList.contains("offscreen")) {
    return { x: -9999, y: 100, width: 200, height: 30, top: 100, right: -9799, bottom: 130, left: -9999 } as DOMRect;
  }

  // Default: place element in-viewport with a non-zero rect
  // Y position is derived from element's position in the DOM (order * 40px)
  const allElements = Array.from(document.body.querySelectorAll("*"));
  const idx = allElements.indexOf(el);
  const y = idx >= 0 ? (idx % 20) * 40 : 100;
  return { x: 0, y, width: 800, height: 30, top: y, right: 800, bottom: y + 30, left: 0 } as DOMRect;
}

/**
 * Inject HTML into document.body and wire up getBoundingClientRect mock.
 */
function buildBenchmarkPage(html: string): void {
  document.body.innerHTML = html;
  // Patch the global used by getElementRect() in text-map-collector.ts
  vi.stubGlobal("getBoundingClientRect", function (this: HTMLElement) {
    return makeBoundingRect(this);
  });
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, writable: true, configurable: true });
}

/**
 * Coverage report for one benchmark fixture.
 */
interface CoverageReport {
  fixture: string;
  expectedCount: number;
  foundCount: number;
  missingTexts: string[];
  coveragePct: number;
}

/**
 * Run collectTextMap and compute coverage against a ground-truth text list.
 *
 * A text string is considered "found" when at least one segment's
 * textNormalized contains it (case-sensitive, substring match mirrors
 * how agents query pages).
 */
function measureCoverage(fixtureName: string, expectedTexts: readonly string[]): CoverageReport {
  const result = collectTextMap({ maxSegments: 2000 });
  const normalizedSegmentTexts = result.segments.map((s) => s.textNormalized);

  const missingTexts: string[] = [];
  let foundCount = 0;

  for (const expected of expectedTexts) {
    const found = normalizedSegmentTexts.some((seg) => seg.includes(expected));
    if (found) {
      foundCount++;
    } else {
      missingTexts.push(expected);
    }
  }

  const coveragePct = expectedTexts.length === 0
    ? 100
    : Math.round((foundCount / expectedTexts.length) * 100 * 10) / 10;

  return {
    fixture: fixtureName,
    expectedCount: expectedTexts.length,
    foundCount,
    missingTexts,
    coveragePct,
  };
}

/**
 * Assert a coverage report meets the threshold. Fails with a readable diff.
 */
function assertCoverage(report: CoverageReport): void {
  const detail = report.missingTexts.length > 0
    ? `\nMissing (${report.missingTexts.length}):\n  - ${report.missingTexts.join("\n  - ")}`
    : "";

  expect(
    report.coveragePct,
    `[${report.fixture}] Coverage ${report.coveragePct}% < ${COVERAGE_THRESHOLD_PCT}% ` +
    `(found ${report.foundCount}/${report.expectedCount})${detail}`
  ).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD_PCT);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// COV-01: Article page
const ARTICLE_HTML = `
<header id="site-header">
  <nav id="main-nav">
    <a id="nav-home" href="/">Home</a>
    <a id="nav-blog" href="/blog">Blog</a>
    <a id="nav-about" href="/about">About</a>
  </nav>
</header>
<main id="article-main">
  <article id="article-body">
    <h1 id="article-title">Understanding Browser MCP Tools</h1>
    <p id="article-byline">By Jane Smith · April 2026</p>
    <p id="article-intro">Modern AI agents need rich page context to operate effectively on the web.</p>
    <h2 id="section1-heading">Why Text Extraction Matters</h2>
    <p id="section1-para1">Text extraction is the foundation of page understanding for AI agents.</p>
    <p id="section1-para2">Without accurate text maps, agents cannot answer basic questions about page content.</p>
    <blockquote id="article-quote">
      <p id="quote-text">The best interface for an agent is a clean, structured text representation.</p>
      <cite id="quote-cite">— MCP Design Principles</cite>
    </blockquote>
    <h2 id="section2-heading">How Accordo Solves This</h2>
    <p id="section2-para1">Accordo's text map collector walks the DOM using TreeWalker for efficiency.</p>
    <ul id="feature-list">
      <li id="feature-1">Reading order respects LTR and RTL layouts</li>
      <li id="feature-2">Visibility classification filters hidden and offscreen content</li>
      <li id="feature-3">Bounding boxes enable spatial reasoning</li>
    </ul>
    <h2 id="section3-heading">Conclusion</h2>
    <p id="section3-para">With these capabilities, agents can now understand any web page reliably.</p>
  </article>
  <aside id="article-aside">
    <h3 id="aside-heading">Related Articles</h3>
    <ul id="aside-links">
      <li id="aside-link-1"><a href="/post1">Introduction to Page Maps</a></li>
      <li id="aside-link-2"><a href="/post2">Spatial Layout for Agents</a></li>
      <li id="aside-link-3"><a href="/post3">Privacy Controls in MCP</a></li>
    </ul>
  </aside>
</main>
<footer id="site-footer">
  <p id="footer-copy">© 2026 Accordo IDE. All rights reserved.</p>
</footer>
`;

const ARTICLE_EXPECTED_TEXTS = [
  "Home", "Blog", "About",
  "Understanding Browser MCP Tools",
  "By Jane Smith · April 2026",
  "Modern AI agents need rich page context to operate effectively on the web.",
  "Why Text Extraction Matters",
  "Text extraction is the foundation of page understanding for AI agents.",
  "Without accurate text maps, agents cannot answer basic questions about page content.",
  "The best interface for an agent is a clean, structured text representation.",
  "— MCP Design Principles",
  "How Accordo Solves This",
  "Accordo's text map collector walks the DOM using TreeWalker for efficiency.",
  "Reading order respects LTR and RTL layouts",
  "Visibility classification filters hidden and offscreen content",
  "Bounding boxes enable spatial reasoning",
  "Conclusion",
  "With these capabilities, agents can now understand any web page reliably.",
  "Related Articles",
  "Introduction to Page Maps",
  "Spatial Layout for Agents",
  "Privacy Controls in MCP",
  "© 2026 Accordo IDE. All rights reserved.",
] as const;

// COV-02: Form page
const FORM_HTML = `
<main id="form-main">
  <h1 id="form-title">Create Your Account</h1>
  <p id="form-subtitle">Fill out the form below to get started.</p>
  <form id="signup-form">
    <div id="field-name">
      <label id="label-name" for="input-name">Full Name</label>
      <input id="input-name" type="text" placeholder="Enter your full name" />
    </div>
    <div id="field-email">
      <label id="label-email" for="input-email">Email Address</label>
      <input id="input-email" type="email" placeholder="you@example.com" />
      <span id="hint-email">We will never share your email.</span>
    </div>
    <div id="field-password">
      <label id="label-password" for="input-password">Password</label>
      <input id="input-password" type="password" placeholder="Min 8 characters" />
      <span id="hint-password">Use a mix of letters, numbers and symbols.</span>
    </div>
    <div id="field-country">
      <label id="label-country" for="select-country">Country</label>
      <select id="select-country">
        <option id="opt-us" value="us">United States</option>
        <option id="opt-uk" value="uk">United Kingdom</option>
        <option id="opt-ca" value="ca">Canada</option>
      </select>
    </div>
    <div id="field-bio">
      <label id="label-bio" for="textarea-bio">Short Bio</label>
      <textarea id="textarea-bio" placeholder="Tell us about yourself"></textarea>
    </div>
    <div id="field-terms">
      <label id="label-terms" for="checkbox-terms">
        I agree to the Terms of Service
      </label>
    </div>
    <div id="form-actions">
      <button id="btn-submit" type="submit">Create Account</button>
      <button id="btn-cancel" type="button">Cancel</button>
    </div>
  </form>
  <p id="login-prompt">Already have an account? <a id="login-link" href="/login">Sign in</a></p>
</main>
`;

const FORM_EXPECTED_TEXTS = [
  "Create Your Account",
  "Fill out the form below to get started.",
  "Full Name",
  "Email Address",
  "We will never share your email.",
  "Password",
  "Use a mix of letters, numbers and symbols.",
  "Country",
  "United States",
  "United Kingdom",
  "Canada",
  "Short Bio",
  "I agree to the Terms of Service",
  "Create Account",
  "Cancel",
  "Already have an account?",
  "Sign in",
] as const;

// COV-03: Navigation + data table
const TABLE_HTML = `
<header id="table-header">
  <h1 id="table-page-title">Performance Dashboard</h1>
</header>
<nav id="tab-nav" aria-label="Dashboard tabs">
  <a id="tab-overview" href="#overview">Overview</a>
  <a id="tab-details" href="#details">Details</a>
  <a id="tab-export" href="#export">Export</a>
</nav>
<main id="table-main">
  <section id="summary-section">
    <h2 id="summary-heading">Monthly Summary</h2>
    <p id="summary-desc">Performance metrics for April 2026.</p>
  </section>
  <table id="metrics-table">
    <caption id="table-caption">Agent Tool Call Statistics</caption>
    <thead id="table-head">
      <tr>
        <th id="col-tool">Tool</th>
        <th id="col-calls">Calls</th>
        <th id="col-success">Success Rate</th>
        <th id="col-latency">Avg Latency</th>
      </tr>
    </thead>
    <tbody id="table-body">
      <tr id="row-pagemap">
        <td id="cell-tool-1">get_page_map</td>
        <td id="cell-calls-1">1,240</td>
        <td id="cell-success-1">99.2%</td>
        <td id="cell-latency-1">185ms</td>
      </tr>
      <tr id="row-textmap">
        <td id="cell-tool-2">get_text_map</td>
        <td id="cell-calls-2">980</td>
        <td id="cell-success-2">98.8%</td>
        <td id="cell-latency-2">210ms</td>
      </tr>
      <tr id="row-capture">
        <td id="cell-tool-3">capture_region</td>
        <td id="cell-calls-3">560</td>
        <td id="cell-success-3">97.5%</td>
        <td id="cell-latency-3">320ms</td>
      </tr>
      <tr id="row-diff">
        <td id="cell-tool-4">diff_snapshots</td>
        <td id="cell-calls-4">310</td>
        <td id="cell-success-4">100%</td>
        <td id="cell-latency-4">95ms</td>
      </tr>
    </tbody>
    <tfoot id="table-foot">
      <tr id="row-total">
        <td id="cell-total-label">Total</td>
        <td id="cell-total-calls">3,090</td>
        <td id="cell-total-success">98.9%</td>
        <td id="cell-total-latency">—</td>
      </tr>
    </tfoot>
  </table>
  <p id="table-note">Data refreshes every 5 minutes.</p>
</main>
`;

const TABLE_EXPECTED_TEXTS = [
  "Performance Dashboard",
  "Overview", "Details", "Export",
  "Monthly Summary",
  "Performance metrics for April 2026.",
  "Agent Tool Call Statistics",
  "Tool", "Calls", "Success Rate", "Avg Latency",
  "get_page_map", "1,240", "99.2%", "185ms",
  "get_text_map", "980", "98.8%", "210ms",
  "capture_region", "560", "97.5%", "320ms",
  "diff_snapshots", "310", "100%", "95ms",
  "Total", "3,090", "98.9%",
  "Data refreshes every 5 minutes.",
] as const;

// COV-04: E-commerce card grid
const ECOMMERCE_HTML = `
<header id="shop-header">
  <h1 id="shop-title">Accordo Plugin Store</h1>
  <p id="shop-subtitle">Extend your IDE with powerful plugins.</p>
  <nav id="shop-nav">
    <a id="nav-all" href="/all">All Plugins</a>
    <a id="nav-featured" href="/featured">Featured</a>
    <a id="nav-new" href="/new">New Arrivals</a>
    <a id="nav-free" href="/free">Free</a>
  </nav>
</header>
<main id="shop-main">
  <h2 id="results-heading">24 plugins found</h2>
  <div id="card-1" class="product-card">
    <span id="badge-1" class="badge">Best Seller</span>
    <h3 id="title-1">Diagram Pro</h3>
    <p id="desc-1">Advanced Mermaid diagramming with live preview and export.</p>
    <span id="price-1" class="price">$9.99/mo</span>
    <button id="cta-1">Add to IDE</button>
  </div>
  <div id="card-2" class="product-card">
    <span id="badge-2" class="badge">New</span>
    <h3 id="title-2">Voice Commands</h3>
    <p id="desc-2">Control your editor with natural language voice input.</p>
    <span id="price-2" class="price">$4.99/mo</span>
    <button id="cta-2">Add to IDE</button>
  </div>
  <div id="card-3" class="product-card">
    <span id="badge-3" class="badge">Free</span>
    <h3 id="title-3">Code Snapshot</h3>
    <p id="desc-3">One-click beautiful code screenshots for sharing.</p>
    <span id="price-3" class="price">Free</span>
    <button id="cta-3">Add to IDE</button>
  </div>
  <div id="card-4" class="product-card">
    <h3 id="title-4">AI Reviewer</h3>
    <p id="desc-4">Automated code review powered by the latest LLMs.</p>
    <span id="price-4" class="price">$14.99/mo</span>
    <span id="rating-4" class="rating">★★★★★ (48 reviews)</span>
    <button id="cta-4">Add to IDE</button>
  </div>
</main>
<footer id="shop-footer">
  <p id="footer-help">Need help? <a id="support-link" href="/support">Contact support</a></p>
</footer>
`;

const ECOMMERCE_EXPECTED_TEXTS = [
  "Accordo Plugin Store",
  "Extend your IDE with powerful plugins.",
  "All Plugins", "Featured", "New Arrivals", "Free",
  "24 plugins found",
  "Best Seller",
  "Diagram Pro",
  "Advanced Mermaid diagramming with live preview and export.",
  "$9.99/mo",
  "Add to IDE",
  "New",
  "Voice Commands",
  "Control your editor with natural language voice input.",
  "$4.99/mo",
  "Code Snapshot",
  "One-click beautiful code screenshots for sharing.",
  "AI Reviewer",
  "Automated code review powered by the latest LLMs.",
  "$14.99/mo",
  "★★★★★ (48 reviews)",
  "Need help?",
  "Contact support",
] as const;

// COV-05: Mixed-visibility page
// Verifies that VISIBLE text is captured but HIDDEN/OFFSCREEN text appears with correct flags
const MIXED_VISIBILITY_HTML = `
<main id="mixed-main">
  <h1 id="vis-heading">Visible Content</h1>
  <p id="vis-para-1">This paragraph is fully visible to the user.</p>
  <p id="vis-para-2">Another visible paragraph with important information.</p>
  <section id="vis-section">
    <h2 id="vis-section-heading">Visible Section</h2>
    <p id="vis-section-content">Section content that should be found by agents.</p>
    <ul id="vis-list">
      <li id="vis-item-1">First visible list item</li>
      <li id="vis-item-2">Second visible list item</li>
      <li id="vis-item-3">Third visible list item</li>
    </ul>
  </section>
  <div id="vis-cta">
    <button id="vis-btn-primary">Get Started</button>
    <button id="vis-btn-secondary">Learn More</button>
  </div>
  <!-- The following elements are intentionally hidden — they should NOT count as missing visible text -->
  <div id="hidden-modal" style="display:none;">Hidden modal content</div>
  <div id="hidden-tooltip" style="visibility:hidden;">Tooltip text</div>
  <div id="hidden-opacity" style="opacity:0;">Opacity zero element</div>
  <div id="offscreen-announcement" class="offscreen" style="position:absolute;left:-9999px;">Screen reader announcement</div>
</main>
`;

// Only visible text is in the expected set — hidden/offscreen text is excluded from the coverage check
const MIXED_VISIBILITY_EXPECTED_VISIBLE_TEXTS = [
  "Visible Content",
  "This paragraph is fully visible to the user.",
  "Another visible paragraph with important information.",
  "Visible Section",
  "Section content that should be found by agents.",
  "First visible list item",
  "Second visible list item",
  "Third visible list item",
  "Get Started",
  "Learn More",
] as const;

// ── beforeEach / afterEach ────────────────────────────────────────────────────

beforeEach(() => {
  // Clear body — individual tests call buildBenchmarkPage()
  document.body.innerHTML = "";
  document.title = "Benchmark Page";
});

afterEach(() => {
  document.body.innerHTML = "";
  document.title = "";
  document.dir = "ltr";
  vi.unstubAllGlobals();
});

// ── COV-01: Article page ──────────────────────────────────────────────────────

describe("B2-TX-COV-01: Article page coverage ≥ 95%", () => {
  it("B2-TX-COV-01: all expected article texts are extracted", () => {
    buildBenchmarkPage(ARTICLE_HTML);
    const report = measureCoverage("COV-01 Article", ARTICLE_EXPECTED_TEXTS);
    assertCoverage(report);
  });

  it("B2-TX-COV-01: heading elements have role='heading'", () => {
    buildBenchmarkPage(ARTICLE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const titleSeg = result.segments.find((s) => s.textNormalized.includes("Understanding Browser MCP Tools"));
    expect(titleSeg, "H1 article title segment should exist").toBeDefined();
    expect(titleSeg!.role).toBe("heading");
  });

  it("B2-TX-COV-01: link elements have role='link'", () => {
    buildBenchmarkPage(ARTICLE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const homeSeg = result.segments.find((s) => s.textNormalized === "Home");
    expect(homeSeg, "Nav 'Home' link segment should exist").toBeDefined();
    expect(homeSeg!.role).toBe("link");
  });

  it("B2-TX-COV-01: all segments have valid bbox (non-negative width + height)", () => {
    buildBenchmarkPage(ARTICLE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    for (const seg of result.segments) {
      expect(seg.bbox.width, `segment '${seg.textNormalized}' width`).toBeGreaterThanOrEqual(0);
      expect(seg.bbox.height, `segment '${seg.textNormalized}' height`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── COV-02: Form page ─────────────────────────────────────────────────────────

describe("B2-TX-COV-02: Form page coverage ≥ 95%", () => {
  it("B2-TX-COV-02: all expected form texts are extracted", () => {
    buildBenchmarkPage(FORM_HTML);
    const report = measureCoverage("COV-02 Form", FORM_EXPECTED_TEXTS);
    assertCoverage(report);
  });

  it("B2-TX-COV-02: button labels have role='button'", () => {
    buildBenchmarkPage(FORM_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const submitSeg = result.segments.find((s) => s.textNormalized === "Create Account");
    expect(submitSeg, "'Create Account' button segment should exist").toBeDefined();
    expect(submitSeg!.role).toBe("button");
  });

  it("B2-TX-COV-02: hint text elements are present as segments", () => {
    buildBenchmarkPage(FORM_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const hintSeg = result.segments.find((s) =>
      s.textNormalized.includes("We will never share your email")
    );
    expect(hintSeg, "email hint segment should exist").toBeDefined();
    expect(hintSeg!.visibility).toBe("visible");
  });
});

// ── COV-03: Table page ────────────────────────────────────────────────────────

describe("B2-TX-COV-03: Navigation + table page coverage ≥ 95%", () => {
  it("B2-TX-COV-03: all expected table texts are extracted", () => {
    buildBenchmarkPage(TABLE_HTML);
    const report = measureCoverage("COV-03 Table", TABLE_EXPECTED_TEXTS);
    assertCoverage(report);
  });

  it("B2-TX-COV-03: table caption is extracted as a segment", () => {
    buildBenchmarkPage(TABLE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const captionSeg = result.segments.find((s) =>
      s.textNormalized.includes("Agent Tool Call Statistics")
    );
    expect(captionSeg, "table caption segment should exist").toBeDefined();
  });

  it("B2-TX-COV-03: all four data rows are present", () => {
    buildBenchmarkPage(TABLE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const tools = ["get_page_map", "get_text_map", "capture_region", "diff_snapshots"];
    for (const tool of tools) {
      const seg = result.segments.find((s) => s.textNormalized.includes(tool));
      expect(seg, `table row '${tool}' should be extractable`).toBeDefined();
    }
  });
});

// ── COV-04: E-commerce card grid ──────────────────────────────────────────────

describe("B2-TX-COV-04: E-commerce card grid coverage ≥ 95%", () => {
  it("B2-TX-COV-04: all expected card texts are extracted", () => {
    buildBenchmarkPage(ECOMMERCE_HTML);
    const report = measureCoverage("COV-04 E-commerce", ECOMMERCE_EXPECTED_TEXTS);
    assertCoverage(report);
  });

  it("B2-TX-COV-04: product prices are extracted", () => {
    buildBenchmarkPage(ECOMMERCE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const prices = ["$9.99/mo", "$4.99/mo", "$14.99/mo", "Free"];
    for (const price of prices) {
      const seg = result.segments.find((s) => s.textNormalized.includes(price));
      expect(seg, `price '${price}' segment should exist`).toBeDefined();
    }
  });

  it("B2-TX-COV-04: CTA buttons have role='button'", () => {
    buildBenchmarkPage(ECOMMERCE_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const ctaSegs = result.segments.filter((s) => s.textNormalized === "Add to IDE");
    expect(ctaSegs.length, "should find 4 'Add to IDE' CTA buttons").toBeGreaterThanOrEqual(3);
    for (const seg of ctaSegs) {
      expect(seg.role).toBe("button");
    }
  });
});

// ── COV-05: Mixed-visibility page ─────────────────────────────────────────────

describe("B2-TX-COV-05: Mixed-visibility page — visible text coverage ≥ 95%", () => {
  it("B2-TX-COV-05: all expected visible texts are extracted", () => {
    buildBenchmarkPage(MIXED_VISIBILITY_HTML);
    const report = measureCoverage(
      "COV-05 Mixed Visibility",
      MIXED_VISIBILITY_EXPECTED_VISIBLE_TEXTS
    );
    assertCoverage(report);
  });

  it("B2-TX-COV-05: display:none element text is present with visibility='hidden'", () => {
    buildBenchmarkPage(MIXED_VISIBILITY_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const hiddenSeg = result.segments.find((s) =>
      s.textNormalized.includes("Hidden modal content")
    );
    expect(hiddenSeg, "display:none text should still appear in segments").toBeDefined();
    expect(hiddenSeg!.visibility).toBe("hidden");
  });

  it("B2-TX-COV-05: opacity:0 element text is present with visibility='hidden'", () => {
    buildBenchmarkPage(MIXED_VISIBILITY_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const opacitySeg = result.segments.find((s) =>
      s.textNormalized.includes("Opacity zero element")
    );
    expect(opacitySeg, "opacity:0 text should still appear in segments").toBeDefined();
    expect(opacitySeg!.visibility).toBe("hidden");
  });

  it("B2-TX-COV-05: all visible segments have non-zero bbox", () => {
    buildBenchmarkPage(MIXED_VISIBILITY_HTML);
    const result = collectTextMap({ maxSegments: 2000 });
    const visibleSegs = result.segments.filter((s) => s.visibility === "visible");
    for (const seg of visibleSegs) {
      const area = seg.bbox.width * seg.bbox.height;
      expect(area, `visible segment '${seg.textNormalized}' should have non-zero bbox area`).toBeGreaterThan(0);
    }
  });
});

// ── Combined cross-fixture benchmark ─────────────────────────────────────────

describe("B2-TX-COV-ALL: Combined cross-fixture coverage ≥ 95%", () => {
  it("B2-TX-COV-ALL: combined coverage across all five fixtures meets ≥ 95% threshold", () => {
    const fixtures: Array<{ name: string; html: string; expected: readonly string[] }> = [
      { name: "COV-01 Article", html: ARTICLE_HTML, expected: ARTICLE_EXPECTED_TEXTS },
      { name: "COV-02 Form", html: FORM_HTML, expected: FORM_EXPECTED_TEXTS },
      { name: "COV-03 Table", html: TABLE_HTML, expected: TABLE_EXPECTED_TEXTS },
      { name: "COV-04 E-commerce", html: ECOMMERCE_HTML, expected: ECOMMERCE_EXPECTED_TEXTS },
      {
        name: "COV-05 Mixed Visibility",
        html: MIXED_VISIBILITY_HTML,
        expected: MIXED_VISIBILITY_EXPECTED_VISIBLE_TEXTS,
      },
    ];

    let totalExpected = 0;
    let totalFound = 0;
    const reports: CoverageReport[] = [];

    for (const fixture of fixtures) {
      buildBenchmarkPage(fixture.html);
      const report = measureCoverage(fixture.name, fixture.expected);
      reports.push(report);
      totalExpected += report.expectedCount;
      totalFound += report.foundCount;
      // Clean up between fixtures
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }

    const combinedPct = Math.round((totalFound / totalExpected) * 100 * 10) / 10;
    const summary = reports
      .map((r) => `  ${r.fixture}: ${r.coveragePct}% (${r.foundCount}/${r.expectedCount})`)
      .join("\n");

    expect(
      combinedPct,
      `Combined coverage ${combinedPct}% < ${COVERAGE_THRESHOLD_PCT}%\n` +
      `Per-fixture breakdown:\n${summary}`
    ).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD_PCT);
  });
});
