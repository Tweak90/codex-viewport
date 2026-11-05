import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson, httpError } from "./auth.mjs";

export class QuestionStore {
  static async load(directory, bridge) {
    const store = new QuestionStore(directory, bridge);
    try { store.data = JSON.parse(await readFile(store.filename, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return store;
  }
  constructor(directory, bridge) {
    this.filename = path.join(directory, "questions.json");
    this.bridge = bridge;
    this.data = { questions: {}, replies: {} };
    this.queue = Promise.resolve();
    this.sending = new Set();
  }
  save() {
    const data = JSON.stringify(this.data);
    const operation = this.queue.catch(() => {}).then(() => atomicJson(this.filename, JSON.parse(data)));
    this.queue = operation;
    return operation;
  }
  observe(threadId, item) {
    let changed = false;
    if (item.type === "agentMessage" && item.questions?.length) {
      item.questions.forEach((question, index) => {
        const id = JSON.stringify(["request_user_input_async", item.id, index]);
        if (!this.data.questions[id]) {
          this.data.questions[id] = { id, threadId, itemId: item.id, index, title: question.title, options: question.options || [] };
          changed = true;
        }
      });
    }
    if (item.type === "userMessage") for (const content of item.content || []) {
      for (const match of (content.text || "").matchAll(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g)) {
        try {
          for (const reply of JSON.parse(match[1])) if (typeof reply.questionItemId === "string" && this.data.replies[reply.questionItemId]?.state !== "sent") {
            this.data.replies[reply.questionItemId] = { state: "sent", at: Date.now() };
            changed = true;
          }
        } catch { /* Ordinary user text is not a structured answer. */ }
      }
    }
    return changed;
  }
  snapshot(threadId) {
    return Object.values(this.data.questions).filter((q) => q.threadId === threadId).map((q) => ({ ...q, state: this.data.replies[q.id]?.state || "pending" }));
  }
  async read(threadId, cursor) {
    const page = await this.bridge.call("thread/items/list", { threadId, limit: 20, sortDirection: "desc", ...(cursor ? { cursor } : {}) });
    let changed = false;
    for (const { item } of page.data) changed = this.observe(threadId, item) || changed;
    if (changed) await this.save();
    return { questions: this.snapshot(threadId), nextCursor: page.nextCursor || null };
  }
  async answer(threadId, id, answer) {
    const question = this.data.questions[id];
    if (!question || question.threadId !== threadId) throw httpError(404, "Diese Rückfrage ist nicht mehr verfügbar.");
    if (typeof answer !== "string" || !answer.trim() || answer.length > 20000)
      throw httpError(400, "Bitte beantworte die Rückfrage.");
    if (this.data.replies[id] || this.sending.has(id))
      throw httpError(409, "Für diese Rückfrage wurde bereits eine Antwort gesendet oder der Versand konnte nicht bestätigt werden. Bitte den Chatverlauf prüfen.");
    this.sending.add(id);
    try {
      this.data.replies[id] = { state: "sending", at: Date.now() };
      await this.save();
      const payload = JSON.stringify([{ questionItemId: id, question: question.title, answer: answer.trim() }]).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
      try {
        await this.bridge.call("turn/start", { threadId, input: [{ type: "text", text: `<send_user_message_question_reply>\n${payload}\n</send_user_message_question_reply>`, text_elements: [] }] });
      } catch (error) {
        if (this.data.replies[id]?.state === "sent") return { questions: this.snapshot(threadId) };
        this.data.replies[id] = { state: "uncertain", at: Date.now() };
        await this.save();
        throw httpError(502, "Der Versand der Antwort konnte nicht bestätigt werden. Sie wird nicht erneut gesendet. Bitte den Chatverlauf prüfen.");
      }
      this.data.replies[id] = { state: "sent", at: Date.now() };
      await this.save();
      return { questions: this.snapshot(threadId) };
    } finally { this.sending.delete(id); }
  }
}
