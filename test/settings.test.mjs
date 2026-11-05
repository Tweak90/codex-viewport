import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "../lib/settings.mjs";
import { QuestionStore } from "../lib/questions.mjs";
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cw-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("saved settings override ENV, blanks restore ENV and secrets stay out of responses", async (t) => {
  const root = await directory(t);
  const env = { HOST_LABEL: "ENV host", CODEX_API_TOKEN: "example-env-token", CODEX_WEB_LANGUAGE: "de" };
  const settings = await SettingsStore.load(root, env);
  await settings.update({ HOST_LABEL: "Saved host", CODEX_API_TOKEN: "example-saved-token", CODEX_WEB_LANGUAGE: "en" });
  const visible = JSON.stringify(settings.snapshot());
  assert.equal(visible.includes("example-env-token"), false);
  assert.equal(visible.includes("example-saved-token"), false);
  assert.equal(settings.value("HOST_LABEL"), "Saved host");
  assert.equal((await stat(settings.filename)).mode & 0o777, 0o600);
  const loaded = await SettingsStore.load(root, env);
  assert.equal(loaded.value("CODEX_API_TOKEN"), "example-saved-token");
  await loaded.update({ HOST_LABEL: " ", CODEX_API_TOKEN: "" });
  assert.equal(loaded.value("HOST_LABEL"), "ENV host");
  assert.equal(loaded.value("CODEX_API_TOKEN"), "example-env-token");
  assert.equal(loaded.snapshot().fields.find(f => f.name === "CODEX_API_TOKEN").hasOverride, false);
  assert.equal(loaded.value("CODEX_WEB_LANGUAGE"), "en");
  assert.ok(!JSON.parse(await readFile(loaded.filename)).overrides.CODEX_API_TOKEN);
});
test("unsupported saved settings are removed while valid overrides survive", async (t) => {
  const root = await directory(t);
  await writeFile(path.join(root, "settings.json"), JSON.stringify({ version: 1, overrides: { HOST_LABEL: "Saved host", RETIRED_OPTION: "obsolete" } }));
  const settings = await SettingsStore.load(root, {});
  assert.equal(settings.value("HOST_LABEL"), "Saved host");
  const saved = JSON.parse(await readFile(settings.filename));
  assert.deepEqual(saved.overrides, { HOST_LABEL: "Saved host" });
  await assert.rejects(settings.update({ RETIRED_OPTION: "new value" }), error => error.status === 400);
});
test("without ENV settings use English and sensible defaults; configured ENV remains distinguishable from overrides", async (t) => {
  const defaults = await SettingsStore.load(await directory(t), {});
  assert.equal(defaults.value("CODEX_WEB_LANGUAGE"), "en");
  assert.equal(defaults.value("CODEX_SEND_WITH"), "shiftEnter");
  assert.equal(defaults.value("CODEX_FOLLOWUP_MODE"), "steer");
  assert.equal(defaults.value("HOST_LABEL"), "Codex-Host");
  assert.equal(defaults.value("CODEX_RELEASE_REPOSITORY"), "Tweak90/codex-web");
  assert.equal(defaults.value("CODEX_WS_URL"), "");
  assert.equal(defaults.snapshot().fields.find(f => f.name === "HOST_LABEL").source, "default");
  const configured = await SettingsStore.load(await directory(t), { CODEX_WEB_LANGUAGE: "de" });
  assert.equal(configured.snapshot().fields.find(f => f.name === "CODEX_WEB_LANGUAGE").source, "env");
  await configured.update({ CODEX_WEB_LANGUAGE: "en" });
  const field = configured.snapshot().fields.find(f => f.name === "CODEX_WEB_LANGUAGE");
  assert.equal(field.source, "settings");
  assert.equal(field.fallbackSource, "env");
  await configured.update({ CODEX_WEB_LANGUAGE: "" });
  assert.equal(configured.value("CODEX_WEB_LANGUAGE"), "de");
});
test("settings reject invalid endpoints and paths and preserve concurrent independent saves", async (t) => {
  const settings = await SettingsStore.load(await directory(t), {});
  for (const values of [{ CODEX_WS_URL: "https://codex-host.example" }, { CODEX_WS_URL: "ws://user:password@codex-host.example" }, { CODEX_PROJECTS_ROOT: "relative" }, { CODEX_WEB_LANGUAGE: "invalid" }, { OTHER_ENV: "value" }])
    await assert.rejects(settings.update(values), error => error.status === 400);
  await Promise.all([settings.update({ HOST_LABEL: "One" }), settings.update({ CODEX_SEND_WITH: "enter" })]);
  assert.equal(settings.value("HOST_LABEL"), "One");
  assert.equal(settings.value("CODEX_SEND_WITH"), "enter");
});
test("async question replies use the native envelope, persist completion and send only once", async (t) => {
  const calls = [];
  const bridge = { async call(method, params) { calls.push({ method, params }); return { turn: { id: "turn" } }; } };
  const root = await directory(t);
  const store = await QuestionStore.load(root, bridge);
  store.observe("thread", { type: "agentMessage", id: "call_test", questions: [{ title: "Which option?", options: ["One", "Two"] }] });
  const id = store.snapshot("thread")[0].id;
  const results = await Promise.allSettled([store.answer("thread", id, "<custom answer>"), store.answer("thread", id, "Two")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "turn/start");
  const text = calls[0].params.input[0].text;
  assert.equal(text.includes("<custom answer>"), false);
  const replies = JSON.parse(text.match(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/)[1]);
  assert.deepEqual(replies, [{ questionItemId: JSON.stringify(["request_user_input_async", "call_test", 0]), question: "Which option?", answer: "<custom answer>" }]);
  const loaded = await QuestionStore.load(root, bridge);
  assert.equal(loaded.snapshot("thread")[0].state, "sent");
  await assert.rejects(loaded.answer("thread", id, "Two"), error => error.status === 409);
});
test("an uncertain question reply is never retried after transport failure or reload", async (t) => {
  let calls = 0;
  const bridge = { async call() { calls++; throw new Error("Disconnected"); } };
  const root = await directory(t);
  const store = await QuestionStore.load(root, bridge);
  store.observe("thread", { type: "agentMessage", id: "call_failure", questions: [{ title: "Continue?" }] });
  const id = store.snapshot("thread")[0].id;
  await assert.rejects(store.answer("thread", id, "Yes"), error => error.status === 502);
  const loaded = await QuestionStore.load(root, bridge);
  assert.equal(loaded.snapshot("thread")[0].state, "uncertain");
  await assert.rejects(loaded.answer("thread", id, "Yes"), error => error.status === 409);
  assert.equal(calls, 1);
});

test("native queued messages wait for idle without replaying an uncertain start", async (t) => {
  const { MessageQueue } = await import("../lib/message-queue.mjs");
  const root = await directory(t);
  let status = "active", starts = 0;
  const entries = [];
  const bridge = { async call(method, params) {
    if (method === "thread/read") return { thread: { status: { type: status } } };
    if (method === "thread/queue/add") { const queuedSubmission = { id: "queued", input: params.input }; entries.push(queuedSubmission); return { queuedSubmission }; }
    if (method === "thread/queue/list") return { data: entries };
    if (method === "thread/queue/start") { starts++; throw new Error("Connection lost after send"); }
  } };
  const queue = await MessageQueue.load(root, bridge);
  await queue.add({ threadId: "thread", clientUserMessageId: "message", input: [{ type: "text", text: "next" }] });
  await queue.pump("thread");
  assert.equal(starts, 0);
  status = "idle";
  await queue.pump("thread");
  assert.equal(starts, 1);
  const loaded = await MessageQueue.load(root, bridge);
  await loaded.pump("thread");
  assert.equal(starts, 1);
  assert.equal(loaded.data.entries.queued.state, "uncertain");
});
test("interrupted work pauses native queue advancement until the user starts another task", async (t) => {
  const { MessageQueue } = await import("../lib/message-queue.mjs");
  let starts = 0;
  const bridge = { async call(method) {
    if (method === "thread/read") return { thread: { status: { type: "idle" } } };
    if (method === "thread/queue/list") return { data: [{ id: "queued" }] };
    if (method === "thread/queue/start") { starts++; return {}; }
  } };
  const queue = await MessageQueue.load(await directory(t), bridge);
  queue.data.entries.queued = { threadId: "thread", state: "pending" };
  queue.observe({ method: "turn/completed", params: { threadId: "thread", turn: { status: "interrupted" } } });
  await queue.pump("thread");
  assert.equal(starts, 0);
  queue.observe({ method: "turn/started", params: { threadId: "thread" } });
  await queue.pump("thread");
  assert.equal(starts, 1);
});
