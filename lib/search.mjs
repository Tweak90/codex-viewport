import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicJson } from "./auth.mjs";
import { readHistory } from "./history.mjs";

export function itemText(item) {
  if (item.type === "userMessage")
    return (item.content || []).map((c) => c.text || c.path || "").join("\n");
  if (item.type === "agentMessage" || item.type === "plan")
    return item.text || "";
  if (item.type === "commandExecution")
    return [item.command, item.aggregatedOutput].filter(Boolean).join("\n");
  if (item.type === "fileChange")
    return (item.changes || [])
      .map((c) => `${c.path}\n${c.diff || ""}`)
      .join("\n");
  if (item.type === "imageGeneration")
    return item.revisedPrompt || item.savedPath || "";
  if (item.type === "imageView") return item.path || "";
  if (item.type === "reasoning")
    return (item.summary || [])
      .map((v) => (typeof v === "string" ? v : v.text || ""))
      .join("\n");
  const strings = [];
  const walk = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      if (
        !value.startsWith("data:") &&
        !(value.length > 4096 && /^[A-Za-z0-9+/=]+$/.test(value))
      )
        strings.push(value);
    } else if (Array.isArray(value))
      value.forEach((child) => walk(child, depth + 1));
    else if (typeof value === "object" && value.type !== "image")
      for (const [key, child] of Object.entries(value))
        if (!["data", "dataBase64", "encryptedContent", "id"].includes(key))
          walk(child, depth + 1);
  };
  walk(item);
  return strings.join("\n");
}
export class SearchIndex {
  static async load(directory, projects) {
    const index = new SearchIndex(directory, projects);
    try {
      index.threads =
        JSON.parse(await readFile(index.filename, "utf8")).threads || {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return index;
  }
  constructor(directory, projects) {
    this.filename = path.join(directory, "search-index.json");
    this.projects = projects;
    this.threads = {};
    this.progress = { running: false, done: 0, total: 0, errors: 0 };
    this.lastRun = 0;
    this.closed = false;
  }
  start(force = false) {
    if (!this.job && (force || Date.now() - this.lastRun > 30000)) {
      this.progress = { running: true, done: 0, total: 0, errors: 0 };
      this.job = this.refresh()
        .catch(() => {
          this.progress.errors++;
        })
        .finally(() => {
          this.progress.running = false;
          this.lastRun = Date.now();
          this.job = null;
        });
    }
  }
  async refresh() {
    const all = [
      ...(await this.projects.allThreads(false)).map((t) => ({
        ...t,
        archived: false,
      })),
      ...(await this.projects.allThreads(true)).map((t) => ({
        ...t,
        archived: true,
      })),
    ];
    const unique = [
      ...new Map(all.map((thread) => [thread.id, thread])).values(),
    ];
    this.progress.total = unique.length;
    const found = new Set();
    for (const thread of unique) {
      if (this.closed) return;
      found.add(thread.id);
      const previous = this.threads[thread.id];
      const meta = {
        name: thread.name || thread.preview?.slice(0, 90) || "Chat",
        cwd: thread.cwd,
        archived: Boolean(thread.archived),
        updatedAt: thread.updatedAt,
      };
      if (
        previous?.updatedAt === thread.updatedAt &&
        previous.complete &&
        thread.status?.type !== "active"
      ) {
        Object.assign(previous, meta);
        this.progress.done++;
        continue;
      }
      try {
        let cursor = null;
        const rows = [],
          seen = new Set();
        do {
          if (this.closed) return;
          const pageCursor = cursor;
          const page = await readHistory(
            this.projects.bridge,
            thread.id,
            cursor,
          );
          for (const turn of page.data)
            for (const item of turn.items || []) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              const text = itemText(item);
              if (text)
                rows.push({
                  itemId: item.id,
                  turnId: turn.id,
                  type: item.type,
                  text,
                  cursor: pageCursor,
                });
            }
          cursor = page.nextCursor;
          // Yield between pages so interactive history requests stay responsive.
          await new Promise((resolve) => setTimeout(resolve, 5));
        } while (cursor);
        this.threads[thread.id] = { ...meta, rows, complete: true };
      } catch {
        this.progress.errors++;
      }
      this.progress.done++;
    }
    for (const id of Object.keys(this.threads))
      if (!found.has(id)) delete this.threads[id];
    if (!this.closed)
      await atomicJson(this.filename, { version: 1, threads: this.threads });
  }
  query(q, { projectId, archived = true } = {}) {
    const terms = String(q || "")
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 20);
    const matches = [];
    if (terms.length)
      for (const [threadId, thread] of Object.entries(this.threads)) {
        const owner =
          this.projects.data.threadProjects[threadId] ||
          this.projects.data.projects.find((p) => p.path === thread.cwd)?.id;
        if (
          (projectId && owner !== projectId) ||
          (!archived && thread.archived)
        )
          continue;
        const project = this.projects.data.projects.find((p) => p.id === owner);
        for (const row of thread.rows || []) {
          const haystack = `${thread.name}\n${row.text}`.toLocaleLowerCase();
          if (!terms.every((term) => haystack.includes(term))) continue;
          const pos = Math.max(
            0,
            row.text.toLocaleLowerCase().indexOf(terms[0]),
          );
          matches.push({
            ...row,
            text: undefined,
            threadId,
            threadName: thread.name,
            projectId: owner,
            projectName: project?.name || path.posix.basename(thread.cwd || ""),
            archived: thread.archived,
            updatedAt: thread.updatedAt,
            snippet: row.text.slice(Math.max(0, pos - 80), pos + 240),
          });
        }
      }
    matches.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      results: matches.slice(0, 100),
      total: matches.length,
      progress: { ...this.progress },
      indexedThreads: Object.keys(this.threads).length,
    };
  }
  remove(id) {
    delete this.threads[id];
    this.lastRun = 0;
  }
  async close() {
    this.closed = true;
    if (this.job) await this.job;
  }
}

export async function exportChat(projects, id) {
  const draft = projects.data.drafts.find((d) => d.id === id);
  const thread =
    draft ||
    (
      await projects.bridge.call("thread/read", {
        threadId: id,
        includeTurns: false,
      })
    ).thread;
  const chunks = [];
  if (!draft) {
    let cursor;
    do {
      const page = await readHistory(projects.bridge, id, cursor);
      chunks.unshift(
        page.data
          .flatMap((turn) => turn.items || [])
          .map((item) => {
            const text = itemText(item);
            if (!text) return "";
            const label =
              item.type === "userMessage"
                ? "Du"
                : item.type === "agentMessage"
                  ? "Codex"
                  : item.type === "imageGeneration"
                    ? "Generiertes Bild"
                    : "Aktivität";
            return `## ${label}\n\n${text}\n`;
          })
          .filter(Boolean)
          .join("\n"),
      );
      cursor = page.nextCursor;
    } while (cursor);
  }
  const name = thread.name || "Codex-Chat";
  return {
    name: name.replace(/[^\p{L}\p{N} _.-]/gu, "_").slice(0, 100) + ".md",
    text: `# ${name}\n\n${chunks.join("\n")}`,
  };
}
