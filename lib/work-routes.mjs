import { WorkbenchStore, TaskMonitor } from "./workbench.mjs";
import { SearchIndex, exportChat } from "./search.mjs";
import { ReleaseInfo } from "./releases.mjs";
import {
  fileAction,
  uploadFile,
  downloadFile,
  UPLOAD_LIMIT,
} from "./files.mjs";
import { httpError } from "./auth.mjs";
import { QuestionStore } from "./questions.mjs";
import { MessageQueue } from "./message-queue.mjs";

const contextScript = `import sys,json,os
p=sys.argv[1];result={}
with open(p,'rb') as f:
 f.seek(max(0,os.path.getsize(p)-1024*1024));lines=f.read().splitlines()
for line in reversed(lines):
 try: record=json.loads(line)
 except: continue
 payload=record.get('payload',{});info=payload.get('info') or {}
 if payload.get('type')!='token_count' or not info.get('last_token_usage'): continue
 def fields(v): return {''.join([w if i==0 else w.title() for i,w in enumerate(k.split('_'))]):n for k,n in (v or {}).items() if isinstance(n,(int,float))}
 result={'last':fields(info.get('last_token_usage')),'total':fields(info.get('total_token_usage')),'modelContextWindow':info.get('model_context_window'),'recordedAt':record.get('timestamp')};break
print(json.dumps(result))`;

export async function createWorkbench({
  projects,
  dataDir,
  broadcast,
  json,
  body,
}) {
  const store = await WorkbenchStore.load(dataDir),
    search = await SearchIndex.load(dataDir, projects);
  const monitor = new TaskMonitor(projects, store),
    releases = new ReleaseInfo(projects);
  const questions = await QuestionStore.load(dataDir, projects.bridge);
  const queue = await MessageQueue.load(dataDir, projects.bridge);
  const validChat = async (id) => {
    const draft = projects.data.drafts.find((d) => d.id === id);
    return (
      draft ||
      (
        await projects.bridge.call("thread/read", {
          threadId: id,
          includeTurns: false,
        })
      ).thread
    );
  };
  async function routes(req, res, url) {
    const send = (value, status = 200) => {
      json(res, status, value);
      return true;
    };
    const download = (name, mime, content) => {
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
      return true;
    };
    if (url.pathname === "/api/workbench") {
      if (req.method === "GET") return send(store.snapshot());
      if (req.method === "PATCH") {
        const result = await store.preferences(await body(req));
        broadcast({ method: "console/workbench", params: result });
        return send(result);
      }
    }
    if (url.pathname === "/api/tasks" && req.method === "GET")
      return send(await monitor.read());
    if (url.pathname === "/api/pins" && req.method === "GET") {
      const list = await projects.allThreads(
        url.searchParams.get("archived") === "1",
      );
      return send({
        data: list
          .filter((thread) => store.data.pins.includes(thread.id))
          .map((thread) => ({
            ...thread,
            projectId: projects.data.threadProjects[thread.id],
          })),
      });
    }
    if (url.pathname === "/api/version" && req.method === "GET")
      return send(
        url.searchParams.has("check")
          ? await releases.check(url.searchParams.get("check") === "force")
          : releases.snapshot(),
      );
    if (url.pathname === "/api/search" && req.method === "GET") {
      search.start(url.searchParams.get("refresh") === "1");
      return send(
        search.query(url.searchParams.get("q"), {
          projectId: url.searchParams.get("projectId"),
          archived: url.searchParams.get("archived") !== "0",
        }),
      );
    }
    const composer = url.pathname.match(/^\/api\/chats\/([^/]+)\/composer$/);
    const questionMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/questions$/);
    if (questionMatch) {
      const id = decodeURIComponent(questionMatch[1]);
      const chat = await validChat(id);
      if (chat.draft) return send({ questions: [], nextCursor: null });
      if (req.method === "GET") return send(await questions.read(id, url.searchParams.get("cursor")));
      if (req.method === "POST") {
        if (chat.archived) throw httpError(409, "Stelle den archivierten Chat zunächst wieder her.");
        const input = await body(req);
        return send(await questions.answer(id, input.id, input.answer));
      }
    }
    if (composer) {
      const id = decodeURIComponent(composer[1]);
      await validChat(id);
      if (req.method === "GET") return send(store.composer(id));
      if (req.method === "PUT")
        return send(await store.setComposer(id, await body(req)));
    }
    const context = url.pathname.match(/^\/api\/chats\/([^/]+)\/context$/);
    if (context && req.method === "GET") {
      const id = decodeURIComponent(context[1]);
      const thread = await validChat(id);
      let value = store.data.contexts[id] || {};
      if (
        (!value.last || Date.now() - (value.observedAt || 0) > 30000) &&
        thread.path
      )
        try {
          const result = await projects.command(
            ["python3", "-c", contextScript, thread.path],
            projects.home,
            15000,
          );
          const parsed = JSON.parse(result.stdout);
          if (parsed.last) {
            value = { ...value, ...parsed, observedAt: Date.now() };
            store.data.contexts[id] = value;
            await store.save();
          }
        } catch {}
      return send(value);
    }
    const exp = url.pathname.match(/^\/api\/chats\/([^/]+)\/export$/);
    if (exp && req.method === "GET") {
      const result = await exportChat(projects, decodeURIComponent(exp[1]));
      return download(result.name, "text/markdown; charset=utf-8", result.text);
    }
    const settings = url.pathname.match(/^\/api\/projects\/([^/]+)\/settings$/);
    if (settings && req.method === "PATCH") {
      const project = await projects.settings(
        decodeURIComponent(settings[1]),
        await body(req),
      );
      broadcast({ method: "console/projects", params: projects.snapshot() });
      return send({ project, ...projects.snapshot() });
    }
    const files = url.pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
    if (files && req.method === "POST") {
      const result = await fileAction(
        projects,
        decodeURIComponent(files[1]),
        await body(req),
      );
      return send(result);
    }
    const upload = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads$/);
    if (upload && req.method === "PUT") {
      if (Number(req.headers["content-length"]) > UPLOAD_LIMIT) {
        req.resume();
        throw httpError(413, "Eine Datei darf höchstens 25 MB groß sein.");
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size <= UPLOAD_LIMIT) chunks.push(chunk);
      }
      if (size > UPLOAD_LIMIT)
        throw httpError(413, "Eine Datei darf höchstens 25 MB groß sein.");
      const result = await uploadFile(
        projects,
        decodeURIComponent(upload[1]),
        url.searchParams.get("name"),
        Buffer.concat(chunks),
        url.searchParams.get("directory"),
      );
      return send(result, 201);
    }
    const file = url.pathname.match(/^\/api\/projects\/([^/]+)\/download$/);
    if (file && req.method === "GET") {
      const result = await downloadFile(
        projects,
        decodeURIComponent(file[1]),
        url.searchParams.get("path") || "",
      );
      return download(result.name, result.mime, result.content);
    }
    return false;
  }
  return {
    store,
    search,
    monitor,
    releases,
    queue,
    routes,
    record(message) {
      queue.observe(message);
      if (message.params?.item && message.params.threadId && questions.observe(message.params.threadId, message.params.item))
        questions.save().catch(() => {});
      store.record(message);
      if (
        message.method === "turn/completed" ||
        message.method === "turn/started"
      ) {
        search.lastRun = 0;
        monitor.cached = null;
      }
    },
    async close() {
      await queue.close();
      await questions.queue;
      await search.close();
      await store.close();
    },
  };
}
