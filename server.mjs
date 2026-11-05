import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { CodexBridge } from "./lib/bridge.mjs";
import { AuthStore, httpError } from "./lib/auth.mjs";
import { ProjectStore } from "./lib/projects.mjs";
import { projectMedia, readImage } from "./lib/media.mjs";
import { readHistory } from "./lib/history.mjs";
import { createWorkbench } from "./lib/work-routes.mjs";
import { randomUUID } from "node:crypto";
import { translate } from "./lib/i18n.mjs";
import { SettingsStore } from "./lib/settings.mjs";
import { listProjectAgents, readProjectAgent } from "./lib/agents.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Set([
  "account/read",
  "account/rateLimits/read",
  "model/list",
  "config/read",
  "thread/list",
  "thread/read",
  "thread/turns/list",
  "thread/items/list",
  "thread/queue/add",
  "thread/queue/list",
  "thread/resume",
  "thread/fork",
  "thread/name/set",
  "thread/archive",
  "thread/unarchive",
  "thread/compact/start",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
  "fs/readDirectory",
  "fs/readFile",
  "fs/writeFile",
  "fs/createDirectory",
  "fs/getMetadata",
  "command/exec",
  "command/exec/terminate",
  "skills/list",
]);
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw httpError(413, "Anfrage zu groß");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw httpError(400, "Ungültige Anfrage.");
  }
}

