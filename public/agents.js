"use strict";
globalThis.codexAgents = (() => {
  let view = null, pollTimer, eventTimer;
  const current = (v) => v && view === v && state.authenticated && state.view === "agents" && state.openVersion === v.version && selectedProject()?.id === v.project.id;
  const active = (agent) => agent.status?.type === "active";
  const name = (agent) => agent.name || agent.preview?.slice(0, 80) || I18N.t("Agent");
  function status(agent) {
    const flags = agent.status?.activeFlags || [];
    if (flags.includes("waitingOnApproval")) return I18N.t("Wartet auf Freigabe");
    if (flags.includes("waitingOnUserInput")) return I18N.t("Wartet auf Eingabe");
    if (active(agent)) return I18N.t("Aktiv");
    if (agent.status?.type === "systemError") return I18N.t("Fehler");
    if (agent.status?.type === "notLoaded") return I18N.t("Nicht geladen");
    return I18N.t("Inaktiv");
  }
  function renderList() {
    const v = view;
    if (!current(v)) return;
    const query = v.search.toLocaleLowerCase(I18N.locale);
    const agents = v.agents.filter((a) => (v.filter === "all" || (v.filter === "active") === active(a)) &&
      `${name(a)} ${a.role} ${a.preview}`.toLocaleLowerCase(I18N.locale).includes(query));
    $("agent-list").innerHTML = agents.map((a) => `<button type="button" class="agent-list-item ${a.id === v.selected ? "selected" : ""}" data-agent-id="${escapeHtml(a.id)}" aria-pressed="${a.id === v.selected}"><strong>${escapeHtml(name(a))}</strong><span class="agent-list-meta"><span class="agent-status ${active(a) ? "is-active" : ""}">${escapeHtml(status(a))}</span>${a.archived ? `<span>${I18N.t("Archiviert")}</span>` : ""}${a.role ? `<span>${escapeHtml(a.role)}</span>` : ""}</span><small>${escapeHtml(a.preview.slice(0, 140))}</small></button>`).join("") || `<p class="empty-list">${v.listBusy ? I18N.t("Agents werden geladen …") : v.agents.length ? I18N.t("Keine Agents für diesen Filter.") : I18N.t("Noch keine Agents in diesem Projekt.")}</p>`;
    $("agent-list-count").textContent = `${agents.length} / ${v.agents.length}`;
    $("agents-more").hidden = !v.cursor;
    $("agents-more").disabled = v.listBusy;
    $("agents-refresh").disabled = v.listBusy;
    for (const button of $("agents-filters").querySelectorAll("[data-agents-filter]"))
      button.setAttribute("aria-pressed", String(button.dataset.agentsFilter === v.filter));
  }
  function outputHtml(item, agent) {
    const id = `agent:${agent.id}:${item.id}`;
    if (item.type === "agentMessage" || item.type === "plan")
      return `<article class="message assistant"><div class="message-label">${escapeHtml(item.type === "plan" ? "Plan" : name(agent))}</div><div class="message-body">${outputPreview(item.text || "", id, true)}</div></article>`;
    if (item.type === "userMessage") {
      const text = (item.content || []).map((c) => c.text || c.path || "").filter(Boolean).join("\n");
      return `<details class="activity agent-task"><summary>${I18N.t("Auftrag / Eingabe")}</summary>${outputPreview(text, id)}</details>`;
    }
    if (item.type === "imageGeneration") {
      if (item.failure) return `<p class="form-error">${escapeHtml(item.failure.message || I18N.t("Bildgenerierung fehlgeschlagen:"))}</p>`;
      if (!item.consoleImageAvailable && !item.result && !item.savedPath && !item.path && !item.fileId && item.status !== "completed")
        return `<p class="muted">${I18N.t("Das Bild wird bereitgestellt …")}</p>`;
      const params = new URLSearchParams({ threadId: agent.id, itemId: item.id });
      if (item.savedPath || item.path) params.set("path", item.savedPath || item.path);
      return imageMarkup(`/api/media?${params}`, item.revisedPrompt || I18N.t("Generiertes Bild"));
    }
    return itemHtml({ ...item, id });
  }
  function renderOutput() {
    const v = view;
    if (!current(v)) return;
    const box = $("agent-output");
    const agent = v.detail?.agent;
    if (!agent) {
      box.innerHTML = `<p class="empty-list">${v.detailBusy ? I18N.t("Agent-Ausgaben werden geladen …") : I18N.t("Wähle einen Agent, um seine Ausgaben zu lesen.")}</p>`;
      return;
    }
    const previousTop = box.scrollTop, previousHeight = box.scrollHeight;
    const nearBottom = previousHeight - previousTop - box.clientHeight < 80;
    const previous = new Map([...box.querySelectorAll(":scope > [data-agent-item]")].map((n) => [n.dataset.agentItem, n]));
    const template = document.createElement("template");
    template.innerHTML = v.turns.flatMap((turn) => [
      ...(turn.items || []).map((item) => `<div data-agent-item="${escapeHtml(`${turn.id}:${item.id}`)}">${outputHtml(item, agent)}</div>`),
      ...(turn.error?.message ? [`<p class="form-error">${escapeHtml(turn.error.message)}</p>`] : []),
    ]).join("") || `<p class="empty-list">${I18N.t("Dieser Agent hat noch keine Ausgaben gespeichert.")}</p>`;
    const nodes = [...template.content.children].map((node) => {
      const old = previous.get(node.dataset.agentItem);
      if (old?.renderedMarkup === node.outerHTML) return old;
      const details = [...(old?.querySelectorAll("details") || [])].map((d) => d.open);
      [...node.querySelectorAll("details")].forEach((d, index) => { if (details[index] !== undefined) d.open = details[index]; });
      node.renderedMarkup = node.outerHTML;
      return node;
    });
    box.replaceChildren(...nodes);
    for (const link of box.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      if (isLocalImage(href)) { link.href = imageUrl(href); link.dataset.image = "true"; }
      link.target = "_blank"; link.rel = "noopener noreferrer";
    }
    box.scrollTop = v.prepending ? previousTop + box.scrollHeight - previousHeight : nearBottom ? box.scrollHeight : previousTop;
  }
  function renderDetail() {
    const v = view;
    if (!current(v)) return;
    const agent = v.detail?.agent;
    $("agent-detail-title").textContent = agent ? name(agent) : I18N.t("Agent-Ausgaben");
    $("agent-detail-status").textContent = agent ? status(agent) : "";
    $("agent-parent").hidden = !v.detail?.parent;
    $("agent-parent").textContent = v.detail?.parent ? `${I18N.t("Übergeordneten Chat öffnen")} · ${v.detail.parent.name || I18N.t("Chat")}` : "";
    $("agent-history-more").hidden = !v.historyCursor;
    $("agent-history-more").disabled = v.detailBusy;
    renderOutput();
  }
  async function loadDetail(id, { more = false, quiet = false } = {}) {
    const v = view;
    if (!current(v) || (v.detailBusy && id === v.selected)) return;
    const request = ++v.detailVersion;
    if (v.selected !== id) {
      v.selected = id; v.turns = []; v.detail = null; v.historyCursor = null; v.historyMoreLoaded = false;
    }
    v.detailBusy = true;
    $("agent-detail-error").textContent = "";
    renderList(); renderDetail();
    try {
      const cursor = more ? `?cursor=${encodeURIComponent(v.historyCursor)}` : "";
      const result = await api(`/api/projects/${encodeURIComponent(v.project.id)}/agents/${encodeURIComponent(id)}${cursor}`);
      if (!current(v) || request !== v.detailVersion) return;
      v.detail = result;
      if (more) {
        v.turns = [...result.data.map((turn) => mergeHistoryTurn(turn, v.turns.find((old) => old.id === turn.id))), ...v.turns.filter((turn) => !result.data.some((old) => old.id === turn.id))];
        v.historyMoreLoaded = true;
      } else {
        v.turns = [...v.turns.map((turn) => mergeHistoryTurn(turn, result.data.find((next) => next.id === turn.id))), ...result.data.filter((turn) => !v.turns.some((old) => old.id === turn.id))];
      }
      if (more || !quiet || !v.historyMoreLoaded) v.historyCursor = result.nextCursor;
      v.prepending = more;
    } catch (error) {
      if (current(v) && request === v.detailVersion) $("agent-detail-error").textContent = error.message;
    } finally {
      if (current(v) && request === v.detailVersion) {
        v.detailBusy = false; renderDetail(); v.prepending = false;
      }
    }
  }
  async function loadList({ more = false, quiet = false } = {}) {
    const v = view;
    if (!current(v) || v.listBusy) return;
    v.listBusy = true;
    $("agents-error").textContent = "";
    renderList();
    try {
      const cursor = more ? `?cursor=${encodeURIComponent(v.cursor)}` : "";
      const result = await api(`/api/projects/${encodeURIComponent(v.project.id)}/agents${cursor}`);
      if (!current(v)) return;
      v.agents = more ? [...v.agents, ...result.data.filter((a) => !v.agents.some((old) => old.id === a.id))] : quiet ? [...result.data, ...v.agents.filter((a) => !result.data.some((next) => next.id === a.id))] : result.data;
      if (more) v.moreLoaded = true;
      if (more || !quiet || !v.moreLoaded) v.cursor = result.nextCursor;
      if (!v.selected && v.agents.length) loadDetail(v.agents[0].id);
    } catch (error) {
      if (current(v)) $("agents-error").textContent = error.message;
    } finally {
      if (current(v)) { v.listBusy = false; renderList(); }
    }
  }
  async function refresh() {
    const v = view;
    if (!current(v) || document.hidden) return;
    await loadList({ quiet: true });
    if (current(v) && v.selected) await loadDetail(v.selected, { quiet: true });
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await refresh(); if (current(view)) schedulePoll(); }, 8000);
  }
  async function show(project) {
    if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
    if (!canLeaveEditor()) return;
    $("show-archived").checked = false;
    chooseProject(project.path, "agents");
    $("tools").classList.add("hidden");
    view = { project, version: state.openVersion, agents: [], cursor: null, selected: null, detail: null, turns: [], historyCursor: null, filter: "all", search: "", detailVersion: 0 };
    $("chat").innerHTML = `<section class="project-agents" data-agents-project="${escapeHtml(project.id)}"><header class="overview-heading"><div><div class="eyebrow">${escapeHtml(project.name)}</div><h1>Agents</h1><p>${I18N.t("Aktive und bisherige Agents dieses Projekts mit ihren gespeicherten Ausgaben.")}</p></div><button type="button" class="subtle" id="agents-refresh">${I18N.t("Aktualisieren ↻")}</button></header><div class="agents-toolbar"><div id="agents-filters" class="agents-filters"><button type="button" data-agents-filter="all" aria-pressed="true">${I18N.t("Alle")}</button><button type="button" data-agents-filter="active" aria-pressed="false">${I18N.t("Aktiv")}</button><button type="button" data-agents-filter="past" aria-pressed="false">${I18N.t("Bisherige")}</button></div><input id="agent-search" type="search" placeholder="${I18N.t("Agents durchsuchen …")}" aria-label="${I18N.t("Agents durchsuchen …")}"></div><p id="agents-error" class="form-error" role="alert"></p><div class="agent-workbench"><aside class="agent-browser"><div class="agent-browser-heading"><strong>Agents</strong><small id="agent-list-count"></small></div><div id="agent-list"></div><button id="agents-more" class="subtle" type="button" hidden>${I18N.t("Weitere Agents laden")}</button></aside><section class="agent-detail"><header><h2 id="agent-detail-title">${I18N.t("Agent-Ausgaben")}</h2><span class="agent-status" id="agent-detail-status"></span></header><button type="button" id="agent-parent" class="subtle" hidden></button><p id="agent-detail-error" class="form-error" role="alert"></p><button id="agent-history-more" class="subtle" type="button" hidden>${I18N.t("Ältere Ausgaben laden")}</button><div id="agent-output"></div></section></div></section>`;
    $("agents-refresh").onclick = safe(async () => { await loadList(); if (current(view) && view.selected) await loadDetail(view.selected, { quiet: true }); });
    $("agents-more").onclick = safe(() => loadList({ more: true }));
    $("agent-history-more").onclick = safe(() => loadDetail(view.selected, { more: true }));
    $("agent-parent").onclick = safe(() => view.detail.parent.isAgent ? loadDetail(view.detail.parent.id) : openThread(view.detail.parent.id));
    $("agent-list").onclick = safe((event) => { const button = event.target.closest("[data-agent-id]"); if (button) return loadDetail(button.dataset.agentId); });
    $("agents-filters").onclick = (event) => { const button = event.target.closest("[data-agents-filter]"); if (button) { view.filter = button.dataset.agentsFilter; renderList(); } };
    $("agent-search").oninput = (event) => { view.search = event.target.value; renderList(); };
    renderDetail();
    await loadList();
    if (current(view)) schedulePoll();
  }
  return {
    show, renderOutput,
    leave() { view = null; clearTimeout(pollTimer); clearTimeout(eventTimer); },
    handleEvent({ method, params = {} }) {
      if (!current(view)) return;
      if (method === "thread/status/changed") {
        const agent = view.agents.find((a) => a.id === params.threadId);
        if (agent) { agent.status = params.status; renderList(); }
      }
      if (["thread/started", "thread/status/changed", "turn/completed", "item/completed"].includes(method)) {
        clearTimeout(eventTimer); eventTimer = setTimeout(refresh, 400);
      }
    },
  };
})();
