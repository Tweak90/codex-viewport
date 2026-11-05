import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CodexBridge } from "../lib/bridge.mjs";

async function fixture(t, { token } = {}) {
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const messages = [];
  const peers = [];
  const authorization = [];
  server.on("connection", (ws, request) => {
    authorization.push(request.headers.authorization);
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
    url: `ws://127.0.0.1:${http.address().port}`, token,
  });
  t.after(async () => {
    bridge.close();
    for (const peer of peers) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => http.close(resolve));
  });
  await bridge.connect();
  return { bridge, peers, messages, authorization };
}

test("initializes and exchanges RPC over the WebSocket API with optional bearer authentication", async (t) => {
  const { bridge, messages, authorization } = await fixture(t, { token: "example-api-token" });
  assert.equal(bridge.status.transport, "websocket");
  assert.equal(authorization[0], "Bearer example-api-token");
  assert.equal(bridge.status.connected, true);
  assert.equal(messages[0].method, "initialize");
  assert.equal((await bridge.call("test/websocket")).ok, true);
});

test("requires an explicit WebSocket API endpoint", async (t) => {
  for (const url of [undefined, "http://codex-host.example:4500"]) {
    const bridge = new CodexBridge({ url });
    t.after(() => bridge.close());
    await assert.rejects(bridge.connect(), /ws:\/\/ oder wss:\/\//);
    assert.equal(bridge.transport, undefined);
  }
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
