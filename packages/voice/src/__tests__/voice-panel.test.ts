/**
 * M50-VP — VoicePanelProvider tests (Phase B — must FAIL before implementation)
 * Coverage: M50-VP-01 through M50-VP-12
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoicePanelProvider } from "../ui/voice-panel.js";
import type { VoicePanelCallbacks } from "../ui/voice-panel.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

type MessageHandler = (msg: Record<string, unknown>) => void;

function makeWebviewView() {
  let _msgHandler: MessageHandler | null = null;

  const webview = {
    options: {} as Record<string, unknown>,
    html: "",
    postMessage: vi.fn().mockResolvedValue(true),
    onDidReceiveMessage: vi.fn().mockImplementation((handler: MessageHandler) => {
      _msgHandler = handler;
      return { dispose: vi.fn() };
    }),
  };

  return {
    webview,
    onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeVisibility: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    visible: true,
    /** Simulate an incoming UI message */
    _sendMessage: (msg: Record<string, unknown>) => _msgHandler?.(msg),
  };
}

const FAKE_TOKEN = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
};

const FAKE_CONTEXT = {};

describe("VoicePanelProvider", () => {
  it("M50-VP-01: VoicePanelProvider class is exported", () => {
    expect(typeof VoicePanelProvider).toBe("function");
  });

  it("M50-VP-01: VIEW_TYPE static property is 'accordo-voice-panel'", () => {
    expect(VoicePanelProvider.VIEW_TYPE).toBe("accordo-voice-panel");
  });

  describe("resolveWebviewView", () => {
    let provider: VoicePanelProvider;
    let view: ReturnType<typeof makeWebviewView>;

    beforeEach(() => {
      provider = new VoicePanelProvider();
      view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );
    });

    it("M50-VP-02: sets enableScripts:true on webview options", () => {
      expect(view.webview.options).toMatchObject({ enableScripts: true });
    });

    it("M50-VP-02: sets non-empty HTML string on webview", () => {
      expect(typeof view.webview.html).toBe("string");
      expect(view.webview.html.length).toBeGreaterThan(0);
    });

    it("M50-VP-03: HTML contains waveform canvas element", () => {
      expect(view.webview.html).toContain("<canvas");
    });

    it("M50-VP-03: HTML contains mic button", () => {
      expect(view.webview.html.toLowerCase()).toContain("mic");
    });

    it("M50-VP-11: HTML includes nonce in CSP meta tag", () => {
      expect(view.webview.html).toMatch(/nonce-[a-z0-9A-Z]+/);
    });

    it("M50-VP-11: nonce matches script tag nonce attribute", () => {
      const nonceMatch = view.webview.html.match(/nonce-([a-z0-9A-Z]+)/);
      expect(nonceMatch).not.toBeNull();
      if (nonceMatch) {
        expect(view.webview.html).toContain(`nonce="${nonceMatch[1]}"`);
      }
    });
  });

  describe("postMessage", () => {
    let provider: VoicePanelProvider;
    let view: ReturnType<typeof makeWebviewView>;

    beforeEach(() => {
      provider = new VoicePanelProvider();
      view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );
    });

    it("M50-VP-08: postMessage volumeData calls webview.postMessage", () => {
      const volumes = [0.1, 0.5, 0.8];
      provider.postMessage({ type: "volumeData", data: volumes });
      expect(view.webview.postMessage).toHaveBeenCalledWith({ type: "volumeData", data: volumes });
    });

    it("M50-VP-09: postMessage stateChange calls webview.postMessage with states", () => {
      provider.postMessage({ type: "stateChange", session: "active", audio: "idle", narration: "idle" });
      expect(view.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "stateChange", session: "active" }),
      );
    });

    it("M50-VP: postMessage before resolveWebviewView does not throw", () => {
      const unresolved = new VoicePanelProvider();
      expect(() => unresolved.postMessage({ type: "volumeData", data: [] })).not.toThrow();
    });
  });

  describe("incoming webview messages", () => {
    it("M50-VP-10: micDown message triggers onMicDown callback", () => {
      const onMicDown = vi.fn();
      const callbacks: VoicePanelCallbacks = { onMicDown };
      const provider = new VoicePanelProvider(callbacks);
      const view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );

      view._sendMessage({ type: "micDown" });

      expect(onMicDown).toHaveBeenCalled();
    });

    it("M50-VP-10: micUp message triggers onMicUp callback", () => {
      const onMicUp = vi.fn();
      const provider = new VoicePanelProvider({ onMicUp });
      const view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );

      view._sendMessage({ type: "micUp" });

      expect(onMicUp).toHaveBeenCalled();
    });

    it("M50-VP-10: stopNarration message triggers onStopNarration callback", () => {
      const onStopNarration = vi.fn();
      const provider = new VoicePanelProvider({ onStopNarration });
      const view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );

      view._sendMessage({ type: "stopNarration" });

      expect(onStopNarration).toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("M50-VP-12: dispose() does not throw", () => {
      const provider = new VoicePanelProvider();
      expect(() => provider.dispose()).not.toThrow();
    });

    it("M50-VP-12: postMessage after dispose does not throw", () => {
      const provider = new VoicePanelProvider();
      const view = makeWebviewView();
      provider.resolveWebviewView(
        view as unknown as Parameters<typeof provider.resolveWebviewView>[0],
        FAKE_CONTEXT as unknown as Parameters<typeof provider.resolveWebviewView>[1],
        FAKE_TOKEN as unknown as Parameters<typeof provider.resolveWebviewView>[2],
      );
      provider.dispose();
      expect(() => provider.postMessage({ type: "stateChange" })).not.toThrow();
    });
  });
});
