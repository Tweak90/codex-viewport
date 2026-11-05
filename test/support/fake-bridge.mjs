import { EventEmitter } from "node:events";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  lstat,
  rm,
  readdir,
} from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(execCallback);
export class FakeBridge extends EventEmitter {
  constructor(root) {
    super();
    this.root = root;
    this.status = {
      connected: true,
      transport: "test",
      info: { codexHome: path.join(root, "home/.codex") },
    };
    this.requests = new Map();
    this.threads = [];
    this.calls = [];
    this.resetCount = 2;
    this.redeemed = new Set();
  }
  async call(method, p = {}) {
    this.calls.push({ method, params: p });
    if (method === "fs/readDirectory")
      return {
        entries: (await readdir(p.path, { withFileTypes: true })).map((d) => ({
          fileName: d.name,
          isDirectory: d.isDirectory(),
          isFile: d.isFile(),
        })),
      };
    if (method === "model/list")
      return {
        data: [
          {
            id: "test-model",
            model: "test-model",
            displayName: "Test Codex",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
            ],
          },
        ],
      };
    if (method === "account/read")
      return { account: { type: "chatgpt", planType: "test" } };
    if (method === "fs/getMetadata") {
      const s = await stat(p.path),
        l = await lstat(p.path);
      return {
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        isSymlink: l.isSymbolicLink(),
      };
    }
    if (method === "fs/createDirectory") {
      await mkdir(p.path, { recursive: p.recursive });
      return {};
    }
    if (method === "fs/readFile")
      return { dataBase64: (await readFile(p.path)).toString("base64") };
    if (method === "fs/writeFile") {
      await writeFile(p.path, Buffer.from(p.dataBase64, "base64"));
      return {};
    }
    if (method === "fs/remove") {
      assert.ok(
        p.path.startsWith(this.root + "/") ||
          path.basename(p.path).startsWith("codex-web-download-") ||
          path.basename(p.path).startsWith("codex-web-upload-"),
      );
      await rm(p.path, { recursive: p.recursive, force: p.force });
      return {};
    }
    if (method === "command/exec") {
      try {
        const r = await execFile(p.command[0], p.command.slice(1), {
          cwd: p.cwd,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 15000,
        });
        return { exitCode: 0, stdout: r.stdout, stderr: r.stderr };
      } catch (e) {
        return {
          exitCode: typeof e.code === "number" ? e.code : 1,
          stdout: e.stdout || "",
          stderr: e.stderr || e.message,
        };
      }
    }
    if (method === "thread/list") {
      const kind = (t) => {
        if (!t.source) return "appServer";
        if (typeof t.source === "string") return t.source;
        const source = t.source.subAgent;
        return source?.thread_spawn ? "subAgentThreadSpawn" : source === "review" ? "subAgentReview" : source === "compact" ? "subAgentCompact" : source ? "subAgentOther" : "unknown";
      };
      const sources = p.sourceKinds?.length ? p.sourceKinds : ["cli", "vscode"];
      const threads = this.threads.filter((t) =>
        Boolean(t.archived) === Boolean(p.archived) && (!p.cwd || t.cwd === p.cwd) &&
        (sources.includes(kind(t)) || (sources.includes("subAgent") && kind(t).startsWith("subAgent"))));
      if (p.sortKey) threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const start = Number(p.cursor || 0), end = start + (p.limit || 100);
      return { data: threads.slice(start, end).map((t) => ({ ...t, turns: [] })), nextCursor: end < threads.length ? String(end) : null };
    }
    if (method === "thread/start") {
      const t = {
        id: `test-thread-${randomUUID()}`,
        cwd: p.cwd,
        createdAt: 1,
        updatedAt: 1,
        status: { type: "idle" },
        turns: [],
      };
      this.threads.push(t);
      return { thread: { ...t }, cwd: t.cwd, model: "test-model" };
    }
    if (method === "thread/queue/add") {
      this.queued ||= new Map();
      const list = this.queued.get(p.threadId) || [];
      const queuedSubmission = { id: randomUUID(), clientUserMessageId: p.clientUserMessageId, input: p.input };
      list.push(queuedSubmission); this.queued.set(p.threadId, list);
      this.emit("message", { method: "thread/queue/changed", params: { threadId: p.threadId } });
      return { queuedSubmission };
    }
    if (method === "thread/queue/list") return { data: (this.queued?.get(p.threadId) || []).slice(0, p.limit || 100), nextCursor: null };
    if (method === "thread/queue/start") {
      const list = this.queued?.get(p.threadId) || [];
      const index = list.findIndex((entry) => entry.id === p.queuedSubmissionId);
      if (index < 0) throw new Error("Queue entry not found");
      const [entry] = list.splice(index, 1);
      this.emit("message", { method: "thread/queue/changed", params: { threadId: p.threadId } });
      return this.call("turn/start", { threadId: p.threadId, input: entry.input });
    }
    if (method === "turn/start") {
      const t = this.threads.find((t) => t.id === p.threadId);
      t.updatedAt = Math.max(t.updatedAt + 1, Math.floor(Date.now() / 1000));
      t.status = { type: "active", activeFlags: [] };
      if (p.input?.[0]?.text?.includes("AGENTS_TEST")) {
        const agent = (nickname, overrides = {}) => ({
          id: `test-agent-${randomUUID()}`, cwd: t.cwd, parentThreadId: t.id,
          source: { subAgent: { thread_spawn: { parent_thread_id: t.id, depth: 1 } } },
          agentNickname: nickname, agentRole: "reviewer", preview: `Task for ${nickname}`,
          createdAt: 1, updatedAt: 2, status: { type: "idle" },
          turns: [{ id: randomUUID(), status: "completed", items: [{ id: randomUUID(), type: "agentMessage", text: "ARCHIVED_AGENT_RESULT" }] }],
          ...overrides,
        });
        this.threads.push(agent("Browser helper", {
          status: { type: "active", activeFlags: [] }, updatedAt: 3,
          turns: [{ id: randomUUID(), status: "inProgress", items: Array.from({ length: 60 }, (_, index) => ({ id: `agent-item-${index}`, type: "agentMessage", text: `agent-line-${String(index).padStart(3, "0")}` })) }],
        }), agent("Earlier helper", { archived: true }), agent("Foreign helper", { cwd: path.join(this.root, "foreign-project") }));
      }
      if (p.input?.[0]?.text?.includes("HISTORY_TEST"))
        t.turns.push({
          id: "large-history-turn-" + randomUUID(),
          status: "completed",
          items: Array.from({ length: 60 }, (_, i) => ({
            id: `history-item-${i}`,
            type: i % 2 ? "agentMessage" : "userMessage",
            ...(i % 2
              ? {
                  text:
                    `history-message-${String(i).padStart(3, "0")} ` +
                    "Lesbarer Verlauf. ".repeat(10),
                }
              : {
                  content: [
                    {
                      type: "text",
                      text:
                        `history-message-${String(i).padStart(3, "0")} ` +
                        "Eine Nachricht im Verlauf. ".repeat(10),
                    },
                  ],
                }),
          })),
        });
      const turn = { id: randomUUID(), status: "inProgress", items: [] };
      t.turns.push(turn);
      this.emit("message", {
        method: "turn/started",
        params: { threadId: t.id, turn: { ...turn, items: [] } },
      });
      let generatedPath;
      if (p.input?.[0]?.text?.includes("IMAGE_TEST")) {
        generatedPath = path.join(
          this.status.info.codexHome,
          "generated_images",
          t.id,
          "generated.png",
        );
        await mkdir(path.dirname(generatedPath), { recursive: true });
        await writeFile(
          generatedPath,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=",
            "base64",
          ),
        );
      }
      setTimeout(
        () => {
          const user = {
            id: randomUUID(),
            type: "userMessage",
            content: p.input,
          };
          const agent = {
            id: randomUUID(),
            type: "agentMessage",
            text: "CONSOLE_STREAM_OK",
          };
          if (p.input?.[0]?.text?.includes("QUESTION_TEST")) {
            agent.text = "Please choose an answer.";
            agent.questions = [{ title: "Which option should be used?", options: ["First option", "Second option"] }];
          }
          if (p.input?.[0]?.text?.includes("WEB_ASSET_TEST"))
            agent.text = `![Web-Logo](/assets/logo.png)\n\n[Logo öffnen](/assets/logo.png)\n\n[Externes Logo](https://web-host.example/assets/logo.png)\n\n![Projektbild](sandbox:${generatedPath})`;
          if (p.input?.[0]?.text?.includes("LONG_OUTPUT_TEST"))
            turn.items.push({
              id: randomUUID(),
              type: "commandExecution",
              command:
                "python3 -c " +
                "very-long-command ".repeat(100) +
                "\nsecond line",
              aggregatedOutput:
                Array.from({ length: 200 }, (_, i) => "output-line-" + i).join(
                  "\n",
                ) + "\nEND_OUTPUT",
              exitCode: 0,
            });
          if (generatedPath)
            turn.items.push({
              id: randomUUID(),
              type: "imageGeneration",
              status: "completed",
              savedPath: p.input?.[0]?.text?.includes("PAST_IMAGE_TEST")
                ? generatedPath + ".missing.png"
                : generatedPath,
              result:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=",
            });
          turn.items.push(user, agent);
          for (const item of turn.items)
            this.emit("message", {
              method: "item/completed",
              params: { threadId: t.id, turnId: turn.id, item },
            });
          turn.status = "completed";
          t.status = { type: "idle" };
          this.emit("message", {
            method: "thread/tokenUsage/updated",
            params: {
              threadId: t.id,
              turnId: turn.id,
              tokenUsage: {
                last: {
                  totalTokens: 15000,
                  inputTokens: 14000,
                  outputTokens: 1000,
                },
                total: { totalTokens: 30000 },
                modelContextWindow: 100000,
              },
            },
          });
          this.emit("message", {
            method: "turn/completed",
            params: { threadId: t.id, turn },
          });
        },
        p.input?.[0]?.text?.includes("WAIT_TEST") ? 1200 : 30,
      );
      return { turn: { ...turn, items: [] } };
    }
    if (method === "thread/turns/list") {
      const t = this.threads.find((t) => t.id === p.threadId);
      if (!t) throw new Error("Thread not found");
      const ordered =
        p.sortDirection === "asc" ? t.turns : [...t.turns].reverse();
      const start = Number(p.cursor || 0),
        end = start + (p.limit || 100);
      return {
        data: ordered.slice(start, end).map((turn) => ({
          ...turn,
          items: p.itemsView === "notLoaded" ? [] : turn.items,
        })),
        nextCursor: end < ordered.length ? String(end) : null,
      };
    }
    if (method === "thread/items/list") {
      const t = this.threads.find((t) => t.id === p.threadId);
      if (!t) throw new Error("Thread not found");
      let items = t.turns.flatMap((turn) =>
        (turn.items || []).map((item) => ({ turnId: turn.id, item })),
      );
      if (p.turnId) items = items.filter((item) => item.turnId === p.turnId);
      if (p.sortDirection === "desc") items.reverse();
      const start = Number(p.cursor || 0),
        end = start + (p.limit || 100);
      return {
        data: items.slice(start, end),
        nextCursor: end < items.length ? String(end) : null,
      };
    }
    if (method.startsWith("thread/")) {
      const t = this.threads.find((t) => t.id === p.threadId);
      if (!t) throw new Error("Thread not found");
      if (method === "thread/archive") t.archived = true;
      if (method === "thread/unarchive") t.archived = false;
      if (method === "thread/delete")
        this.threads = this.threads.filter((x) => x !== t);
      if (method === "thread/name/set") t.name = p.name;
      if (method === "thread/read" || method === "thread/resume")
        return {
          thread: {
            ...t,
            turns:
              p.includeTurns || (method === "thread/resume" && !p.excludeTurns)
                ? t.turns
                : [],
          },
          cwd: t.cwd,
          model: "test-model",
        };
      return {};
    }
    if (method === "account/rateLimits/read")
      return {
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 75,
            windowDurationMins: 300,
            resetsAt: 2000000000,
          },
        },
        rateLimitResetCredits: { availableCount: this.resetCount, credits: [] },
      };
    if (method === "account/rateLimitResetCredit/consume") {
      if (this.redeemed.has(p.idempotencyKey))
        return { outcome: "alreadyRedeemed" };
      this.redeemed.add(p.idempotencyKey);
      this.resetCount--;
      return { outcome: "reset" };
    }
    return {};
  }
  answer() {}
}