export async function createConsoleServer({
  bridge,
  dataDir,
  projectRoot,
  hostLabel,
  environment = process.env,
  releaseFetcher,
}) {
  const auth = await AuthStore.load(dataDir);
  const settings = await SettingsStore.load(dataDir, {
    ...environment,
    ...(hostLabel === undefined ? {} : { HOST_LABEL: hostLabel }),
    ...(projectRoot === undefined ? {} : { CODEX_PROJECTS_ROOT: projectRoot }),
    ...(bridge.options?.url === undefined ? {} : { CODEX_WS_URL: bridge.options.url }),
    ...(bridge.options?.token === undefined ? {} : { CODEX_API_TOKEN: bridge.options.token }),
  });
  const bridgeOptions = (overrides) => ({
    url: settings.value("CODEX_WS_URL", overrides),
    token: settings.value("CODEX_API_TOKEN", overrides),
  });
  if (bridge instanceof CodexBridge) {
    bridge.options = bridgeOptions();
    bridge.status.transport = "websocket";
  }
  hostLabel = settings.value("HOST_LABEL");
  const preferences = () => ({ language: settings.value("CODEX_WEB_LANGUAGE"), sendWith: settings.value("CODEX_SEND_WITH"), followupMode: settings.value("CODEX_FOLLOWUP_MODE") });
  const projects = await ProjectStore.load(dataDir, bridge, settings.value("CODEX_PROJECTS_ROOT"));
  const workbench = await createWorkbench({
    releaseFetcher,
    projects,
    dataDir,
    broadcast,
    json,
    body,
  });
  const configureReleases = () => workbench.releases.configure({
    repository: settings.value("CODEX_RELEASE_REPOSITORY"),
    token: settings.value("CODEX_GITHUB_TOKEN"),
  });
  configureReleases();
  let settingsChanges = Promise.resolve();
  const publishProjects = () =>
    broadcast({ method: "console/projects", params: projects.snapshot() });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/healthz")
        return json(res, 200, {
          ok: true,
          ...(auth.session(req)
            ? { codexConnected: bridge.status.connected }
            : {}),
        });
      if (req.method === "GET" && url.pathname === "/api/auth/status") {
        const session = auth.session(req);
        return json(res, 200, {
          configured: auth.configured,
          ...preferences(),
          authenticated: Boolean(session),
          ...(session ? { csrf: session.csrf } : {}),
        });
      }
      if (
        req.method === "POST" &&
        ["/api/auth/setup", "/api/auth/login"].includes(url.pathname)
      ) {
        if (!auth.sameOrigin(req)) throw httpError(403, "Ungültiger Ursprung.");
        const data = await body(req);
        if (url.pathname.endsWith("/setup"))
          await auth.setup(data.password, data.confirmPassword);
        else await auth.verify(data.password, req.socket.remoteAddress);
        const session = await auth.createSession(req, res);
        return json(res, 200, {
          authenticated: true,
          configured: true,
          ...preferences(),
          csrf: session.csrf,
        });
      }
      if (url.pathname.startsWith("/api/"))
        auth.require(req, !["GET", "HEAD"].includes(req.method));
      if (url.pathname === "/api/settings") {
        if (req.method === "GET") return json(res, 200, settings.snapshot());
        if (req.method === "PATCH") {
          const input = await body(req);
          const operation = settingsChanges.catch(() => {}).then(async () => {
            const previous = bridgeOptions();
            try {
              const result = await settings.update(input.values, (next) => {
                if (JSON.stringify(previous) !== JSON.stringify(bridgeOptions(next))) {
                  if (bridge.pending?.size) throw httpError(409, "Die Verbindung wird gerade verwendet. Bitte nach Abschluss der laufenden Anfrage erneut speichern.");
                  bridge.reconfiguring = true;
                }
              });
              hostLabel = settings.value("HOST_LABEL");
              projects.configuredRoot = settings.value("CODEX_PROJECTS_ROOT");
              configureReleases();
              if (JSON.stringify(previous) !== JSON.stringify(bridgeOptions())) bridge.reconfigure?.(bridgeOptions());
              broadcast({ method: "console/settings", params: preferences() });
              return result;
            } finally { bridge.reconfiguring = false; }
          });
          settingsChanges = operation;
          return json(res, 200, await operation);
        }
        throw httpError(405, "Methode nicht erlaubt.");
      }
      if (
        url.pathname.startsWith("/api/") &&
        (await workbench.routes(req, res, url))
      )
        return;
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        const sessionId = await auth.logout(req, res);
        for (const ws of wss.clients)
          if (ws.sessionId === sessionId) ws.close(4001, "Abgemeldet");
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/state")
        return json(res, 200, {
          status: bridge.status,
          requests: [...bridge.requests.values()],
          ...projects.snapshot(),
          hostLabel,
          ...preferences(),
        });
      if (req.method === "GET" && url.pathname === "/api/usage")
        return json(res, 200, await bridge.call("account/rateLimits/read", {}));
      if (req.method === "POST" && url.pathname === "/api/usage/reset") {
        const input = await body(req);
        if (input.confirm !== true)
          throw httpError(400, "Die Rücksetzung muss bestätigt werden.");
        const result = await bridge.call(
          "account/rateLimitResetCredit/consume",
          {
            idempotencyKey: input.idempotencyKey || randomUUID(),
            ...(input.creditId ? { creditId: input.creditId } : {}),
          },
        );
        return json(res, 200, {
          ...result,
          usage: await bridge.call("account/rateLimits/read", {}),
        });
      }
      if (req.method === "GET" && url.pathname === "/api/media") {
        const image = await readImage(bridge, url.searchParams.get("path"), {
          threadId: url.searchParams.get("threadId"),
          itemId: url.searchParams.get("itemId"),
        });
        res.writeHead(200, {
          "Content-Type": image.mime,
          "Cache-Control": "private, max-age=60",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(image.content);
      }
      const agentsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agents(?:\/([^/]+))?$/);
      if (req.method === "GET" && agentsMatch) {
        const project = projects.find(decodeURIComponent(agentsMatch[1]));
        return json(res, 200, agentsMatch[2]
          ? await readProjectAgent(bridge, project, decodeURIComponent(agentsMatch[2]), url.searchParams.get("cursor"))
          : await listProjectAgents(bridge, project, url.searchParams.get("cursor")));
      }
      const mediaMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/media$/,
      );
      if (req.method === "GET" && mediaMatch)
        return json(
          res,
          200,
          await projectMedia(projects, decodeURIComponent(mediaMatch[1])),
        );
      if (req.method === "POST" && url.pathname === "/api/projects") {
        const project = await projects.create(await body(req));
        publishProjects();
        return json(res, 201, { project, ...projects.snapshot() });
      }
      const projectMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)(?:\/(chats))?$/,
      );
      if (projectMatch) {
        const id = decodeURIComponent(projectMatch[1]);
        if (req.method === "POST" && projectMatch[2] === "chats") {
          const thread = await projects.draft(id);
          publishProjects();
          return json(res, 201, { thread, ...projects.snapshot() });
        }
        if (req.method === "PATCH" && !projectMatch[2]) {
          const project = await projects.rename(id, (await body(req)).name);
          publishProjects();
          return json(res, 200, { project, ...projects.snapshot() });
        }
        if (req.method === "DELETE" && !projectMatch[2]) {
          const result = await projects.deleteProject(id, await body(req));
          publishProjects();
          return json(res, 200, { ...result, ...projects.snapshot() });
        }
      }
      const startMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/start$/);
      const historyMatch = url.pathname.match(
        /^\/api\/chats\/([^/]+)\/history$/,
      );
      if (req.method === "GET" && historyMatch)
        return json(
          res,
          200,
          await readHistory(
            bridge,
            decodeURIComponent(historyMatch[1]),
            url.searchParams.get("cursor"),
            { includeActive: url.searchParams.get("focus") === "1" },
          ),
        );
      if (req.method === "POST" && startMatch) {
        const draftId = decodeURIComponent(startMatch[1]);
        const result = await projects.materialize(
          draftId,
          (await body(req)).options || {},
        );
        await workbench.store.moveComposer(draftId, result.thread.id);
        broadcast({
          method: "console/workbench",
          params: workbench.store.snapshot(),
        });
        publishProjects();
        return json(res, 200, { ...result, ...projects.snapshot() });
      }
      const actionMatch = url.pathname.match(
        /^\/api\/chats\/([^/]+)\/(rename|archive|restore|delete|assign)$/,
      );
      if (req.method === "POST" && actionMatch) {
        const input = await body(req);
        if (actionMatch[2] === "delete" && input.confirm !== true)
          throw httpError(400, "Das endgültige Löschen muss bestätigt werden.");
        await projects.chatAction(
          decodeURIComponent(actionMatch[1]),
          actionMatch[2],
          input,
        );
        if (actionMatch[2] === "delete") {
          await workbench.store.removeChat(decodeURIComponent(actionMatch[1]));
          workbench.search.remove(decodeURIComponent(actionMatch[1]));
        }
        publishProjects();
        return json(res, 200, { ok: true, ...projects.snapshot() });
      }
      if (req.method === "POST" && url.pathname === "/api/chats/bulk") {
        const { ids, action, confirm } = await body(req);
        if (
          !Array.isArray(ids) ||
          ids.length > 500 ||
          !ids.length ||
          !["archive", "restore", "delete"].includes(action)
        )
          throw httpError(400, "Ungültige Archivauswahl.");
        if (action === "delete" && confirm !== true)
          throw httpError(400, "Das endgültige Löschen muss bestätigt werden.");
        const completed = [],
          failed = [];
        for (const id of [...new Set(ids)]) {
          try {
            await projects.chatAction(id, action);
            if (action === "delete") {
              await workbench.store.removeChat(id);
              workbench.search.remove(id);
            }
            completed.push(id);
          } catch (e) {
            failed.push({ id, error: e.message });
          }
        }
        publishProjects();
        return json(res, 200, { completed, failed, ...projects.snapshot() });
      }
      if (req.method === "POST" && url.pathname === "/api/rpc") {
        const { method, params: input = {} } = await body(req);
        if (!allowed.has(method))
          throw httpError(400, "Unbekannte API-Methode");
        const params = { ...input };
        if (method === "thread/resume" || method === "turn/start") {
          const projectId = projects.data.threadProjects[params.threadId];
          const project = projects.data.projects.find(
            (p) => p.id === projectId,
          );
          if (project) params.cwd = project.path;
          if (method === "thread/resume" && project?.settings)
            Object.assign(params, await projects.instructionOptions(project));
        }
        const result = method === "thread/queue/add" ? await workbench.queue.add(params) : await bridge.call(
          method,
          params,
          method === "command/exec" ? 15 * 60 * 1000 : 120000,
        );
        if (["turn/start", "turn/steer", "turn/interrupt"].includes(method))
          workbench.monitor.cached = null;
        if (method === "thread/list") {
          await projects.observe(result.data);
          Object.assign(result, projects.snapshot());
        }
        if (method === "thread/fork") {
          const projectId = projects.data.threadProjects[params.threadId];
          if (projectId) {
            projects.data.threadProjects[result.thread.id] = projectId;
            await projects.save();
            publishProjects();
          }
        }
        return json(res, 200, { result });
      }
      if (req.method === "POST" && url.pathname === "/api/answer") {
        const { id, result } = await body(req);
        bridge.answer(id, result);
        return json(res, 200, { ok: true });
      }
      if (req.method !== "GET") throw httpError(404, "Nicht gefunden");
      const files = {
        "/": ["public/index.html", "text/html; charset=utf-8"],
        "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
        "/i18n.js": ["public/i18n.js", "text/javascript; charset=utf-8"],
        "/questions.js": ["public/questions.js", "text/javascript; charset=utf-8"],
        "/queue.js": ["public/queue.js", "text/javascript; charset=utf-8"],
        "/settings.js": ["public/settings.js", "text/javascript; charset=utf-8"],
        "/agents.js": ["public/agents.js", "text/javascript; charset=utf-8"],
        "/locales/en.json": ["public/locales/en.json", "application/json; charset=utf-8"],
        "/features.js": [
          "public/features.js",
          "text/javascript; charset=utf-8",
        ],
        "/style.css": ["public/style.css", "text/css; charset=utf-8"],
        "/assets/logo.png": ["public/assets/logo.png", "image/png"],
        "/vendor/marked.js": [
          "node_modules/marked/lib/marked.umd.js",
          "text/javascript",
        ],
        "/vendor/purify.js": [
          "node_modules/dompurify/dist/purify.min.js",
          "text/javascript",
        ],
      };
      const file = files[url.pathname];
      if (!file) throw httpError(404, "Nicht gefunden");
      const content = await readFile(path.join(root, file[0]));
      res.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      res.end(content);
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || 502, { error: translate(error.message, settings.value("CODEX_WEB_LANGUAGE")) });
      else res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    try {
      if (new URL(req.url, "http://localhost").pathname !== "/events")
        throw httpError(404, "Not found");
      const session = auth.require(req);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.sessionId = session.id;
        ws.expiresAt = session.expiresAt;
        wss.emit("connection", ws);
      });
    } catch (e) {
      socket.end(
        `HTTP/1.1 ${e.status || 401} Unauthorized\r\nConnection: close\r\n\r\n`,
      );
    }
  });
  function broadcast(message) {
    const value = JSON.stringify(message);
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > 8 * 1024 * 1024)
        ws.close(1013, "Client zu langsam");
      else ws.send(value);
    }
  }
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.send(
      JSON.stringify({ method: "console/status", params: bridge.status }),
    );
    for (const request of bridge.requests.values())
      ws.send(JSON.stringify(request));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.expiresAt < Date.now()) ws.close(4001, "Sitzung abgelaufen");
      else if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 30000);
  heartbeat.unref();
  const messageHandler = (message) => {
      workbench.record(message);
      broadcast(message);
    },
    statusHandler = (params) => {
      broadcast({ method: "console/status", params });
      if (params.connected) workbench.queue.reconnect();
    };
  bridge.on("message", messageHandler);
  bridge.on("status", statusHandler);
  return {
    server,
    auth,
    projects,
    workbench,
    settings,
    async close() {
      clearInterval(heartbeat);
      bridge.off("message", messageHandler);
      bridge.off("status", statusHandler);
      await workbench.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const bridge = new CodexBridge({
    url: process.env.CODEX_WS_URL,
    token: process.env.CODEX_API_TOKEN,
  });
  const app = await createConsoleServer({
    bridge,
    dataDir: process.env.DATA_DIR || path.join(root, ".data"),
    projectRoot: process.env.CODEX_PROJECTS_ROOT,
    hostLabel: process.env.HOST_LABEL,
  });
  bridge.connect().catch((e) => console.error("Codex:", e.message));
  app.server.listen(
    Number(process.env.PORT || 8787),
    process.env.BIND_ADDRESS || "0.0.0.0",
    () => console.log(`Codex-Web listening on :${app.server.address().port}`),
  );
  process.on("SIGTERM", async () => {
    bridge.close();
    await app.close();
    process.exit(0);
  });
}
