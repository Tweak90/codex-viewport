import { EventEmitter } from "node:events";
import WebSocket from "ws";

export class CodexBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.pending = new Map();
    this.requests = new Map();
    this.subscriptions = new Set();
    this.sequence = 0;
    this.generation = 0;
    this.status = {
      connected: false,
      transport: "websocket",
      error: null,
    };
  }

  publishStatus(change) {
    Object.assign(this.status, change);
    this.emit("status", this.status);
  }

  async connect() {
    if (this.connecting) return this.connecting;
    const connecting = this.open();
    this.connecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = null;
    }
  }

  async open() {
    const generation = ++this.generation;
    let failed = false;
    const disconnected = (error) => {
      if (generation !== this.generation || failed) return;
      failed = true;
      clearInterval(this.heartbeat);
      this.disconnected(error);
    };
    const onMessage = (data) => {
      if (generation !== this.generation || failed) return;
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.method) {
        if (message.id !== undefined)
          this.requests.set(String(message.id), message);
        if (message.method === "serverRequest/resolved")
          this.requests.delete(String(message.params.requestId));
        if (message.method === "turn/completed") {
          for (const [id, request] of this.requests) {
            if (
              request.params.threadId === message.params.threadId &&
              request.params.turnId === message.params.turn.id
            )
              this.requests.delete(id);
          }
        }
        this.emit("message", message);
      } else if (message.id !== undefined) {
        const pending = this.pending.get(String(message.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(String(message.id));
        if (message.error)
          pending.reject(
            Object.assign(new Error(message.error.message), {
              code: message.error.code,
              data: message.error.data,
            }),
          );
        else pending.resolve(message.result);
      }
    };
    try {
      let endpoint;
      try { endpoint = new URL(this.options.url); } catch {}
      if (!endpoint || !["ws:", "wss:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
        throw new Error("Bitte eine Codex-API-Adresse mit ws:// oder wss:// in CODEX_WS_URL oder den Einstellungen angeben.");
      const ws = new WebSocket(endpoint, {
        handshakeTimeout: 10000,
        maxPayload: 32 * 1024 * 1024,
        headers: this.options.token
          ? { Authorization: `Bearer ${this.options.token}` }
          : {},
      });
      this.transport = ws;
      this.send = (message) => ws.send(JSON.stringify(message));
      ws.on("message", onMessage);
      ws.on("close", (code, reason) =>
        disconnected(reason.toString() || "Codex-Verbindung geschlossen"),
      );
      ws.on("error", (error) => disconnected(error.message));
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      let alive = true;
      ws.on("pong", () => {
        alive = true;
      });
      this.heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 20000);
      this.heartbeat.unref();
      const info = await this.raw(
        "initialize",
        {
          clientInfo: {
            name: "codex_viewport",
            title: "Codex Viewport",
            version: "1.1.0",
          },
          capabilities: { experimentalApi: true },
        },
        15000,
      );
      this.send({ method: "initialized", params: {} });
      for (const threadId of this.subscriptions) {
        try {
          await this.raw("thread/resume", { threadId, excludeTurns: true });
        } catch {
          /* Archived/deleted threads may disappear. */
        }
      }
      if (generation === this.generation && !failed)
        this.publishStatus({ connected: true, error: null, info });
    } catch (error) {
      disconnected(error.message);
      if (generation === this.generation) this.transport?.terminate?.();
      throw error;
    }
  }

  disconnected(error) {
    if (this.stopped) return;
    this.publishStatus({ connected: false, error });
    this.requests.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(error));
    }
    this.pending.clear();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(
      () => this.connect().catch(() => {}),
      3000,
    );
  }

  raw(method, params = {}, timeout = 120000) {
    const id = `web-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Zeitlimit: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async call(method, params = {}, timeout) {
    if (this.reconfiguring) throw new Error("Die Codex-Verbindung wird neu konfiguriert. Bitte kurz warten.");
    if (!this.status.connected)
      throw new Error(this.status.error || "Codex ist noch nicht verbunden");
    const result = await this.raw(method, params, timeout);
    if (["thread/start", "thread/resume", "thread/fork"].includes(method))
      this.subscriptions.add(result.thread.id);
    if (method === "thread/archive") this.subscriptions.delete(params.threadId);
    return result;
  }

  answer(id, result) {
    const request = this.requests.get(String(id));
    if (!request) throw new Error("Diese Anfrage ist nicht mehr offen");
    this.send({ id: request.id, result });
    this.requests.delete(String(id));
    this.emit("message", {
      method: "console/requestAnswered",
      params: { requestId: id },
    });
  }

  reconfigure(options) {
    this.close();
    this.connecting = null;
    this.stopped = false;
    this.options = options;
    this.publishStatus({ connected: false, info: null, error: null, transport: "websocket" });
    this.connect().catch(() => {});
  }

  close() {
    this.stopped = true;
    ++this.generation;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Beendet"));
    }
    this.pending.clear();
    this.transport?.close?.();
  }
}
