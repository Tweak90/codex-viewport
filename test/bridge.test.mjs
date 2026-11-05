import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { CodexBridge } from "../lib/bridge.mjs";

async function fixture(t, { unix = false } = {}) {
  const directory = unix ? await mkdtemp(path.join(tmpdir(), "cw-sock-")) : null;
  const socket = directory && path.join(directory, "control.sock");
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  http.listen(socket || 0, socket ? undefined : "127.0.0.1");
  await once(http, "listening");
  const messages = [];
  const peers = [];
  server.on("connection", (ws) => {
    peers.push(ws);
    ws.on("message", (data) => {
      const message = JSON.parse(data);
      messages.push(message);
      if (message.id === undefined || !message.method) return;
      if (message.method === "test/pending") return;
      if (message.method === "test/error")
        return ws.send(
          JSON.stringify({
            id: message.id,
            error: { code: -32602, message: "Invalid input" },
          }),
        );
      const result = message.method.startsWith("thread/")
        ? { thread: { id: message.params.threadId || "thread-test" } }
        : { ok: true };
      ws.send(JSON.stringify({ id: message.id, result }));
    });
  });
  const bridge = new CodexBridge({
    ...(unix ? { socket } : { url: `ws://127.0.0.1:${http.address().port}` }),
  });
  t.after(async () => {
    bridge.close();
    for (const peer of peers) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => http.close(resolve));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  await bridge.connect();
  return { bridge, peers, messages };
}

test("initializes and exchanges RPC over the local Unix control socket", async (t) => {
  const { bridge, messages } = await fixture(t, { unix: true });
  assert.equal(bridge.status.transport, "unix");
  assert.equal(bridge.status.connected, true);
  assert.equal(messages[0].method, "initialize");
  assert.equal((await bridge.call("test/unix")).ok, true);
});

test("routes concurrent responses and preserves structured API errors", async (t) => {
  const { bridge } = await fixture(t);
  const [one, two] = await Promise.all([
    bridge.call("test/one"),
    bridge.call("test/two"),
  ]);
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  await assert.rejects(
    bridge.call("test/error"),
    (error) => error.code === -32602 && error.message === "Invalid input",
  );
  assert.equal(bridge.pending.size, 0);
});

test("forwards approval requests and answers with the original numeric request id", async (t) => {
  const { bridge, peers, messages } = await fixture(t);
  const received = once(bridge, "message");
  peers[0].send(
    JSON.stringify({
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "a", turnId: "b" },
    }),
  );
  await received;
  assert.equal(bridge.requests.size, 1);
  bridge.answer("42", { decision: "accept" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(messages.at(-1), { id: 42, result: { decision: "accept" } });
  assert.throws(() => bridge.answer("42", {}), /nicht mehr offen/);
});

test("clears unanswered requests when a turn ends", async (t) => {
  const { bridge, peers } = await fixture(t);
  const first = once(bridge, "message");
  peers[0].send(
    JSON.stringify({
      id: "q",
      method: "item/tool/requestUserInput",
      params: { threadId: "a", turnId: "b" },
    }),
  );
  await first;
  const completed = once(bridge, "message");
  peers[0].send(
    JSON.stringify({
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "b", status: "completed" } },
    }),
  );
  await completed;
  assert.equal(bridge.requests.size, 0);
});

test("rejects in-flight requests after a disconnect and resumes subscribed threads", async (t) => {
  const { bridge, peers, messages } = await fixture(t);
  await bridge.call("thread/resume", { threadId: "keep" });
  const pending = bridge.call("test/pending");
  peers[0].close();
  await assert.rejects(pending, /geschlossen/);
  assert.equal(bridge.status.connected, false);
  const deadline = Date.now() + 7000;
  while (
    (!bridge.status.connected ||
      !messages.some(
        (m) => m.method === "thread/resume" && m.params.excludeTurns,
      )) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(bridge.status.connected, true);
  assert.ok(
    messages.some(
      (m) =>
        m.method === "thread/resume" &&
        m.params.threadId === "keep" &&
        m.params.excludeTurns,
    ),
  );
  assert.equal(messages.filter((m) => m.method === "test/pending").length, 1);
});

test("connection changes reject new calls during saving and isolate late errors from old sockets", async (t) => {
  const { bridge, messages } = await fixture(t);
  bridge.reconfiguring = true;
  await assert.rejects(bridge.call("test/blocked"), /konfiguriert/);
  assert.equal(messages.some((message) => message.method === "test/blocked"), false);
  bridge.reconfiguring = false;
  const oldSocket = bridge.transport;
  const pending = bridge.call("test/pending");
  bridge.reconfigure({ url: bridge.options.url });
  await assert.rejects(pending, /Beendet/);
  const deadline = Date.now() + 3000;
  while (!bridge.status.connected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  oldSocket.emit("error", new Error("Late old connection error"));
  assert.equal(bridge.status.connected, true);
  assert.equal((await bridge.call("test/after-change")).ok, true);
  assert.ok(messages.filter(message => message.method === "test/pending").length <= 1);
});
