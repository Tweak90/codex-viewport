import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson } from "./auth.mjs";

// Native queue entries survive browser disconnects. Only entries added by this
// client are started here; other clients retain control of their own queue entries.
export class MessageQueue {
  static async load(directory, bridge) {
    const queue = new MessageQueue(directory, bridge);
    try { queue.data = JSON.parse(await readFile(queue.filename, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return queue;
  }
  constructor(directory, bridge) {
    this.filename = path.join(directory, "message-queue.json");
    this.bridge = bridge;
    this.data = { entries: {}, paused: {} };
    this.writes = Promise.resolve();
    this.running = new Map();
  }
  save() {
    const snapshot = JSON.stringify(this.data);
    const operation = this.writes.catch(() => {}).then(() => atomicJson(this.filename, JSON.parse(snapshot)));
    this.writes = operation;
    return operation;
  }
  async add(params) {
    const result = await this.bridge.call("thread/queue/add", params);
    this.data.entries[result.queuedSubmission.id] = { threadId: params.threadId, state: "pending" };
    await this.save();
    this.pump(params.threadId).catch(() => {});
    return result;
  }
  observe(message) {
    const { method, params = {} } = message;
    if (!Object.values(this.data.entries).some((entry) => entry.threadId === params.threadId)) return;
    if (method === "turn/completed" && ["failed", "interrupted"].includes(params.turn?.status)) {
      this.data.paused[params.threadId] = true;
      this.save().catch(() => {});
      return;
    }
    if (method === "turn/started") {
      delete this.data.paused[params.threadId];
      this.save().catch(() => {});
    }
    if (method === "turn/completed" || method === "thread/queue/changed" || (method === "thread/status/changed" && params.status?.type === "idle"))
      this.pump(params.threadId).catch(() => {});
  }
  reconnect() {
    for (const thread of new Set(Object.values(this.data.entries).filter((entry) => entry.state === "pending").map((entry) => entry.threadId)))
      this.pump(thread).catch(() => {});
  }
  pump(threadId) {
    if (!threadId || this.data.paused[threadId] || !Object.values(this.data.entries).some((entry) => entry.threadId === threadId && entry.state === "pending")) return Promise.resolve();
    if (this.running.has(threadId)) return this.running.get(threadId);
    const operation = this.advance(threadId).finally(() => this.running.delete(threadId));
    this.running.set(threadId, operation);
    return operation;
  }
  async advance(threadId) {
    const { thread } = await this.bridge.call("thread/read", { threadId, includeTurns: false });
    if (thread.status?.type === "active" || this.data.paused[threadId]) return;
    const queue = await this.bridge.call("thread/queue/list", { threadId, limit: 1 });
    const first = queue.data[0];
    if (!first || this.data.entries[first.id]?.state !== "pending") return;
    this.data.entries[first.id].state = "starting";
    await this.save();
    try {
      await this.bridge.call("thread/queue/start", { threadId, queuedSubmissionId: first.id });
      this.data.entries[first.id].state = "started";
    } catch {
      this.data.entries[first.id].state = "uncertain";
      // The start may already have succeeded. Never replay it after a failure.
    }
    await this.save();
  }
  async close() {
    await Promise.allSettled([...this.running.values()]);
    await this.writes;
  }
}
