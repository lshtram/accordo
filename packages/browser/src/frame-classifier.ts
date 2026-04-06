/**
 * A4: Iframe frame classification utility.
 *
 * Heuristically classifies an iframe's purpose based on its `src` URL.
 * Used to help agents identify ad/tracker frames, widget embeds, and
 * content frames without accessing the iframe's DOM.
 *
 * @module
 */

// ── Ad / tracker domain patterns ─────────────────────────────────────────────

/**
 * Known ad and tracker domain patterns.
 * Matched against the iframe `src` hostname using substring matching.
 * All patterns are lowercase; matching is case-insensitive.
 */
const AD_PATTERNS: readonly string[] = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "gumgum.com",
  "moatads.com",
  "amazon-adsystem.com",
  "adsystem.amazon.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "adsrvr.org",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "adnxs.com",
  "advertising.com",
  "serving-sys.com",
  "rlcdn.com",
  "bidswitch.net",
  "contextweb.com",
  "liveintent.com",
  "mathtag.com",
  "rtb.gumgum.com",
  "ib.adnxs.com",
  "securepubads.g.doubleclick.net",
];

// ── Widget / social embed patterns ───────────────────────────────────────────

/**
 * Known widget domain/path patterns (social embeds, captchas, payment forms).
 * Matched against the full src URL using substring matching.
 */
const WIDGET_PATTERNS: readonly string[] = [
  "recaptcha",
  "hcaptcha.com",
  "youtube.com/embed",
  "youtu.be/embed",
  "player.vimeo.com",
  "twitter.com/widgets",
  "platform.twitter.com",
  "twitframe.com",
  "connect.facebook.net",
  "facebook.com/plugins",
  "instagram.com/embed",
  "linkedin.com/embed",
  "spotify.com/embed",
  "soundcloud.com/player",
  "maps.google.com",
  "google.com/maps",
  "stripe.com",
  "js.stripe.com",
  "paypal.com",
  "checkout.paypal.com",
  "disqus.com",
  "livechat",
  "intercom.io",
  "zopim.com",
  "tawk.to",
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * A4: Classify an iframe's likely purpose based on its `src` URL.
 *
 * Rules (evaluated in order):
 * 1. Empty or about:blank/srcdoc src → `"content"` (inherited origin, typically content).
 * 2. Known ad/tracker hostname → `"ad"`.
 * 3. Known widget URL pattern → `"widget"`.
 * 4. Same-origin as provided `parentOrigin` → `"content"`.
 * 5. All other cross-origin iframes → `"unknown"`.
 *
 * @param src - The iframe's `src` attribute value (may be empty or relative).
 * @param parentOrigin - Optional: the parent document's `window.location.origin`.
 *   When provided, same-origin iframes default to `"content"`.
 * @returns Classification label.
 */
export function classifyIframe(
  src: string,
  parentOrigin?: string,
): "content" | "ad" | "widget" | "unknown" {
  // Rule 1: inherited-origin or blank src → content
  if (src === "" || src === "about:blank" || src.startsWith("data:")) {
    return "content";
  }

  const srcLower = src.toLowerCase();

  // Rule 2: known ad/tracker patterns
  for (const pattern of AD_PATTERNS) {
    if (srcLower.includes(pattern)) {
      return "ad";
    }
  }

  // Rule 3: known widget patterns
  for (const pattern of WIDGET_PATTERNS) {
    if (srcLower.includes(pattern)) {
      return "widget";
    }
  }

  // Rule 4: same-origin iframe → content
  if (parentOrigin) {
    try {
      const iframeUrl = new URL(src);
      if (iframeUrl.origin === parentOrigin) {
        return "content";
      }
    } catch {
      // malformed URL — fall through to unknown
    }
  }

  // Rule 5: unclassified cross-origin
  return "unknown";
}
