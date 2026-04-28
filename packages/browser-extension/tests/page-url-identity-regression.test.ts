/**
 * page-url-identity-regression.test.ts
 *
 * Regression test for page identity — text-map and semantic-graph must preserve
 * the full current document URL including query strings and hash fragments.
 *
 * Issue: pageUrl was truncated to origin + pathname, losing ?q= and #hash parts.
 * Fix: Use document.location?.href ?? "https://localhost/" (matching page-map).
 *
 * Coverage:
 * - path only
 * - query only
 * - hash only
 * - query + hash combined
 *
 * Uses real URL mutation (history.replaceState / hash updates), not mocked location objects.
 * JSDOM restricts replaceState to same-origin URLs, so all test URLs stay on https://localhost/.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectTextMap } from "../src/content/text-map-collector.js";
import { collectSemanticGraph } from "../src/content/semantic-graph-collector.js";

describe("pageUrl identity regression", () => {
  // Capture the original URL so we can restore it after each test.
  let originalUrl: string;

  beforeEach(() => {
    originalUrl = window.location.href;
  });

  afterEach(() => {
    // Restore the original URL to avoid affecting other tests.
    window.history.replaceState(null, "", originalUrl);
  });

  describe("text-map collector", () => {
    it("preserves path only URL", () => {
      const testUrl = "https://localhost/some/deep/path";
      window.history.replaceState(null, "", testUrl);

      const result = collectTextMap();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves query string URL", () => {
      const testUrl = "https://localhost/page?foo=bar&baz=qux";
      window.history.replaceState(null, "", testUrl);

      const result = collectTextMap();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves hash URL", () => {
      const testUrl = "https://localhost/page#section-two";
      window.history.replaceState(null, "", testUrl);

      const result = collectTextMap();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves query + hash URL", () => {
      const testUrl = "https://localhost/page?foo=bar#anchor";
      window.history.replaceState(null, "", testUrl);

      const result = collectTextMap();

      expect(result.pageUrl).toBe(testUrl);
    });
  });

  describe("semantic-graph collector", () => {
    it("preserves path only URL", () => {
      const testUrl = "https://localhost/some/deep/path";
      window.history.replaceState(null, "", testUrl);

      const result = collectSemanticGraph();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves query string URL", () => {
      const testUrl = "https://localhost/page?foo=bar&baz=qux";
      window.history.replaceState(null, "", testUrl);

      const result = collectSemanticGraph();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves hash URL", () => {
      const testUrl = "https://localhost/page#section-two";
      window.history.replaceState(null, "", testUrl);

      const result = collectSemanticGraph();

      expect(result.pageUrl).toBe(testUrl);
    });

    it("preserves query + hash URL", () => {
      const testUrl = "https://localhost/page?foo=bar#anchor";
      window.history.replaceState(null, "", testUrl);

      const result = collectSemanticGraph();

      expect(result.pageUrl).toBe(testUrl);
    });
  });
});