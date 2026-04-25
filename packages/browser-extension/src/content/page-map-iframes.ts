import type { IframeMetadata } from "./page-map-types.js";

const AD_PATTERNS: readonly RegExp[] = [
  /doubleclick\.net/i, /googlesyndication\.com/i, /adservice\.google\./i,
  /amazon-adsystem\.com/i, /media\.net/i, /adnxs\.com/i, /rubiconproject\.com/i,
  /openx\.net/i, /pubmatic\.com/i, /criteo\.com/i, /taboola\.com/i,
  /outbrain\.com/i, /revcontent\.com/i, /sharethrough\.com/i,
  /smartadserver\.com/i, /33across\.com/i, /advertising\.com/i,
  /adroll\.com/i, /moatads\.com/i, /scorecardresearch\.com/i,
  /quantserve\.com/i, /chartbeat\.com/i, /adsafeprotected\.com/i,
  /ib\.adnxs\.com/i,
];

const WIDGET_PATTERNS: readonly RegExp[] = [
  /facebook\.com\/plugins/i, /platform\.twitter\.com/i, /syndication\.twitter\.com/i,
  /instagram\.com\/embed/i, /youtube\.com\/embed/i, /youtu\.be\//i,
  /player\.vimeo\.com/i, /open\.spotify\.com\/embed/i, /soundcloud\.com\/player/i,
  /google\.com\/recaptcha/i, /recaptcha\.net/i,
  /paypal\.com\/(sdk|button|webapps)/i, /js\.stripe\.com/i,
  /appleid\.apple\.com/i, /accounts\.google\.com/i,
  /disqus\.com\/embed/i, /staticxx\.facebook\.com/i,
  /platform\.linkedin\.com/i, /assets\.pinterest\.com/i,
  /tiktok\.com\/embed/i, /twitch\.tv\/embed/i,
  /maps\.google\.com/i, /google\.com\/maps/i, /maps\.googleapis\.com/i,
  /calendar\.google\.com/i, /docs\.google\.com/i,
];

function classifyIframeInline(
  src: string,
  sameOrigin: boolean,
): "content" | "ad" | "widget" | "unknown" {
  if (src === "" || src === "about:blank" || src.startsWith("data:") || src.startsWith("javascript:")) {
    return "content";
  }
  for (const pattern of AD_PATTERNS) {
    if (pattern.test(src)) return "ad";
  }
  for (const pattern of WIDGET_PATTERNS) {
    if (pattern.test(src)) return "widget";
  }
  if (sameOrigin) return "content";
  return "unknown";
}

function toLocalIframeKey(iframe: HTMLIFrameElement, index: number): string {
  if (iframe.name && iframe.name.trim() !== "") return iframe.name;
  if (iframe.id && iframe.id.trim() !== "") return iframe.id;
  return `iframe-${index}`;
}

export function enumerateIframes(parentLogicalFrameId: string = "main"): IframeMetadata[] {
  try {
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    return iframes.map((iframe, index) => {
      const localFrameId = toLocalIframeKey(iframe, index);
      const frameId = parentLogicalFrameId === "main" ? localFrameId : `${parentLogicalFrameId}/${localFrameId}`;
      const src = iframe.src ?? "";

      let sameOrigin = false;
      try {
        const inheritedOriginFrame = src === "" || src === "about:blank" || iframe.hasAttribute("srcdoc");
        const domAccessible = (() : boolean => {
          try {
            return iframe.contentDocument !== null;
          } catch {
            return false;
          }
        })();

        if (inheritedOriginFrame) {
          sameOrigin = domAccessible;
        } else {
          const iframeUrl = new URL(src, document.baseURI);
          sameOrigin = iframeUrl.origin === window.location.origin && domAccessible;
        }
      } catch {
        sameOrigin = false;
      }

      let bounds = { x: 0, y: 0, width: 0, height: 0 };
      let visible = false;
      try {
        const rect = iframe.getBoundingClientRect();
        bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const style = window.getComputedStyle(iframe);
        const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        visible = style.display !== "none" && style.visibility !== "hidden" && inViewport;
      } catch {
        visible = false;
      }

      return {
        frameId,
        src,
        bounds,
        sameOrigin,
        parentFrameId: null,
        title: iframe.title !== "" ? iframe.title : undefined,
        depth: 1,
        classification: classifyIframeInline(src, sameOrigin),
        visible,
      };
    });
  } catch {
    return [];
  }
}
