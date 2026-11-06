import { taggedPng } from "./support/image.mjs";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  lstat,
  symlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { createConsoleServer } from "../server.mjs";
import { ProjectStore, validateDeletePath } from "../lib/projects.mjs";
import { ReleaseInfo } from "../lib/releases.mjs";
import { FakeBridge } from "./support/fake-bridge.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=",
  "base64",
);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-viewport-test-"));
  await mkdir(path.join(root, "home/.codex"), { recursive: true });
  const bridge = new FakeBridge(root),
    dataDir = path.join(root, "data"),
    projectRoot = path.join(root, "home/projects");
  const app = await createConsoleServer({
    bridge, dataDir, projectRoot,
    environment: { ...process.env, CODEX_VIEWPORT_LANGUAGE: "de" },
    releaseFetcher: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: "v9.0.0", html_url: "https://github.com/example/codex-viewport/releases/tag/v9.0.0", published_at: "2026-11-05T12:00:00Z" }) }),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "",
    csrf = "";
  const request = async (url, options = {}) => {
    const { raw = false, noCookie = false, noCsrf = false, ...rest } = options;
    const res = await fetch(base + url, {
      ...rest,
      headers: {
        ...(cookie && !noCookie ? { Cookie: cookie } : {}),
        ...(csrf && !noCsrf ? { "X-CSRF-Token": csrf } : {}),
        "Content-Type": "application/json",
        ...(rest.headers || {}),
      },
      ...(rest.body ? { body: JSON.stringify(rest.body) } : {}),
    });
    const content = raw ? await res.arrayBuffer() : await res.json();
    return { res, status: res.status, body: content };
  };
  const login = async () => {
    const r = await request("/api/auth/setup", {
      method: "POST",
      body: { password: "test", confirmPassword: "test" },
    });
    assert.equal(r.status, 200);
    cookie = r.res.headers.get("set-cookie").split(";")[0];
    csrf = r.body.csrf;
  };
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    bridge,
    app,
    base,
    request,
    login,
    dataDir,
    projectRoot,
    get cookie() {
      return cookie;
    },
  };
}

test("project agent lists include archived agents, paginate and remain separate from project chats", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/projects/missing/agents")).status, 401);
  await f.login();
  const created = await f.request("/api/projects", { method: "POST", body: { name: "Agent fixture" } });
  const project = created.body.project;
  const root = { id: "root-chat", cwd: project.path, source: "cli", status: { type: "idle" }, turns: [] };
  f.bridge.threads.push(root);
  for (let i = 0; i < 52; i++) f.bridge.threads.push({
    id: `agent-${i}`, cwd: project.path, parentThreadId: root.id,
    source: { subAgent: { thread_spawn: { parent_thread_id: root.id, depth: 1 } } },
    agentNickname: `Agent ${i}`, updatedAt: i, status: { type: i === 51 ? "active" : "idle" }, turns: [],
  });
  f.bridge.threads.push({ ...f.bridge.threads[1], id: "archived-agent", archived: true });
  f.bridge.threads.push({ ...f.bridge.threads[1], id: "foreign-agent", cwd: path.join(f.root, "other") });
  const before = f.bridge.calls.length;
  const first = await f.request(`/api/projects/${project.id}/agents`);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 50);
  assert.equal(first.body.data[0].id, "agent-51");
  const second = await f.request(`/api/projects/${project.id}/agents?cursor=${encodeURIComponent(first.body.nextCursor)}`);
  assert.deepEqual(second.body.data.map((a) => a.id), ["agent-1", "agent-0", "archived-agent"]);
  assert.equal(second.body.data.at(-1).archived, true);
  assert.equal(second.body.nextCursor, null);
  const invalid = await f.request(`/api/projects/${project.id}/agents?cursor=broken`);
  assert.equal(invalid.status, 400);
  assert.ok(f.bridge.calls.slice(before).every((call) => call.method === "thread/list"));
  const chats = await f.request("/api/rpc", { method: "POST", body: { method: "thread/list", params: { sourceKinds: ["cli", "vscode", "appServer", "exec"] } } });
  assert.deepEqual(chats.body.result.data.map((thread) => thread.id), [root.id]);
});

