"use strict";
globalThis.codexQueue = (() => {
  let thread = null, revision = 0, loading = false, refreshAgain = false;
  async function refresh() {
    const id = state.thread?.id;
    if (!id || state.thread.draft) return;
    if (loading) { refreshAgain = true; return; }
    const version = revision;
    loading = true;
    try {
      const result = await rpc("thread/queue/list", { threadId: id, limit: 100 });
      if (version !== revision || state.thread?.id !== id) return;
      const messages = result.data || [];
      $("message-queue").classList.toggle("hidden", !messages.length);
      $("message-queue-summary").textContent = `${I18N.t("Warteschlange")} (${messages.length})`;
      $("message-queue-items").innerHTML = messages.map((entry) => `<li>${escapeHtml(entry.input.map((item) => item.text || item.path || I18N.t("Bild")).join(" ").slice(0, 300))}</li>`).join("");
    } catch { /* Do not block chat navigation when the optional queue read fails. */ }
    finally {
      loading = false;
      if (refreshAgain || (version !== revision && thread)) { refreshAgain = false; refresh(); }
    }
  }
  return {
    refresh,
    syncView() {
      if (thread !== state.thread?.id) { thread = state.thread?.id; ++revision; refresh(); }
    },
    handleEvent({ method, params = {} }) {
      if (params.threadId === state.thread?.id && ["thread/queue/changed", "turn/completed"].includes(method)) refresh();
    },
    leave() { thread = null; ++revision; $("message-queue").classList.add("hidden"); },
  };
})();
