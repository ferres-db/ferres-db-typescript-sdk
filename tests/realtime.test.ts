import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealtimeClient } from "../src/realtime";
import type { WsEventMessage, WsErrorMessage } from "../src/types";

// Mock the 'ws' module – import EventEmitter inside the factory because
// vi.mock is hoisted above all imports, so top-level bindings are unavailable.
vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();

    constructor(_url: string, _options?: unknown) {
      super();
      // Simulate successful connection after next tick
      setTimeout(() => this.emit("open"), 0);
    }
  }

  return { default: MockWebSocket };
});

describe("RealtimeClient", () => {
  let client: RealtimeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RealtimeClient({
      baseUrl: "http://localhost:8080",
      apiKey: "sk-test",
    });
  });

  describe("constructor", () => {
    it("should build correct ws URL with token", async () => {
      // Access the private method via any cast
      const url = (client as any).buildWsUrl();
      expect(url).toBe("ws://localhost:8080/api/v1/ws?token=sk-test");
    });

    it("should use wss for https base URL", () => {
      const httpsClient = new RealtimeClient({
        baseUrl: "https://my-server.com",
        apiKey: "sk-key",
      });
      const url = (httpsClient as any).buildWsUrl();
      expect(url.startsWith("wss://")).toBe(true);
      expect(url).toContain("token=sk-key");
    });

    it("should build URL without token when no apiKey", () => {
      const noKeyClient = new RealtimeClient({
        baseUrl: "http://localhost:8080",
      });
      const url = (noKeyClient as any).buildWsUrl();
      expect(url).toBe("ws://localhost:8080/api/v1/ws");
    });
  });

  describe("connect", () => {
    it("should connect successfully", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);
    });
  });

  describe("upsert", () => {
    it("should send upsert message and resolve on ack", async () => {
      await client.connect();

      const ws = (client as any).ws;

      // Intercept send to capture message
      const sendSpy = ws.send as ReturnType<typeof vi.fn>;
      sendSpy.mockImplementation((data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.type === "upsert") {
          // Simulate server ack
          setTimeout(() => {
            ws.emit(
              "message",
              JSON.stringify({
                type: "ack",
                upserted: 2,
                failed: 0,
                took_ms: 5,
              }),
            );
          }, 0);
        }
      });

      const ack = await client.upsert("my-col", [
        { id: "p1", vector: [0.1, 0.2], metadata: {} },
        { id: "p2", vector: [0.3, 0.4], metadata: {} },
      ]);

      expect(ack.upserted).toBe(2);
      expect(ack.failed).toBe(0);
      expect(ack.took_ms).toBe(5);

      // Verify the sent message
      const sentMessage = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sentMessage.type).toBe("upsert");
      expect(sentMessage.collection).toBe("my-col");
      expect(sentMessage.points).toHaveLength(2);
    });
  });

  describe("subscribe", () => {
    it("should send subscribe message with events filter", async () => {
      await client.connect();

      const ws = (client as any).ws;
      const sendSpy = ws.send as ReturnType<typeof vi.fn>;
      sendSpy.mockImplementation((data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.type === "subscribe") {
          setTimeout(() => {
            ws.emit(
              "message",
              JSON.stringify({
                type: "ack",
                upserted: 0,
                failed: 0,
                took_ms: 0,
              }),
            );
          }, 0);
        }
      });

      const ack = await client.subscribe("docs", ["upsert", "delete"]);

      expect(ack.upserted).toBe(0);
      const sentMessage = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sentMessage.type).toBe("subscribe");
      expect(sentMessage.collection).toBe("docs");
      expect(sentMessage.events).toEqual(["upsert", "delete"]);
    });

    it("should omit events when not provided", async () => {
      await client.connect();

      const ws = (client as any).ws;
      const sendSpy = ws.send as ReturnType<typeof vi.fn>;
      sendSpy.mockImplementation(() => {
        setTimeout(() => {
          ws.emit(
            "message",
            JSON.stringify({
              type: "ack",
              upserted: 0,
              failed: 0,
              took_ms: 0,
            }),
          );
        }, 0);
      });

      await client.subscribe("docs");

      const sentMessage = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sentMessage).not.toHaveProperty("events");
    });
  });

  describe("event dispatch", () => {
    it("should emit event messages to listeners", async () => {
      await client.connect();

      const events: WsEventMessage[] = [];
      client.on("event", (evt) => events.push(evt));

      const ws = (client as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          type: "event",
          collection: "docs",
          action: "upsert",
          point_ids: ["p1", "p2"],
          timestamp: 1700000000,
        }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].collection).toBe("docs");
      expect(events[0].action).toBe("upsert");
      expect(events[0].point_ids).toEqual(["p1", "p2"]);
    });

    it("should emit error messages to listeners", async () => {
      await client.connect();

      const errors: WsErrorMessage[] = [];
      client.on("error", (err) => errors.push(err));

      const ws = (client as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          type: "error",
          message: "collection not found",
          code: 404,
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("collection not found");
      expect(errors[0].code).toBe(404);
    });
  });

  describe("ping/pong", () => {
    it("should resolve ping on pong receipt", async () => {
      await client.connect();

      const ws = (client as any).ws;
      const sendSpy = ws.send as ReturnType<typeof vi.fn>;
      sendSpy.mockImplementation((data: string) => {
        const parsed = JSON.parse(data);
        if (parsed.type === "ping") {
          setTimeout(() => {
            ws.emit("message", JSON.stringify({ type: "pong" }));
          }, 0);
        }
      });

      await client.ping();

      const sentMessage = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sentMessage.type).toBe("ping");
    });

    it("should respond to server-initiated ping with pong", async () => {
      await client.connect();

      const ws = (client as any).ws;
      ws.emit("message", JSON.stringify({ type: "ping" }));

      const sendSpy = ws.send as ReturnType<typeof vi.fn>;
      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
    });
  });

  describe("close", () => {
    it("should emit close event when connection closes", async () => {
      await client.connect();

      let closed = false;
      client.on("close", () => {
        closed = true;
      });

      const ws = (client as any).ws;
      ws.emit("close");

      expect(closed).toBe(true);
      expect(client.isConnected).toBe(false);
    });
  });

  describe("ensureConnected", () => {
    it("should throw when not connected", () => {
      expect(() => (client as any).ensureConnected()).toThrow("not connected");
    });
  });
});