test("agent output is project-scoped, paginated and never resumes or starts agent work", async (t) => {
  const f = await fixture(t);
  await f.login();
  const { body: { project } } = await f.request("/api/projects", { method: "POST", body: { name: "Agent output fixture" } });
  const root = { id: "agent-parent", cwd: project.path, source: "cli", name: "Parent chat", turns: [] };
  const agent = {
    id: "agent-child", cwd: project.path, agentNickname: "Reader", parentThreadId: root.id,
    source: { subAgent: { thread_spawn: { parent_thread_id: root.id, depth: 1 } } },
    status: { type: "idle" }, archived: true,
    turns: [{ id: "agent-turn", status: "completed", items: Array.from({ length: 35 }, (_, i) => ({ id: `output-${i}`, type: "agentMessage", text: `Output ${i}` })) }],
  };
  f.bridge.threads.push(root, agent, { ...agent, id: "other-child", cwd: path.join(f.root, "other-project") });
  const before = f.bridge.calls.length;
  const first = await f.request(`/api/projects/${project.id}/agents/${agent.id}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.parent.id, root.id);
  assert.equal(first.body.data[0].items.length, 20);
  assert.equal(first.body.data[0].items.at(-1).text, "Output 34");
  const older = await f.request(`/api/projects/${project.id}/agents/${agent.id}?cursor=${encodeURIComponent(first.body.nextCursor)}`);
  assert.equal(older.body.data[0].items.length, 15);
  assert.equal(older.body.nextCursor, null);
  assert.equal((await f.request(`/api/projects/${project.id}/agents/other-child`)).status, 404);
  assert.equal((await f.request(`/api/projects/${project.id}/agents/${root.id}`)).status, 404);
  assert.ok(f.bridge.calls.slice(before).every((call) => ["thread/read", "thread/items/list", "thread/turns/list"].includes(call.method)));
});

test("first-run password setup enforces minimum, protects API and socket, and persists without plaintext", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/auth/status")).body.configured, false);
  assert.equal((await f.request("/api/state")).status, 401);
  const rejected = new WebSocket(f.base.replace("http:", "ws:") + "/events");
  const [error] = await once(rejected, "error");
  assert.match(error.message, /401/);
  assert.equal(
    (
      await f.request("/api/auth/setup", {
        method: "POST",
        body: { password: "abc", confirmPassword: "abc" },
      })
    ).status,
    400,
  );
  await f.login();
  assert.equal((await f.request("/api/state")).status, 200);
  assert.equal(
    (
      await f.request("/api/auth/setup", {
        method: "POST",
        body: { password: "abcd", confirmPassword: "abcd" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/auth/login", {
        method: "POST",
        body: { password: "wrong" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/api/projects", {
        method: "POST",
        body: { name: "test" },
        noCsrf: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/projects", {
        method: "POST",
        body: { name: "test" },
        headers: { Origin: "http://attacker.invalid" },
      })
    ).status,
    403,
  );
  const stored = JSON.parse(
    await readFile(path.join(f.dataDir, "auth.json"), "utf8"),
  );
  assert.ok(stored.salt && stored.hash);
  assert.notEqual(stored.hash, "test");
  const reloaded = await (
    await import("../lib/auth.mjs")
  ).AuthStore.load(f.dataDir);
  assert.equal(reloaded.configured, true);
  await reloaded.verify("test", "unit");
  assert.ok(reloaded.session({ headers: { cookie: f.cookie } }));
  const ws = new WebSocket(f.base.replace("http:", "ws:") + "/events", {
    headers: { Cookie: f.cookie },
  });
  await once(ws, "open");
  ws.close();
  await once(ws, "close");
  assert.equal(
    (await f.request("/api/auth/logout", { method: "POST", body: {} })).status,
    200,
  );
  assert.equal((await f.request("/api/state")).status, 401);
});

test("projects create real directories, keep multiple draft chats and archive on metadata-only deletion", async (t) => {
  const f = await fixture(t);
  await f.login();
  const created = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Eigenes Projekt" },
  });
  assert.equal(created.status, 201);
  const p = created.body.project;
  assert.equal((await stat(p.path)).isDirectory(), true);
  await assert.rejects(stat(path.join(p.path, ".git")), { code: "ENOENT" });
  const a = await f.request(`/api/projects/${p.id}/chats`, {
      method: "POST",
      body: {},
    }),
    b = await f.request(`/api/projects/${p.id}/chats`, {
      method: "POST",
      body: {},
    });
  assert.notEqual(a.body.thread.id, b.body.thread.id);
  assert.equal(a.body.thread.projectId, p.id);
  const reloaded = await ProjectStore.load(f.dataDir, f.bridge, f.projectRoot);
  assert.equal(reloaded.data.drafts.length, 2);
  const deleted = await f.request(`/api/projects/${p.id}`, {
    method: "DELETE",
    body: { confirmName: p.name, deleteDirectory: false },
  });
  assert.equal(deleted.status, 200);
  assert.equal((await stat(p.path)).isDirectory(), true);
  assert.equal(
    deleted.body.drafts.every((d) => d.archived),
    true,
  );
  const restored = await f.request(`/api/chats/${a.body.thread.id}/restore`, {
    method: "POST",
    body: {},
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.projects.length, 1);
});

test("optional project deletion removes only the confirmed project tree and rejects active work", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Delete fixture" },
    })
  ).body.project;
  await writeFile(path.join(p.path, "fixture.txt"), "disposable");
  f.bridge.threads.push({
    id: "busy",
    cwd: p.path,
    status: { type: "active" },
    archived: false,
  });
  assert.equal(
    (
      await f.request(`/api/projects/${p.id}`, {
        method: "DELETE",
        body: { confirmName: p.name, deleteDirectory: true },
      })
    ).status,
    409,
  );
  f.bridge.threads[0].status = { type: "idle" };
  assert.equal(
    (
      await f.request(`/api/projects/${p.id}`, {
        method: "DELETE",
        body: { confirmName: "wrong", deleteDirectory: true },
      })
    ).status,
    400,
  );
  const r = await f.request(`/api/projects/${p.id}`, {
    method: "DELETE",
    body: { confirmName: p.name, deleteDirectory: true },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.directoryDeleted, true);
  await assert.rejects(stat(p.path), /ENOENT/);
  assert.equal(f.bridge.threads[0].archived, true);
  await f.request("/api/rpc", {
    method: "POST",
    body: { method: "thread/list", params: { archived: true } },
  });
  assert.equal(f.app.projects.data.projects.length, 0);
});

test("archive bulk operations preserve project binding and return individual failures", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Archiv" },
    })
  ).body.project;
  const draft = (
    await f.request(`/api/projects/${p.id}/chats`, { method: "POST", body: {} })
  ).body.thread;
  const materialized = (
    await f.request(`/api/chats/${draft.id}/start`, {
      method: "POST",
      body: { options: {} },
    })
  ).body;
  const id = materialized.thread.id;
  assert.equal(materialized.thread.projectId, p.id);
  const archive = await f.request("/api/chats/bulk", {
    method: "POST",
    body: { ids: [id], action: "archive" },
  });
  assert.deepEqual(archive.body.completed, [id]);
  await f.request("/api/rpc", {
    method: "POST",
    body: { method: "thread/read", params: { threadId: id } },
  });
  assert.equal(f.bridge.threads[0].archived, true);
  const restore = await f.request("/api/chats/bulk", {
    method: "POST",
    body: { ids: [id, "missing"], action: "restore" },
  });
  assert.equal(restore.body.failed.length, 1);
  assert.equal(f.app.projects.data.threadProjects[id], p.id);
  assert.equal(
    (
      await f.request("/api/chats/bulk", {
        method: "POST",
        body: { ids: [id], action: "delete" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/chats/bulk", {
        method: "POST",
        body: { ids: [id], action: "delete", confirm: true },
      })
    ).body.completed[0],
    id,
  );
  assert.equal(f.bridge.threads.length, 0);
});

test("gallery separates screenshots and generated images, and image bytes require authentication", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Bilder" },
    })
  ).body.project;
  for (const name of [
    "generated/art.png",
    "screenshots/home.png",
    "assets/icon.png",
  ]) {
    await mkdir(path.dirname(path.join(p.path, name)), { recursive: true });
    await writeFile(path.join(p.path, name), name === "generated/art.png" ? png : taggedPng(name));
  }
  const external = path.join(f.root, "external-screenshot.png");
  await writeFile(external, taggedPng("external-screenshot"));
  f.bridge.threads.push({
    id: "image-history",
    cwd: p.path,
    updatedAt: 1,
    status: { type: "idle" },
    turns: [{ items: [{ type: "imageView", path: external }] }],
  });
  const gallery = await f.request(`/api/projects/${p.id}/media`);
  assert.equal(gallery.status, 200);
  assert.ok(gallery.body.images.some((image) => image.path === external));
  assert.deepEqual(
    new Set(gallery.body.images.map((i) => i.category)),
    new Set(["generated", "screenshots", "project"]),
  );
  const imagePath =
    "/api/media?path=" +
    encodeURIComponent(path.join(p.path, "generated/art.png"));
  assert.equal((await f.request(imagePath, { noCookie: true })).status, 401);
  const image = await f.request(imagePath, { raw: true });
  assert.equal(image.res.headers.get("content-type"), "image/png");
  assert.equal(Buffer.compare(Buffer.from(image.body), png), 0);
});

test("local creation makes missing parents; Git creation and cloning are explicit choices", async (t) => {
  const f = await fixture(t);
  await f.login();
  const local = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Lokal", path: path.join(f.root, "missing/parents/local") },
  });
  assert.equal(local.status, 201);
  assert.ok((await stat(local.body.project.path)).isDirectory());
  await assert.rejects(stat(path.join(local.body.project.path, ".git")), {
    code: "ENOENT",
  });
  const git = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Mit Git", mode: "create" },
  });
  assert.equal(git.status, 201);
  assert.ok(
    (await stat(path.join(git.body.project.path, ".git"))).isDirectory(),
  );
  const clone = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Klon", mode: "clone", repository: git.body.project.path },
  });
  assert.equal(clone.status, 201);
  assert.ok(
    (await stat(path.join(clone.body.project.path, ".git"))).isDirectory(),
  );
});

test("gallery ownership follows explicit chat assignment and excludes nested projects and unrelated generated images", async (t) => {
  const f = await fixture(t);
  await f.login();
  const create = async (name, target) =>
    (
      await f.request("/api/projects", {
        method: "POST",
        body: { name, path: target },
      })
    ).body.project;
  const a = await create("A"),
    b = await create("B", path.join(a.path, "child"));
  await writeFile(path.join(a.path, "a.png"), taggedPng("a"));
  await writeFile(path.join(b.path, "b.png"), taggedPng("b"));
  const moved = {
    id: "moved-image-thread",
    cwd: a.path,
    updatedAt: 1,
    status: { type: "idle" },
    turns: [],
  };
  const generated = path.join(
    f.bridge.status.info.codexHome,
    "generated_images",
    moved.id,
    "art.png",
  );
  await mkdir(path.dirname(generated), { recursive: true });
  await writeFile(generated, png);
  const relative = path.join(a.path, "history image.png");
  await writeFile(relative, taggedPng("history"));
  moved.turns.push({
    items: [
      { type: "imageGeneration", savedPath: generated },
      { type: "imageView", path: "history image.png" },
    ],
  });
  f.bridge.threads.push(moved);
  f.bridge.threads.push({
    id: "own-image-thread",
    cwd: a.path,
    updatedAt: 1,
    turns: [{ items: [{ type: "imageView", path: generated }] }],
  });
  f.app.projects.data.threadProjects[moved.id] = b.id;
  const ga = (await f.request(`/api/projects/${a.id}/media`)).body;
  assert.equal(ga.projectId, a.id);
  assert.ok(ga.images.some((i) => i.path === path.join(a.path, "a.png")));
  assert.ok(
    !ga.images.some(
      (i) => i.path === generated || i.path === path.join(b.path, "b.png"),
    ),
  );
  const gb = (await f.request(`/api/projects/${b.id}/media`)).body;
  assert.equal(gb.projectId, b.id);
  assert.ok(gb.images.some((i) => i.path === generated));
  assert.ok(gb.images.some((i) => i.path === path.join(b.path, "b.png")));
  assert.ok(gb.images.some((i) => i.path === relative));
});

test("historical generated images recover from missing files and resolve stored thread images", async (t) => {
  const f = await fixture(t);
  await f.login();
  const threadId = "historical-image-thread",
    itemId = "old-image";
  f.bridge.threads.push({
    id: threadId,
    cwd: f.root,
    turns: [
      {
        items: [
          {
            id: itemId,
            type: "imageGeneration",
            savedPath: path.join(f.root, "deleted.png"),
            result: png.toString("base64"),
          },
        ],
      },
    ],
  });
  const url = `/api/media?threadId=${threadId}&itemId=${itemId}&path=${encodeURIComponent(path.join(f.root, "deleted.png"))}`;
  assert.equal((await f.request(url, { noCookie: true })).status, 401);
  const fallback = await f.request(url, { raw: true });
  assert.equal(fallback.status, 200);
  assert.equal(Buffer.compare(Buffer.from(fallback.body), png), 0);
  const stored = path.join(
    f.bridge.status.info.codexHome,
    "generated_images",
    threadId,
    "stored-image.png",
  );
  await mkdir(path.dirname(stored), { recursive: true });
  await writeFile(stored, png);
  const durable = await f.request(
    `/api/media?threadId=${threadId}&itemId=stored-image`,
    { raw: true },
  );
  assert.equal(durable.status, 200);
  assert.equal(Buffer.compare(Buffer.from(durable.body), png), 0);
  assert.equal(
    (await f.request(`/api/media?threadId=${threadId}&itemId=gone`)).status,
    404,
  );
});

test("history pages contain at most 20 entries, preserve turn state and omit generated image bytes", async (t) => {
  const f = await fixture(t);
  await f.login();
  const threadId = "paged-history";
  f.bridge.threads.push({
    id: threadId,
    turns: [
      {
        id: "large-turn",
        status: "failed",
        error: { message: "Recorded failure" },
        items: Array.from({ length: 64 }, (_, i) => ({
          id: `item-${i}`,
          type: "agentMessage",
          text: `Message ${i}`,
        })),
      },
      {
        id: "image-turn",
        status: "completed",
        items: [
          {
            id: "image",
            type: "imageGeneration",
            status: "completed",
            result: png.toString("base64").repeat(1000),
          },
        ],
      },
      { id: "active-empty-turn", status: "inProgress", items: [] },
    ],
  });
  const url = `/api/chats/${threadId}/history`;
  assert.equal((await f.request(url, { noCookie: true })).status, 401);
  let cursor,
    count = 0;
  const seen = new Set();
  do {
    const r = await f.request(
      url + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    assert.equal(r.status, 200);
    const items = r.body.data.flatMap((turn) => turn.items);
    assert.equal(items.length, Math.min(20, 65 - count));
    if (!cursor) {
      assert.ok(
        r.body.data.some(
          (turn) =>
            turn.id === "active-empty-turn" && turn.status === "inProgress",
        ),
      );
      assert.ok(!JSON.stringify(r.body).includes(png.toString("base64")));
      assert.equal(items.at(-1).consoleImageAvailable, true);
    }
    const failed = r.body.data.find((turn) => turn.id === "large-turn");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.message, "Recorded failure");
    for (const item of items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    count += items.length;
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.equal(count, 65);
  assert.ok(
    !f.bridge.calls.some(
      (call) =>
        call.method === "thread/read" || call.method === "thread/resume",
    ),
  );
  assert.ok(
    f.bridge.calls
      .filter((call) => call.method === "thread/items/list")
      .every(
        (call) =>
          call.params.limit === 20 && call.params.sortDirection === "desc",
      ),
  );
  assert.equal((await f.request(url + "?cursor=invalid")).status, 400);
});

test("older history pages hydrate turn metadata beyond the newest 20 turns", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.bridge.threads.push({
    id: "many-turns",
    turns: Array.from({ length: 45 }, (_, i) => ({
      id: `turn-${i}`,
      status: i === 5 ? "interrupted" : "completed",
      items: [{ id: `item-${i}`, type: "agentMessage", text: `Message ${i}` }],
    })),
  });
  let cursor, oldest;
  do {
    const r = await f.request(
      "/api/chats/many-turns/history" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    assert.equal(r.status, 200);
    oldest = r.body.data[0].id;
    if (r.body.data.some((turn) => turn.id === "turn-5"))
      assert.equal(
        r.body.data.find((turn) => turn.id === "turn-5").status,
        "interrupted",
      );
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.equal(oldest, "turn-0");
});

test("legacy history still pages within a large turn without reading the whole thread", async (t) => {
  const f = await fixture(t);
  await f.login();
  const call = f.bridge.call.bind(f.bridge);
  f.bridge.call = async (method, params) => {
    if (method === "thread/items/list")
      throw new Error("Item pagination unsupported for legacy store");
    return call(method, params);
  };
  f.bridge.threads.push({
    id: "legacy-history",
    turns: [
      {
        id: "first-turn",
        status: "completed",
        items: Array.from({ length: 45 }, (_, i) => ({
          id: `item-${i}`,
          type: "agentMessage",
          text: `Message ${i}`,
        })),
      },
      {
        id: "last-turn",
        status: "completed",
        items: [{ id: "last", type: "agentMessage", text: "Latest" }],
      },
    ],
  });
  let cursor,
    count = 0;
  const seen = new Set();
  do {
    const r = await f.request(
      "/api/chats/legacy-history/history" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    assert.equal(r.status, 200);
    const items = r.body.data.flatMap((turn) => turn.items);
    assert.equal(items.length, Math.min(20, 46 - count));
    for (const item of items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    count += items.length;
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.equal(count, 46);
  assert.ok(
    f.bridge.calls
      .filter((entry) => entry.method === "thread/turns/list")
      .every((entry) => entry.params.limit === 1),
  );
  assert.ok(!f.bridge.calls.some((entry) => entry.method === "thread/read"));
});

test("reset uses the real API contract with confirmation and idempotency; fake credits are consumed once", async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.equal(
    (await f.request("/api/usage")).body.rateLimitResetCredits.availableCount,
    2,
  );
  assert.equal(
    (await f.request("/api/usage/reset", { method: "POST", body: {} })).status,
    400,
  );
  const a = await f.request("/api/usage/reset", {
    method: "POST",
    body: { confirm: true, idempotencyKey: "one-logical-attempt" },
  });
  assert.equal(a.body.outcome, "reset");
  assert.equal(a.body.usage.rateLimitResetCredits.availableCount, 1);
  const b = await f.request("/api/usage/reset", {
    method: "POST",
    body: { confirm: true, idempotencyKey: "one-logical-attempt" },
  });
  assert.equal(b.body.outcome, "alreadyRedeemed");
  assert.equal(f.bridge.resetCount, 1);
});

test("directory guards reject roots, home, Codex state, canonical aliases and parents of other projects", () => {
  const ctx = {
    home: "/home/test",
    codexHome: "/home/test/.codex",
    projectRoot: "/home/test/projects",
    otherPaths: ["/home/test/projects/child"],
  };
  for (const p of [
    "/",
    "/tmp",
    "/home",
    "/home/test",
    "/home/test/.ssh",
    "/home/test/.codex/sessions",
    "/home/test/projects",
    "/usr/share",
  ])
    assert.throws(() => validateDeletePath(p, ctx));
  assert.throws(() =>
    validateDeletePath("/home/test/work", {
      ...ctx,
      otherPaths: ["/home/test/work/other"],
    }),
  );
  assert.doesNotThrow(() =>
    validateDeletePath("/home/test/projects/disposable", ctx),
  );
});

test("legacy project bookmarks migrate to stable project IDs without losing names or paths", async (t) => {
  const f = await fixture(t);
  const legacy = [
    { name: "Existing project", path: path.join(f.root, "legacy-project") },
  ];
  await writeFile(
    path.join(f.dataDir, "projects.json"),
    JSON.stringify(legacy),
  );
  const migrated = await ProjectStore.load(f.dataDir, f.bridge, f.projectRoot);
  assert.equal(migrated.data.projects[0].name, legacy[0].name);
  assert.equal(migrated.data.projects[0].path, legacy[0].path);
  assert.ok(migrated.data.projects[0].id);
  const reopened = await ProjectStore.load(f.dataDir, f.bridge, f.projectRoot);
  assert.equal(reopened.data.projects[0].id, migrated.data.projects[0].id);
});

test("project preferences, pinned chats and composer drafts persist and migrate to a real chat", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Vorgaben" },
    })
  ).body.project;
  const preferences = await f.request(`/api/projects/${p.id}/settings`, {
    method: "PATCH",
    body: {
      model: "test-model",
      effort: "low",
      instructions: "Antworte auf Deutsch.",
    },
  });
  assert.equal(preferences.status, 200);
  const draft = (
    await f.request(`/api/projects/${p.id}/chats`, { method: "POST", body: {} })
  ).body.thread;
  assert.equal(
    (
      await f.request("/api/workbench", {
        method: "PATCH",
        body: {
          pins: [draft.id],
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(`/api/chats/${draft.id}/composer`, {
        method: "PUT",
        body: { text: "Mehrzeiliger\nEntwurf", attachments: [] },
      })
    ).status,
    200,
  );
  const started = await f.request(`/api/chats/${draft.id}/start`, {
    method: "POST",
    body: { options: {} },
  });
  assert.equal(started.status, 200);
  const id = started.body.thread.id;
  const native = f.bridge.calls.find((call) => call.method === "thread/start");
  assert.equal(native.params.model, "test-model");
  assert.equal(native.params.developerInstructions, "Antworte auf Deutsch.");
  assert.equal(
    (await f.request(`/api/chats/${id}/composer`)).body.text,
    "Mehrzeiliger\nEntwurf",
  );
  assert.deepEqual((await f.request("/api/workbench")).body.pins, [id]);
  const stored = JSON.parse(
    await readFile(path.join(f.dataDir, "workbench.json"), "utf8"),
  );
  assert.equal(stored.composers[id].text, "Mehrzeiliger\nEntwurf");
  assert.equal(stored.preferences, undefined);
  await f.request("/api/rpc", {
    method: "POST",
    body: {
      method: "thread/resume",
      params: { threadId: id, excludeTurns: true },
    },
  });
  assert.equal(
    f.bridge.calls.at(-1).params.developerInstructions,
    "Antworte auf Deutsch.",
  );
  assert.equal(
    (await f.request(`/api/chats/${id}/composer`, { noCookie: true })).status,
    401,
  );
  f.bridge.emit("message", {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: id,
      tokenUsage: {
        last: { totalTokens: 15000 },
        total: { totalTokens: 30000 },
        modelContextWindow: 100000,
      },
    },
  });
  f.bridge.emit("message", {
    method: "item/completed",
    params: {
      threadId: id,
      item: { id: "compact", type: "contextCompaction" },
    },
  });
  const context = (await f.request(`/api/chats/${id}/context`)).body;
  assert.equal(context.last.totalTokens, 15000);
  assert.equal(context.compactions, 1);
  f.bridge.emit("message", {
    method: "thread/tokenUsage/updated",
    params: { threadId: id, tokenUsage: { last: { totalTokens: 12000 } } },
  });
  const afterCompaction = (await f.request(`/api/chats/${id}/context`)).body;
  assert.equal(afterCompaction.last.totalTokens, 12000);
  assert.equal(afterCompaction.compactions, 1);
  assert.equal(afterCompaction.lastCompactedAt, context.lastCompactedAt);
  assert.equal(
    (
      await f.request("/api/chats/bulk", {
        method: "POST",
        body: { ids: [id], action: "delete", confirm: true },
      })
    ).status,
    200,
  );
  assert.deepEqual((await f.request("/api/workbench")).body.pins, []);
});

test("project file management, binary uploads and ZIP downloads stay within the project", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Dateien" },
    })
  ).body.project;
  const action = (body) =>
    f.request(`/api/projects/${p.id}/files`, { method: "POST", body });
  assert.equal(
    (await action({ op: "file", path: "notes/a.txt", text: "Hallo Welt" }))
      .status,
    200,
  );
  assert.equal(
    (
      await action({
        op: "move",
        path: "notes/a.txt",
        destination: "notes/b.txt",
      })
    ).status,
    200,
  );
  assert.equal(
    await readFile(path.join(p.path, "notes/b.txt"), "utf8"),
    "Hallo Welt",
  );
  assert.equal(
    (await action({ op: "file", path: "../outside.txt" })).status,
    400,
  );
  const external = path.join(f.root, "outside");
  await mkdir(external);
  await symlink(external, path.join(p.path, "alias"));
  assert.equal(
    (await action({ op: "file", path: "alias/outside.txt" })).status,
    400,
  );
  assert.equal(
    (await action({ op: "delete", path: "", confirm: path.basename(p.path) }))
      .status,
    400,
  );
  const nested = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Kind", path: path.join(p.path, "child") },
    })
  ).body.project;
  assert.equal(
    (await action({ op: "delete", path: "child", confirm: "child" })).status,
    409,
  );
  const csrf = (await f.request("/api/auth/status")).body.csrf;
  const url = `${f.base}/api/projects/${p.id}/uploads?name=${encodeURIComponent("../../bild.png")}`;
  assert.equal((await fetch(url, { method: "PUT", body: png })).status, 401);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Cookie: f.cookie,
      "X-CSRF-Token": csrf,
      "Content-Type": "application/octet-stream",
    },
    body: png,
  });
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  assert.ok(uploaded.path.startsWith(p.path + "/.codex-viewport/uploads/"));
  assert.equal(uploaded.name, "bild.png");
  assert.equal(uploaded.image, true);
  assert.equal(Buffer.compare(await readFile(uploaded.path), png), 0);
  const large = Buffer.alloc(3 * 1024 * 1024 + 17, 37);
  const largeResponse = await fetch(
    `${f.base}/api/projects/${p.id}/uploads?name=large.bin`,
    {
      method: "PUT",
      headers: { Cookie: f.cookie, "X-CSRF-Token": csrf },
      body: large,
    },
  );
  assert.equal(largeResponse.status, 201);
  const largeInfo = await largeResponse.json();
  const largeDownload = await f.request(
    `/api/projects/${p.id}/download?path=${encodeURIComponent(largeInfo.path)}`,
    { raw: true },
  );
  assert.equal(largeDownload.status, 200);
  assert.deepEqual(Buffer.from(largeDownload.body), large);
  for (const call of f.bridge.calls.filter(
    (call) => call.method === "fs/writeFile",
  ))
    assert.ok(
      JSON.stringify(call.params).length < 3 * 1024 * 1024,
      "File transfers must fit in a native RPC frame",
    );
  const staged = f.bridge.calls.filter(
    (call) =>
      call.method === "fs/remove" &&
      path.basename(call.params.path).startsWith("codex-viewport-upload-"),
  );
  assert.equal(staged.length, 1);
  await assert.rejects(stat(staged[0].params.path), { code: "ENOENT" });
  const file = await f.request(
    `/api/projects/${p.id}/download?path=notes%2Fb.txt`,
    { raw: true },
  );
  assert.equal(Buffer.from(file.body).toString(), "Hallo Welt");
  assert.match(file.res.headers.get("content-disposition"), /attachment/);
  const zip = await f.request(`/api/projects/${p.id}/download?path=notes`, {
    raw: true,
  });
  assert.equal(zip.status, 200, Buffer.from(zip.body).toString());
  assert.equal(zip.res.headers.get("content-type"), "application/zip");
  assert.equal(Buffer.from(zip.body).subarray(0, 2).toString(), "PK");
  assert.ok(Buffer.from(zip.body).includes(Buffer.from("b.txt")));
  assert.equal(
    (await action({ op: "delete", path: "notes/b.txt", confirm: "wrong" }))
      .status,
    400,
  );
  assert.equal(
    (await action({ op: "delete", path: "notes/b.txt", confirm: "b.txt" }))
      .status,
    200,
  );
  await assert.rejects(stat(path.join(p.path, "notes/b.txt")), {
    code: "ENOENT",
  });
  assert.ok((await stat(nested.path)).isDirectory());
});

test("full-text index finds old and archived messages, filters project assignments and exports all pages", async (t) => {
  const f = await fixture(t);
  await f.login();
  const a = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Suche A" },
    })
  ).body.project;
  const b = (
    await f.request("/api/projects", {
      method: "POST",
      body: { name: "Suche B" },
    })
  ).body.project;
  f.bridge.threads.push({
    id: "search-old",
    name: "Langer Verlauf",
    cwd: a.path,
    updatedAt: 2,
    status: { type: "idle" },
    turns: [
      {
        id: "large",
        status: "completed",
        items: Array.from({ length: 65 }, (_, i) => ({
          id: `message-${i}`,
          type: "agentMessage",
          text: i === 0 ? "Nadelwort ganz am Anfang" : `Nachricht ${i}`,
        })),
      },
    ],
  });
  f.bridge.threads.push({
    id: "search-archived",
    name: "Archiviert",
    cwd: b.path,
    archived: true,
    updatedAt: 1,
    status: { type: "idle" },
    turns: [
      {
        id: "archive-turn",
        status: "completed",
        items: [
          {
            id: "archive-message",
            type: "userMessage",
            content: [{ type: "text", text: "Nadelwort im Archiv" }],
          },
        ],
      },
    ],
  });
  f.app.projects.data.threadProjects["search-old"] = b.id;
  const initial = await f.request("/api/search?q=Nadelwort");
  assert.equal(initial.body.progress.running, true);
  await f.app.workbench.search.job;
  const result = (await f.request("/api/search?q=Nadelwort")).body;
  assert.equal(result.total, 2);
  const hit = result.results.find((row) => row.threadId === "search-old");
  assert.ok(hit.cursor);
  assert.equal(hit.itemId, "message-0");
  const page = (
    await f.request(
      "/api/chats/search-old/history?focus=1&cursor=" +
        encodeURIComponent(hit.cursor),
    )
  ).body;
  assert.ok(
    page.data
      .flatMap((turn) => turn.items)
      .some((item) => item.id === "message-0"),
  );
  assert.equal(
    (await f.request("/api/search?q=Nadelwort&projectId=" + a.id)).body.total,
    0,
  );
  assert.equal(
    (
      await f.request(
        "/api/search?q=Nadelwort&projectId=" + b.id + "&archived=0",
      )
    ).body.total,
    1,
  );
  const exported = await f.request("/api/chats/search-old/export", {
    raw: true,
  });
  const markdown = Buffer.from(exported.body).toString("utf8");
  assert.match(markdown, /# Langer Verlauf/);
  assert.ok(
    markdown.indexOf("Nadelwort ganz am Anfang") <
      markdown.indexOf("Nachricht 64"),
  );
  assert.equal(
    (await f.request("/api/chats/search-old/export", { noCookie: true }))
      .status,
    401,
  );
});

test("remote home paths are derived from Codex metadata; unknown paths never become defaults", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.app.projects.configuredRoot = undefined;
  delete f.bridge.status.info.codexHome;
  const offline = await f.request("/api/state");
  assert.equal(offline.status, 200);
  assert.equal(offline.body.projectRoot, null);
  const before = f.bridge.calls.length;
  const blocked = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Unbekannter Pfad" },
  });
  assert.equal(blocked.status, 503);
  assert.equal(f.bridge.calls.length, before);
  const remoteHome = path.join(f.root, "different-user");
  f.bridge.status.info.codexHome = path.join(remoteHome, ".codex");
  const created = await f.request("/api/projects", {
    method: "POST",
    body: { name: "Metadaten" },
  });
  assert.equal(created.status, 201);
  assert.equal(
    created.body.project.path,
    path.join(remoteHome, "codex-projects/metadaten"),
  );
});

test("release lookup checks an explicit fork anonymously over HTTP without host commands", async () => {
  const calls = [];
  const release = new ReleaseInfo(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ tag_name: "v9.0.0", html_url: "https://github.com/example/custom-web/releases/tag/v9.0.0", published_at: "2026-11-05T12:00:00Z" }) };
  });
  release.configure({ repository: "example/custom-web" });
  assert.equal(release.snapshot().url, "https://github.com/example/custom-web/releases");
  const result = await release.check();
  assert.equal(calls[0].url, "https://api.github.com/repos/example/custom-web/releases/latest");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(result.publishedAt, "2026-11-05T12:00:00.000Z");
  await release.check();
  assert.equal(calls.length, 1);
  assert.throws(() => release.configure({ repository: "../invalid" }), /owner\/repo/);
});

test("task overview and release checks report state without starting jobs or deploying", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.bridge.threads.push({
    id: "working",
    name: "Aktive Aufgabe",
    cwd: f.projectRoot,
    updatedAt: 3,
    status: { type: "active", activeFlags: [] },
    turns: [
      { id: "work-turn", status: "inProgress", startedAt: 123, items: [] },
    ],
  });
  f.bridge.threads.push({
    id: "failed",
    name: "Fehler",
    cwd: f.projectRoot,
    updatedAt: 2,
    status: { type: "idle" },
    turns: [
      {
        id: "failed-turn",
        status: "failed",
        error: { message: "Testfehler" },
        items: [],
      },
    ],
  });
  f.bridge.requests.set("approval", { params: { threadId: "working" } });
  const tasks = (await f.request("/api/tasks")).body.tasks;
  assert.equal(
    tasks.find((task) => task.threadId === "working").status,
    "waiting",
  );
  assert.equal(
    tasks.find((task) => task.threadId === "failed").error,
    "Testfehler",
  );
  const release = (await f.request("/api/version?check=force")).body;
  assert.equal(release.latest, "9.0.0");
  assert.equal(release.updateAvailable, true);
  assert.ok(
    !f.bridge.calls.some((call) =>
      ["thread/start", "turn/start", "thread/resume"].includes(call.method),
    ),
  );
  assert.ok(
    f.bridge.calls
      .filter((call) => call.method === "command/exec")
      .every((call) => call.params.command[0] === "gh"),
  );
});

test("application settings are protected, validate changes and apply ENV overrides without exposing tokens", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/settings")).status, 401);
  await f.login();
  assert.equal((await f.request("/api/settings", { method: "PATCH", body: { values: { HOST_LABEL: "Other" } }, noCsrf: true })).status, 403);
  const root = path.join(f.root, "home/configured-projects");
  const changed = await f.request("/api/settings", { method: "PATCH", body: { values: { HOST_LABEL: "Saved host", CODEX_PROJECTS_ROOT: root, CODEX_GITHUB_TOKEN: "example-settings-token", CODEX_VIEWPORT_LANGUAGE: "en", CODEX_SEND_WITH: "enter" } } });
  assert.equal(changed.status, 200);
  assert.equal(JSON.stringify(changed.body).includes("example-settings-token"), false);
  assert.equal((await f.request("/api/state")).body.hostLabel, "Saved host");
  assert.equal((await f.request("/api/state")).body.projectRoot, root);
  assert.equal((await f.request("/api/auth/status")).body.sendWith, "enter");
  const rejected = await f.request("/api/settings", { method: "PATCH", body: { values: { CODEX_WS_URL: "https://codex-host.example" } } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /^Please enter a ws:/);
  await f.request("/api/settings", { method: "PATCH", body: { values: { CODEX_PROJECTS_ROOT: "" } } });
  assert.equal((await f.request("/api/state")).body.projectRoot, f.projectRoot);
});

test("gallery collapses identical content at different paths and skips internal runtime copies", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = (await f.request("/api/projects", { method: "POST", body: { name: "Unique gallery" } })).body.project;
  for (const dir of ["copies", ".data/audit"]) await mkdir(path.join(p.path, dir), { recursive: true });
  await writeFile(path.join(p.path, "logo.png"), png);
  await writeFile(path.join(p.path, "copies/renamed.png"), png);
  await writeFile(path.join(p.path, "different.png"), taggedPng("different"));
  await writeFile(path.join(p.path, ".data/audit/private-copy.png"), taggedPng("runtime"));
  f.bridge.threads.push({ id: "runtime-reference", cwd: p.path, updatedAt: 1, turns: [{ items: [{ type: "imageView", path: path.join(p.path, ".data/audit/private-copy.png") }] }] });
  const gallery = (await f.request(`/api/projects/${p.id}/media`)).body;
  assert.equal(gallery.images.length, 2);
  const logo = gallery.images.find((image) => image.name === "logo.png");
  assert.equal(logo.contentHash, createHash("sha256").update(png).digest("hex"));
  assert.equal(logo.copies.length, 2);
  assert.ok(logo.copies.includes(path.join(p.path, "copies/renamed.png")));
  assert.equal(gallery.images.some((image) => image.path.includes(".data/audit")), false);
});
