import { EventEmitter } from "events";
import WebSocket from "ws";
import {
  Point,
  RealtimeClientOptions,
  WsAckMessage,
  WsEventMessage,
  WsErrorMessage,
} from "./types";
import { VectorDBError } from "./errors";

/**
 * WebSocket client for real-time streaming with FerresDB.
 *
 * Supports real-time point ingestion, collection event subscriptions,
 * and application-level heartbeat.
 *
 * @example
 * ```ts
 * const rt = new RealtimeClient({ baseUrl: "http://localhost:8080", apiKey: "sk-xxx" });
 * await rt.connect();
 *
 * // Upsert points in real-time
 * const ack = await rt.upsert("my_collection", [{ id: "1", vector: [0.1, 0.2], metadata: {} }]);
 *
 * // Subscribe to events
 * rt.on("event", (evt) => console.log(`Event: ${evt.action} on ${evt.collection}`));
 * await rt.subscribe("my_collection", ["upsert", "delete"]);
 *
 * // Close when done
 * await rt.close();
 * ```
 */
export class RealtimeClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingAck: {
    resolve: (ack: WsAckMessage) => void;
    reject: (err: Error) => void;
  } | null = null;
  private pendingPong: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(options: RealtimeClientOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Establish the WebSocket connection.
   */
  async connect(): Promise<void> {
    const url = this.buildWsUrl();

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        maxPayload: 10 * 1024 * 1024, // 10 MB, matches server limit
      });

      this.ws.on("open", () => {
        this.connected = true;
        resolve();
      });

      this.ws.on("error", (err) => {
        if (!this.connected) {
          reject(new Error(`Failed to connect to WebSocket: ${err.message}`));
        }
        this.emit("error", {
          message: err.message,
          code: 0,
        } as WsErrorMessage);
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.emit("close");
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleMessage(data);
      });
    });
  }

  /**
   * Close the WebSocket connection gracefully.
   */
  async close(): Promise<void> {
    if (this.ws) {
      this.connected = false;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Whether the client is currently connected.
   */
  get isConnected(): boolean {
    return this.connected;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Send an upsert message and wait for the server acknowledgement.
   *
   * @param collection - Target collection name
   * @param points - List of points to upsert
   * @returns Acknowledgement with upserted/failed counts and timing
   */
  async upsert(collection: string, points: Point[]): Promise<WsAckMessage> {
    this.ensureConnected();
    const msg = {
      type: "upsert",
      collection,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        metadata: p.metadata,
      })),
    };
    return this.sendAndWaitAck(msg);
  }

  /**
   * Subscribe to real-time events for a collection.
   *
   * After subscribing, `"event"` events will be emitted whenever the
   * collection is modified (via REST or WebSocket).
   *
   * @param collection - Collection to subscribe to
   * @param events - Optional event filter: `["upsert"]`, `["delete"]`, or both
   * @returns Acknowledgement confirming the subscription
   */
  async subscribe(
    collection: string,
    events?: string[],
  ): Promise<WsAckMessage> {
    this.ensureConnected();
    const msg: Record<string, unknown> = {
      type: "subscribe",
      collection,
    };
    if (events && events.length > 0) {
      msg.events = events;
    }
    return this.sendAndWaitAck(msg);
  }

  /**
   * Send an application-level ping and wait for the pong response.
   */
  async ping(): Promise<void> {
    this.ensureConnected();
    return new Promise<void>((resolve, reject) => {
      this.pendingPong = { resolve, reject };
      this.ws!.send(JSON.stringify({ type: "ping" }));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingPong) {
          this.pendingPong.reject(
            new Error("Pong not received within 10 seconds"),
          );
          this.pendingPong = null;
        }
      }, 10000);
    });
  }

  // ── Typed event overloads ──────────────────────────────────────────────

  on(event: "event", listener: (msg: WsEventMessage) => void): this;
  on(event: "error", listener: (msg: WsErrorMessage) => void): this;
  on(event: "close", listener: () => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private buildWsUrl(): string {
    const parsed = new URL(this.baseUrl);
    const scheme = parsed.protocol === "https:" ? "wss:" : "ws:";
    let url = `${scheme}//${parsed.host}/api/v1/ws`;
    if (this.apiKey) {
      url += `?token=${encodeURIComponent(this.apiKey)}`;
    }
    return url;
  }

  private ensureConnected(): void {
    if (!this.connected || !this.ws) {
      throw new Error(
        "RealtimeClient is not connected. Call connect() first.",
      );
    }
  }

  private sendAndWaitAck(msg: Record<string, unknown>): Promise<WsAckMessage> {
    return new Promise<WsAckMessage>((resolve, reject) => {
      this.pendingAck = { resolve, reject };
      this.ws!.send(JSON.stringify(msg));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingAck) {
          this.pendingAck.reject(
            new Error("Server did not acknowledge within 30 seconds"),
          );
          this.pendingAck = null;
        }
      }, 30000);
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }

    const msgType = parsed.type as string;

    switch (msgType) {
      case "ack": {
        const ack: WsAckMessage = {
          upserted: parsed.upserted as number,
          failed: parsed.failed as number,
          took_ms: parsed.took_ms as number,
        };
        if (this.pendingAck) {
          this.pendingAck.resolve(ack);
          this.pendingAck = null;
        }
        break;
      }

      case "pong": {
        if (this.pendingPong) {
          this.pendingPong.resolve();
          this.pendingPong = null;
        }
        break;
      }

      case "event": {
        const event: WsEventMessage = {
          collection: parsed.collection as string,
          action: parsed.action as string,
          point_ids: parsed.point_ids as string[],
          timestamp: parsed.timestamp as number,
        };
        this.emit("event", event);
        break;
      }

      case "error": {
        const error: WsErrorMessage = {
          message: parsed.message as string,
          code: parsed.code as number,
        };
        // If we're waiting for an ack, reject it with the error
        if (this.pendingAck) {
          this.pendingAck.reject(
            new VectorDBError(error.message, error.code),
          );
          this.pendingAck = null;
        }
        this.emit("error", error);
        break;
      }

      case "ping": {
        // Server-initiated ping → respond with pong
        if (this.ws && this.connected) {
          this.ws.send(JSON.stringify({ type: "pong" }));
        }
        break;
      }
    }
  }
}
