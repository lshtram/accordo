/**
 * relay-push.test.ts — BrowserRelayServer.push() method
 *
 * Verifies:
 * - push() sends a JSON frame to the connected client
 * - push() is a no-op when no client is connected
 * - onRelayRequest does NOT call itself recursively when push is used
 *   (i.e. push() bypasses the interceptor)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRelayServer } from "../relay-server.js";
import { WebSocket } from "ws";

describe("BrowserRelayServer.push()", () => {
  describe("push() with a connected client", () => {
    it("sends a JSON frame containing the action and payload to the WebSocket client", () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40120, token: "tok" });

      const sentMessages: string[] = [];
      const fakeSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn((msg: string) => sentMessages.push(msg)),
      } as unknown as WebSocket;

      // Inject the fake client via internal field
      (server as unknown as { client: WebSocket | null }).client = fakeSocket;

      server.push("notify_comments_updated", { url: "https://example.com" });

      expect(fakeSocket.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sentMessages[0] ?? "{}") as Record<string, unknown>;
      expect(parsed).toHaveProperty("action", "notify_comments_updated");
      expect(parsed).toHaveProperty("payload");
      expect((parsed["payload"] as Record<string, unknown>)["url"]).toBe("https://example.com");
      // A requestId must be present (UUID format)
      expect(typeof parsed["requestId"]).toBe("string");
      expect((parsed["requestId"] as string).length).toBeGreaterThan(0);
    });

    it("sends a JSON frame with empty payload when no url provided", () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40121, token: "tok" });

      const sentMessages: string[] = [];
      const fakeSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn((msg: string) => sentMessages.push(msg)),
      } as unknown as WebSocket;

      (server as unknown as { client: WebSocket | null }).client = fakeSocket;

      server.push("notify_comments_updated", {});

      expect(fakeSocket.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sentMessages[0] ?? "{}") as Record<string, unknown>;
      expect(parsed).toHaveProperty("action", "notify_comments_updated");
      expect(parsed).toHaveProperty("payload");
      expect(parsed["payload"]).toEqual({});
    });
  });

  describe("push() with no connected client", () => {
    it("is a no-op when client is null (not connected)", () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40122, token: "tok" });
      // No client injected — client remains null

      // Must not throw
      expect(() => server.push("notify_comments_updated", { url: "https://x.com" })).not.toThrow();
    });

    it("is a no-op when client readyState is not OPEN", () => {
      const server = new BrowserRelayServer({ host: "127.0.0.1", port: 40123, token: "tok" });

      const sendMock = vi.fn();
      const fakeSocket = {
        readyState: WebSocket.CLOSING, // not OPEN
        send: sendMock,
      } as unknown as WebSocket;

      (server as unknown as { client: WebSocket | null }).client = fakeSocket;

      server.push("notify_comments_updated", { url: "https://x.com" });

      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe("push() bypasses the onRelayRequest interceptor", () => {
    it("does NOT invoke onRelayRequest when push() is called (avoids recursive loop)", () => {
      const onRelayRequestMock = vi.fn();
      const server = new BrowserRelayServer({
        host: "127.0.0.1",
        port: 40124,
        token: "tok",
        onRelayRequest: onRelayRequestMock,
      });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;

      (server as unknown as { client: WebSocket | null }).client = fakeSocket;

      server.push("notify_comments_updated", { url: "https://example.com" });

      // push() must NOT call the interceptor — that would cause infinite recursion
      expect(onRelayRequestMock).not.toHaveBeenCalled();
      // But send() must still be called
      expect(fakeSocket.send).toHaveBeenCalledTimes(1);
    });
  });
});
