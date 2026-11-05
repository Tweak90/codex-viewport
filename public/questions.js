"use strict";
globalThis.codexQuestions = (() => {
  const items = new Map();
  const dialog = document.createElement("dialog");
  dialog.id = "question-dialog";
  dialog.className = "wide-dialog";
  dialog.innerHTML = `<div class="dialog-heading"><h2>${I18N.t("Codex hat eine Rückfrage")}</h2><button class="icon-button" type="button" id="question-close" aria-label="${I18N.t("Schließen")}">×</button></div><div id="question-content"></div><p id="question-error" class="form-error" role="alert"></p>`;
  document.body.append(dialog);
  I18N.capture(dialog);
  let currentThread = null, opened = null, nativeRequest = null, revision = 0;
  function pending() { return [...items.values()].filter((q) => q.threadId === state.thread?.id && q.state === "pending"); }
  function updateBadge() {
    const count = pending().length;
    $("open-questions").classList.toggle("hidden", !count);
    $("question-count").textContent = count || "";
  }
  function register(threadId, item) {
    if (item.type !== "agentMessage") return [];
    return (item.questions || []).map((q, index) => {
      const id = JSON.stringify(["request_user_input_async", item.id, index]);
      if (!items.has(id)) items.set(id, { id, threadId, itemId: item.id, title: q.title, options: q.options || [], state: "pending" });
      return items.get(id);
    });
  }
  function show(question) {
    if (!question || question.state !== "pending") return;
    opened = question.id;
    nativeRequest = null;
    $("question-error").textContent = "";
    $("question-content").innerHTML = `<form id="question-answer-form"><p class="question-title">${escapeHtml(question.title)}</p>${question.options.length ? `<fieldset class="question-options"><legend>${I18N.t("Antwort auswählen")}</legend>${question.options.map((option, index) => `<label class="question-option"><input type="radio" name="question-option" value="${escapeHtml(option)}" ${index === 0 ? "checked" : ""}>${escapeHtml(option)}</label>`).join("")}</fieldset>` : ""}<label for="question-free-answer">${I18N.t("Eigene Antwort")}<textarea id="question-free-answer" rows="4" placeholder="${I18N.t("Antwort eingeben …")}"></textarea></label><p class="muted">${I18N.t("Eigener Text hat Vorrang vor einer ausgewählten Option. Es wird erst nach dem Absenden eine Antwort übertragen.")}</p><div class="dialog-actions"><button type="button" class="subtle" id="question-later">${I18N.t("Später beantworten")}</button><button type="submit" class="accent-button" id="question-submit">${I18N.t("Antwort senden")}</button></div></form>`;
    if (!dialog.open) dialog.showModal();
    $("question-later").onclick = () => dialog.close();
    $("question-answer-form").onsubmit = async (event) => {
      event.preventDefault();
      const answer = $("question-free-answer").value.trim() || dialog.querySelector('input[name="question-option"]:checked')?.value;
      if (!answer) { $("question-error").textContent = I18N.t("Bitte beantworte die Rückfrage."); return; }
      question.state = "sending";
      $("question-submit").disabled = true;
      try {
        const result = await api(`/api/chats/${encodeURIComponent(question.threadId)}/questions`, { id: question.id, answer });
        for (const q of result.questions) items.set(q.id, q);
        dialog.close(); updateBadge(); renderChat();
        toast(I18N.t("Antwort gesendet."));
      } catch (error) {
        question.state = "uncertain";
        $("question-error").textContent = error.message;
        updateBadge();
      }
    };
  }
  async function syncView() {
    const threadId = state.thread?.id;
    if (!threadId || state.thread.draft || currentThread === threadId) return;
    currentThread = threadId;
    const version = ++revision;
    updateBadge();
    let cursor;
    try {
      for (let page = 0; page < 10 && version === revision; page++) {
        const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const value = await api(`/api/chats/${encodeURIComponent(threadId)}/questions${params}`);
        if (version !== revision) return;
        const changed = value.questions.some((q) => items.get(q.id)?.state !== q.state);
        for (const q of value.questions) items.set(q.id, q);
        updateBadge();
        if (changed) renderChat();
        cursor = value.nextCursor;
        if (!cursor) break;
      }
    } catch { /* The ordinary chat remains usable; incoming questions still appear. */ }
  }
  function handleEvent(message) {
    const { params: p = {}, method } = message;
    if (method === "item/completed" && p.item?.questions?.length) {
      const questions = register(p.threadId, p.item);
      updateBadge();
      if (p.threadId === state.thread?.id && !document.querySelector("dialog[open]")) show(questions.find((q) => q.state === "pending"));
    }
    if (method === "item/completed" && p.item?.type === "userMessage") {
      for (const content of p.item.content || []) for (const match of (content.text || "").matchAll(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g)) {
        try { for (const reply of JSON.parse(match[1])) { const q = items.get(reply.questionItemId); if (q) q.state = "sent"; if (reply.questionItemId === opened) dialog.close(); } } catch {}
      }
      updateBadge();
    }
    if ((method === "serverRequest/resolved" && String(p.requestId) === nativeRequest) || (method === "console/requestAnswered" && String(p.requestId) === nativeRequest)) dialog.close();
  }
  function cards(item) {
    const questions = register(state.thread?.id, item);
    return questions.map((q) => `<section class="async-question-card"><strong>${escapeHtml(q.title)}</strong><button type="button" class="subtle" data-open-question="${escapeHtml(q.id)}" ${q.state !== "pending" ? "disabled" : ""}>${q.state === "sent" ? I18N.t("Beantwortet") : q.state === "pending" ? I18N.t("Rückfrage beantworten") : I18N.t("Versand prüfen")}</button></section>`).join("");
  }
  function native(request, section) {
    if (!request || nativeRequest === String(request.id) || document.querySelector("dialog[open]")) return;
    nativeRequest = String(request.id); opened = null;
    $("question-error").textContent = "";
    $("question-content").innerHTML = section.outerHTML;
    dialog.showModal();
  }
  dialog.addEventListener("click", async (event) => {
    if (!nativeRequest || !event.target.closest("button[data-questions]")) return;
    try { await answerRequest(event); dialog.close(); }
    catch (error) { $("question-error").textContent = error.message; }
  });
  $("question-close").onclick = () => dialog.close();
  $("open-questions").onclick = () => show(pending()[0]);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-question]");
    if (button) show(items.get(button.dataset.openQuestion));
  });
  return {
    cards, native, handleEvent, syncView,
    leave() { currentThread = null; nativeRequest = null; ++revision; dialog.close(); $("open-questions").classList.add("hidden"); },
    logout() { items.clear(); currentThread = null; nativeRequest = null; opened = null; ++revision; dialog.close(); updateBadge(); },
  };
})();
