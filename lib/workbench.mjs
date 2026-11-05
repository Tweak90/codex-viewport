import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicJson, httpError } from "./auth.mjs";

export class WorkbenchStore {
  static async load(directory) {
    const store = new WorkbenchStore(directory);
    try {
      Object.assign(
        store.data,
        JSON.parse(await readFile(store.filename, "utf8")),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return store;
  }
  constructor(directory) {
    this.filename = path.join(directory, "workbench.json");
    this.data = {
      pins: [],
      preferences: { notifications: false, sound: false },
      composers: {},
      contexts: {},
      tasks: {},
    };
    this.queue = Promise.resolve();
  }
  save() {
    this.queue = this.queue
      .catch(() => {})
      .then(() => atomicJson(this.filename, this.data));
    return this.queue;
  }
  snapshot() {
    return { pins: this.data.pins, preferences: this.data.preferences };
  }
  async preferences(input) {
    if (input.pins) {
      if (
        !Array.isArray(input.pins) ||
        input.pins.length > 500 ||
        input.pins.some((id) => typeof id !== "string" || id.length > 200)
      )
        throw httpError(400, "Ungültige angepinnte Chats.");
      this.data.pins = [...new Set(input.pins)];
    }
    if (input.preferences)
      for (const key of ["notifications", "sound"])
        if (typeof input.preferences[key] === "boolean")
          this.data.preferences[key] = input.preferences[key];
    await this.save();
    return this.snapshot();
  }
  composer(id) {
    return this.data.composers[id] || { text: "", attachments: [] };
  }
  async setComposer(id, input) {
    if (
      typeof input.text !== "string" ||
      input.text.length > 1024 * 1024 ||
      !Array.isArray(input.attachments) ||
      input.attachments.length > 20
    )
      throw httpError(400, "Der Nachrichtenentwurf ist zu groß.");
    const attachments = input.attachments.map((file) => {
      if (
        !file ||
        typeof file.path !== "string" ||
        !path.posix.isAbsolute(file.path) ||
        typeof file.name !== "string"
      )
        throw httpError(400, "Ungültiger Anhang.");
      return {
        path: file.path,
        name: file.name.slice(0, 255),
        size: Number(file.size) || 0,
        image: Boolean(file.image),
      };
    });
    if (!input.text && !attachments.length) delete this.data.composers[id];
    else
      this.data.composers[id] = {
        text: input.text,
        attachments,
        updatedAt: Date.now(),
      };
    await this.save();
    return this.composer(id);
  }
  async moveComposer(from, to) {
    if (this.data.composers[from]) {
      this.data.composers[to] = this.data.composers[from];
      delete this.data.composers[from];
    }
    if (this.data.pins.includes(from))
      this.data.pins = this.data.pins.map((id) => (id === from ? to : id));
    await this.save();
  }
  async removeChat(id) {
    delete this.data.composers[id];
    delete this.data.contexts[id];
    delete this.data.tasks[id];
    this.data.pins = this.data.pins.filter((value) => value !== id);
    await this.save();
  }
  record(message) {
    const { method, params: p = {} } = message;
    if (!p.threadId) return;
    if (method === "thread/tokenUsage/updated")
      this.data.contexts[p.threadId] = {
        ...this.data.contexts[p.threadId],
        ...p.tokenUsage,
        observedAt: Date.now(),
        compactions: this.data.contexts[p.threadId]?.compactions || 0,
      };
    else if (
      method === "item/completed" &&
      p.item?.type === "contextCompaction"
    ) {
      const current = (this.data.contexts[p.threadId] ||= {});
      current.compactions = (current.compactions || 0) + 1;
      current.lastCompactedAt = Date.now();
    } else if (method === "turn/started" || method === "turn/completed") {
      const old = this.data.tasks[p.threadId] || {};
      this.data.tasks[p.threadId] = {
        ...old,
        threadId: p.threadId,
        turnId: p.turn.id,
        status: p.turn.status,
        startedAt: p.turn.startedAt
          ? p.turn.startedAt * 1000
          : old.turnId === p.turn.id
            ? old.startedAt
            : Date.now(),
        updatedAt: Date.now(),
        error: p.turn.error?.message || null,
      };
      const tasks = Object.entries(this.data.tasks)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 200);
      this.data.tasks = Object.fromEntries(tasks);
    } else return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch(() => {}), 200);
    this.saveTimer.unref();
  }
  async close() {
    clearTimeout(this.saveTimer);
    await this.save();
  }
}

export class TaskMonitor {
  constructor(projects, store) {
    this.projects = projects;
    this.store = store;
  }
  async read() {
    if (this.pending) return this.pending;
    if (this.cached && Date.now() - this.cached.at < 2000)
      return this.cached.value;
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async refresh() {
    const threads = await this.projects.allThreads(false);
    const active = (thread) =>
      thread.status?.type === "active" ||
      this.store.data.tasks[thread.id]?.status === "inProgress";
    const chosen = [
      ...threads.filter(active),
      ...threads
        .filter((thread) => !active(thread))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30),
    ];
    const tasks = [];
    for (const thread of chosen) {
      const stored = this.store.data.tasks[thread.id];
      let turn;
      try {
        turn = (
          await this.projects.bridge.call("thread/turns/list", {
            threadId: thread.id,
            limit: 1,
            itemsView: "notLoaded",
            sortDirection: "desc",
          })
        ).data[0];
      } catch {}
      if (!turn && !stored && thread.status?.type !== "active") continue;
      const waiting =
        [...this.projects.bridge.requests.values()].some(
          (request) => request.params?.threadId === thread.id,
        ) ||
        /wait|approval|input/i.test(
          JSON.stringify(thread.status?.activeFlags || []),
        );
      const projectId =
        this.projects.data.threadProjects[thread.id] ||
        this.projects.data.projects.find((p) => p.path === thread.cwd)?.id;
      const project = this.projects.data.projects.find(
        (p) => p.id === projectId,
      );
      const status = waiting
        ? "waiting"
        : thread.status?.type === "active" || turn?.status === "inProgress"
          ? "working"
          : turn?.status || stored?.status || "idle";
      tasks.push({
        threadId: thread.id,
        name: thread.name || thread.preview?.slice(0, 90) || "Chat",
        projectId,
        projectName: project?.name || path.posix.basename(thread.cwd || ""),
        status,
        turnId: turn?.id || stored?.turnId,
        startedAt: turn?.startedAt
          ? turn.startedAt * 1000
          : stored?.startedAt || null,
        updatedAt: turn?.completedAt
          ? turn.completedAt * 1000
          : stored?.updatedAt || thread.updatedAt * 1000,
        error: turn?.error?.message || stored?.error,
      });
    }
    const value = { tasks, observedAt: Date.now() };
    this.cached = { at: Date.now(), value };
    return value;
  }
}
