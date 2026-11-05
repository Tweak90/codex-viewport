"use strict";
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const md = (text) => renderMarkdown(text);
const shortName = (pathname) =>
  pathname?.split("/").filter(Boolean).at(-1) || pathname || I18N.t("Projekt");
const joinPath = (a, b) => `${a.replace(/\/$/, "")}/${b}`;
const parentPath = (value) =>
  value.replace(/\/$/, "").split("/").slice(0, -1).join("/") || "/";
const folderIcon =
  '<svg class="folder-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 5a1 1 0 0 1 1-1H8l2 2h6.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const state = {
  authenticated: false,
  csrf: null,
  drafts: [],
  hiddenPaths: [],
  threadProjects: {},
  projectRoot: "",
  archiveSelection: new Set(),
  media: [],
  mediaProjectId: null,
  projectPreviews: new Map(),
  mediaFilter: "all",
  expandedOutputs: new Set(),
  view: "chat",
  connected: false,
  threads: [],
  projects: [],
  bookmarks: [],
  models: [],
  project: localStorage.getItem("codex.project") || "",
  thread: null,
  turns: [],
  olderCursor: null,
  historyRequest: null,
  historyLoaded: false,
  historyError: "",
  openingChat: false,
  resumeRequest: null,
  lastChatScrollTop: 0,
  threadCursor: null,
  requests: new Map(),
  diffs: new Map(),
  directory: "",
  editorPath: "",
  editorOriginal: "",
  terminalProcess: null,
  terminalDecoder: new TextDecoder(),
  booting: false,
  pendingSend: false,
  sendWith: "shiftEnter",
  followupMode: "steer",
  returnChat: null,
  openVersion: 0,
  tab: "files",
};
const welcome = $("chat").innerHTML;
function welcomeHtml() { return I18N.html(welcome); }

async function api(url, body, method = "POST") {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(state.csrf ? { "X-CSRF-Token": state.csrf } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (response.status === 401 && !url.startsWith("/api/auth/"))
    showAuth({ configured: true });
  if (!response.ok)
    throw new Error(value.error || I18N.t("Die Anfrage ist fehlgeschlagen"));
  return value;
}
const rpc = async (method, params = {}) =>
  (await api("/api/rpc", { method, params })).result;
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.add("hidden"), 5500);
}
function safe(handler) {
  return (...args) => {
    // Invoke synchronously: submit.preventDefault must run before the browser's
    // native form action, including requestSubmit() called from an Enter key.
    try {
      return Promise.resolve(handler(...args)).catch((error) =>
        toast(error.message),
      );
    } catch (error) {
      toast(error.message);
    }
  };
}
function projectSnapshot(info) {
  if (info.followupMode) state.followupMode = info.followupMode;
  if (info.sendWith) state.sendWith = info.sendWith;
  updateSendShortcut();
  if (info.projects) state.bookmarks = info.projects;
  if (info.drafts) state.drafts = info.drafts;
  if (info.hiddenPaths) state.hiddenPaths = info.hiddenPaths;
  if (info.threadProjects) state.threadProjects = info.threadProjects;
  if (info.projectRoot) state.projectRoot = info.projectRoot;
  buildProjects();
}
function selectedProject() {
  return state.projects.find((p) => p.path === state.project);
}
function threadProjectId(thread) {
  return state.threadProjects[thread.id] || thread.projectId;
}
function visibleThreads() {
  const archived = $("show-archived").checked;
  const all = [
    ...state.threads,
    ...(globalThis.codexFeatures?.pinnedArchive === $("show-archived").checked
      ? globalThis.codexFeatures.pinnedThreads
      : []
    ).filter((t) => !state.threads.some((other) => other.id === t.id)),
    ...state.drafts.filter(
      (d) =>
        Boolean(d.archived) === archived &&
        !state.threads.some((t) => t.id === d.id),
    ),
  ];
  const project = selectedProject(),
    search = $("search").value.toLocaleLowerCase();
  return all
    .filter(
      (t) =>
        (!project || threadProjectId(t) === project.id) &&
        (!search ||
          (t.name || t.preview || "").toLocaleLowerCase().includes(search)) &&
        (archived || !state.hiddenPaths.includes(t.cwd)),
    )
    .sort(
      (a, b) =>
        Number(globalThis.codexFeatures?.pins?.includes(b.id)) -
          Number(globalThis.codexFeatures?.pins?.includes(a.id)) ||
        b.updatedAt - a.updatedAt,
    );
}
function setConnection(status) {
  const reconnected = !state.connected && status.connected;
  state.connected = status.connected;
  state.connectionInfo = status;
  $("status-connection").textContent = status.connected
    ? I18N.t("✓ KI-VM verbunden")
    : I18N.t("◌ KI-VM wird verbunden …");
  $("host-dot").classList.toggle("connected", status.connected);
  $("live-pill").classList.toggle("connected", status.connected);
  $("live-pill").textContent = status.connected ? I18N.t("API VERBUNDEN") : "OFFLINE";
  $("connection-label").textContent = status.connected
    ? I18N.t("Codex verbunden · API")
    : I18N.t("Verbindung wird aufgebaut …");
  $("connection-error").classList.toggle(
    "hidden",
    status.connected || !status.error,
  );
  $("connection-error").textContent = status.error
    ? `${I18N.t("Codex nicht erreichbar:")} ${I18N.t(status.error)}${I18N.t(". Die Verbindung wird automatisch erneut versucht.")}`
    : "";
  updateComposer();
  if (reconnected) boot().catch((error) => toast(error.message));
}
function connectEvents() {
  if (
    !state.authenticated ||
    state.eventSocket?.readyState === WebSocket.OPEN ||
    state.eventSocket?.readyState === WebSocket.CONNECTING
  )
    return;
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`,
  );
  state.eventSocket = socket;
  socket.onmessage = (event) => {
    try {
      handleEvent(JSON.parse(event.data));
    } catch (error) {
      console.error("Codex event:", error);
    }
  };
  socket.onclose = (event) => {
    if (!state.authenticated) return;
    if (event.code === 4001) {
      showAuth({ configured: true });
      return;
    }
    setConnection({
      ...state.connectionInfo,
      connected: false,
      error: I18N.t("Weboberfläche wurde getrennt"),
    });
    setTimeout(connectEvents, 1500);
  };
  socket.onerror = () => socket.close();
}
async function boot() {
  if (state.booting) return;
  state.booting = true;
  try {
    const info = await api("/api/state");
    projectSnapshot(info);
    $("host-label").textContent = info.hostLabel;
    for (const request of info.requests)
      state.requests.set(String(request.id), request);
    const results = await Promise.allSettled([
      refreshThreads(),
      rpc("model/list"),
    ]);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") toast(results[i].reason.message);
      else if (i === 1) {
        state.models = results[i].value.data;
        const selected =
          state.thread?.model ||
          localStorage.getItem("codex.model") ||
          state.models.find((m) => m.isDefault)?.model;
        $("model").innerHTML = state.models
          .map(
            (m) =>
              `<option value="${escapeHtml(m.model)}">${escapeHtml(m.displayName || m.model)}</option>`,
          )
          .join("");
        if (state.models.some((m) => m.model === selected))
          $("model").value = selected;
        updateEfforts();
      }
    }
    if (state.thread) await openThread(state.thread.id);
    else {
      const saved = localStorage.getItem("codex.thread");
      if (
        saved &&
        [...state.threads, ...state.drafts].some((t) => t.id === saved)
      )
        await openThread(saved);
    }
    if (!state.thread && state.view === "chat") clearChat();
    renderRequests();
  } finally {
    state.booting = false;
    updateComposer();
  }
}
async function refreshThreads(more = false) {
  const listVersion = (state.listVersion = (state.listVersion || 0) + 1);
  const archived = $("show-archived").checked;
  const result = await rpc("thread/list", {
    limit: 100,
    sortKey: "updated_at",
    modelProviders: [],
    sourceKinds: ["cli", "vscode", "appServer", "exec"],
    archived: $("show-archived").checked,
    ...(more && state.threadCursor ? { cursor: state.threadCursor } : {}),
  });
  if (
    listVersion !== state.listVersion ||
    archived !== $("show-archived").checked
  )
    return;
  projectSnapshot(result);
  state.threadCursor = result.nextCursor;
  state.threads = more
    ? [
        ...state.threads,
        ...result.data.filter((t) => !state.threads.some((x) => x.id === t.id)),
      ]
    : result.data;
  $("more-threads").classList.toggle("hidden", !state.threadCursor);
  buildProjects();
  renderSidebar();
  if (globalThis.codexFeatures?.pins.length)
    globalThis.codexFeatures.refreshPins().catch(() => {});
}
function buildProjects() {
  state.projects = [...state.bookmarks];
  if (state.project && !state.projects.some((p) => p.path === state.project))
    state.project = "";
  renderProjectHeader();
}
function renderSidebar() {
  const all = [...state.threads, ...state.drafts.filter((d) => !d.archived)];
  const counts = new Map();
  for (const t of all)
    counts.set(threadProjectId(t), (counts.get(threadProjectId(t)) || 0) + 1);
  $("project-list").innerHTML =
    `<button class="project ${!state.project ? "active" : ""}" data-project=""><span class="folder">${folderIcon}</span><span class="project-name">${I18N.t("Alle Projekte")}</span></button>` +
    state.projects
      .map(
        (p) =>
          `<div class="project-row" data-project-row="${escapeHtml(p.id)}"><button type="button" class="project ${state.project === p.path ? "active" : ""}" data-project="${escapeHtml(p.path)}" title="${escapeHtml(p.path)}"><span class="folder">${folderIcon}</span><span class="project-name">${escapeHtml(p.name)}</span><span class="count">${counts.get(p.id) || ""}</span></button><button type="button" class="row-more" data-project-menu="${escapeHtml(p.id)}" aria-label="${I18N.t("Projektmenü")} ${escapeHtml(p.name)}">⋯</button></div>`,
      )
      .join("");
  const threads = visibleThreads(),
    archived = $("show-archived").checked;
  $("thread-count").textContent = threads.length || "";
  $("thread-list").innerHTML =
    threads
      .map((t) => {
        const pending = [...state.requests.values()].some(
            (r) => r.params.threadId === t.id,
          ),
          project = state.projects.find((p) => p.id === threadProjectId(t));
        return `<div class="thread-row" data-thread-row="${escapeHtml(t.id)}">${archived ? `<input class="archive-check" type="checkbox" data-archive-select="${escapeHtml(t.id)}" aria-label="${I18N.t("Chat auswählen")}" ${state.archiveSelection.has(t.id) ? "checked" : ""}>` : ""}<button type="button" class="thread ${state.thread?.id === t.id ? "active" : ""}" data-thread="${escapeHtml(t.id)}"><span class="thread-title">${escapeHtml(t.name || t.preview?.slice(0, 90) || I18N.t("Neuer Chat"))}</span><span class="thread-meta">${pending ? I18N.t("Eingabe erforderlich") : t.status?.type === "active" ? `<span class="tiny-dot"></span> ${I18N.t("Arbeitet")}` : escapeHtml(project?.name || shortName(t.cwd))} · ${t.draft ? I18N.t("Entwurf") : new Date(t.updatedAt * 1000).toLocaleDateString(I18N.locale, { day: "2-digit", month: "short" })}</span></button><button type="button" class="row-more" data-thread-menu="${escapeHtml(t.id)}" aria-label="${I18N.t("Chatmenü")}">⋯</button></div>`;
      })
      .join("") ||
    '<div class="empty-list">' +
      (archived
        ? I18N.t("Keine archivierten Chats.")
        : I18N.t("Noch keine Chats. Starte einen Chat in einem Projekt.")) +
      "</div>";
  $("open-archive").classList.toggle("active", archived);
  $("archive-toolbar").classList.toggle("hidden", !archived);
  updateArchiveSelection();
  if (archived && !state.thread) renderArchiveDashboard();
  else if (["project", "chats"].includes(state.view) && !state.thread)
    renderProjectOverview();
}
function renderProjectHeader() {
  const project = state.projects.find((p) => p.path === state.project);
  $("project-title").textContent =
    project?.name ||
    (state.project ? shortName(state.project) : I18N.t("Alle Projekte"));
  $("cwd-hint").textContent =
    state.project || I18N.t("Wähle ein Projekt, um loszulegen.");
  $("project-title").title = state.project;
  $("status-project").textContent = project?.name || I18N.t("Kein Projekt ausgewählt");
}
function editorDirty() {
  return state.editorPath && $("file-content").value !== state.editorOriginal;
}
function canLeaveEditor() {
  return (
    !editorDirty() ||
    confirm(I18N.t("Die Datei hat ungespeicherte Änderungen. Änderungen verwerfen?"))
  );
}
function chooseProject(project, view) {
  if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
  if (project !== state.project && !canLeaveEditor()) return;
  if (project !== state.project) state.returnChat = null;
  else if (state.thread) state.returnChat = { id: state.thread.id, project, archived: $("show-archived").checked };
  state.project = project;
  const selected = selectedProject();
  if (selected) state.projectPreviews.delete(selected.id);
  localStorage.setItem("codex.project", project);
  clearChat(view);
  state.directory = project;
  state.editorPath = "";
  $("editor").classList.add("hidden");
  buildProjects();
  renderSidebar();
  if (!$("tools").classList.contains("hidden"))
    refreshTool().catch((e) => toast(e.message));
}
function clearChat(view) {
  globalThis.codexAgents?.leave();
  globalThis.codexQuestions?.leave();
  globalThis.codexQueue?.leave();
  globalThis.codexFeatures?.leaveChat();
  state.view =
    view ||
    (selectedProject() && !$("show-archived").checked ? "project" : "chat");
  state.mediaProjectId = null;
  state.media = [];
  ++state.openVersion;
  state.thread = null;
  state.turns = [];
  state.olderCursor = null;
  state.historyRequest = null;
  state.historyLoaded = false;
  state.historyError = "";
  state.openingChat = false;
  state.creatingChat = null;
  state.historyFocus = null;
  state.resumeRequest = null;
  localStorage.removeItem("codex.thread");
  $("chat").innerHTML = welcomeHtml();
  $("prompt").value = "";
  renderSidebar();
  renderRequests();
  updateComposer();
  $("sidebar").classList.remove("open");
}
async function newChat(projectId) {
  if (state.creatingChat) return state.creatingChat.promise;
  if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
  const project =
    typeof projectId === "string"
      ? state.projects.find((p) => p.id === projectId)
      : selectedProject();
  if (!project) {
    showProjectPicker();
    return;
  }
  if (!canLeaveEditor()) return;
  $("show-archived").checked = false;
  state.project = project.path;
  localStorage.setItem("codex.project", project.path);
  const creation = { version: state.openVersion };
  state.creatingChat = creation;
  updateComposer();
  creation.promise = (async () => {
    try {
      const result = await api(
        `/api/projects/${encodeURIComponent(project.id)}/chats`,
        {},
      );
      projectSnapshot(result);
      if (creation.version === state.openVersion)
        await openThread(result.thread.id);
      return result.thread;
    } finally {
      if (state.creatingChat === creation) state.creatingChat = null;
      updateComposer();
      $("prompt").focus();
    }
  })();
  return creation.promise;
}
async function openThread(id, options = {}) {
  if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
  if (!canLeaveEditor()) return;
  globalThis.codexAgents?.leave();
  globalThis.codexQuestions?.leave();
  globalThis.codexQueue?.leave();
  globalThis.codexFeatures?.leaveChat();
  if (options.archived !== undefined)
    $("show-archived").checked = options.archived;
  state.view = "chat";
  const version = ++state.openVersion;
  const draft = state.drafts.find((d) => d.id === id);
  state.historyFocus = options.itemId
    ? { itemId: options.itemId, cursor: options.cursor || null }
    : null;
  state.thread = draft || getThread(id) || null;
  state.turns = [];
  state.olderCursor = null;
  state.historyLoaded = Boolean(draft);
  state.historyError = "";
  state.historyRequest = null;
  state.resumeRequest = null;
  state.openingChat = true;
  $("chat").innerHTML =
    `<div class="history-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span> ${I18N.t("Chat wird geladen …")}</div>`;
  $("sidebar").classList.remove("open");
  updateComposer();
  try {
    const result = draft
      ? { thread: draft, cwd: draft.cwd }
      : await rpc("thread/read", {
          threadId: id,
          includeTurns: false,
        });
    if (version !== state.openVersion) return;
    const project = state.projects.find(
      (p) => p.id === threadProjectId(result.thread),
    );
    const cwd = project?.path || result.cwd || result.thread.cwd;
    state.thread = {
      ...result.thread,
      model: result.model || $("model").value,
    };
    state.project = project?.path || "";
    state.returnChat = { id, project: state.project, archived: $("show-archived").checked };
    state.directory = cwd;
    state.editorPath = "";
    $("editor").classList.add("hidden");
    localStorage.setItem("codex.project", state.project);
    localStorage.setItem("codex.thread", id);
    if (state.models.some((m) => m.model === result.model))
      $("model").value = result.model;
    updateEfforts(result.reasoningEffort);
    buildProjects();
    renderSidebar();
    renderRequests();
    globalThis.codexFeatures?.openChat(state.thread);
    if (draft) {
      $("chat").innerHTML =
        `<div class="welcome"><div class="eyebrow">${escapeHtml(project?.name || I18N.t("PROJEKT"))}</div><h1>${I18N.t("Ein neuer Gedanke.")}</h1><p>${I18N.t("Dieser Chat gehört zu")} ${escapeHtml(project?.name || I18N.t("deinem Projekt"))}.<br>${I18N.t("Gib Codex einen Auftrag, um loszulegen.")}</p><div class="welcome-note">${escapeHtml(cwd)}</div></div>`;
      updateComposer();
    } else {
      // Resume subscribes to live events, but MCP startup must not block history.
      if (!$("show-archived").checked) resumeChat(id, version);
      await loadHistory(false, version);
    }
    if (version !== state.openVersion) return;
    globalThis.codexFeatures?.focusHistory();
    if (!$("tools").classList.contains("hidden"))
      refreshTool().catch((error) => {
        if (version === state.openVersion) toast(error.message);
      });
  } catch (error) {
    if (version === state.openVersion)
      $("chat").innerHTML =
        `<div class="history-loading"><p>${escapeHtml(error.message)}</p><button type="button" class="subtle" data-reopen-thread="${escapeHtml(id)}">${I18N.t("Chat erneut öffnen")}</button></div>`;
  } finally {
    if (version === state.openVersion) {
      state.openingChat = false;
      updateComposer();
    }
  }
}

function resumeChat(id, version) {
  const selectedModel = $("model").value;
  const request = { threadId: id, version };
  request.promise = rpc("thread/resume", {
    threadId: id,
    excludeTurns: true,
  }).then((result) => {
    if (version !== state.openVersion || state.thread?.id !== id) return;
    state.thread = {
      ...state.thread,
      ...result.thread,
      model: result.model || state.thread.model,
    };
    if (
      $("model").value === selectedModel &&
      state.models.some((model) => model.model === result.model)
    ) {
      $("model").value = result.model;
      updateEfforts(result.reasoningEffort);
    }
    updateComposer();
  });
  state.resumeRequest = request;
  request.promise.catch((error) => {
    if (version === state.openVersion && state.thread?.id === id)
      toast(`${I18N.t("Chat konnte nicht verbunden werden:")} ${error.message}`);
  });
}

function mergeHistoryTurn(incoming, current) {
  if (!current) return incoming;
  const items = [...(incoming.items || [])];
  for (const item of current.items || []) {
    const index = items.findIndex((other) => other.id === item.id);
    if (index < 0) items.push(item);
    else {
      const previous = items[index];
      items[index] = { ...previous, ...item };
      for (const key of ["text", "aggregatedOutput"])
        if ((previous[key]?.length || 0) > (item[key]?.length || 0))
          items[index][key] = previous[key];
    }
  }
  return { ...incoming, ...current, items };
}
async function loadHistory(older = false, version = state.openVersion) {
  const id = state.thread?.id;
  if (
    !id ||
    version !== state.openVersion ||
    state.historyRequest ||
    (older && !state.olderCursor)
  )
    return;
  const request = { id, version };
  const cursor = older ? state.olderCursor : state.historyFocus?.cursor || null;
  state.historyRequest = request;
  state.historyError = "";
  if (older) renderChat(false, true);
  try {
    const result = await api(
      `/api/chats/${encodeURIComponent(id)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}${!older && state.historyFocus ? "&focus=1" : ""}` : ""}`,
    );
    if (version !== state.openVersion || state.thread?.id !== id) return;
    state.olderCursor = result.nextCursor;
    state.historyLoaded = true;
    const incoming = result.data.map((turn) =>
      mergeHistoryTurn(
        turn,
        state.turns.find((current) => current.id === turn.id),
      ),
    );
    state.turns = [
      ...incoming,
      ...state.turns.filter(
        (turn) => !incoming.some((other) => other.id === turn.id),
      ),
    ];
  } catch (error) {
    if (version === state.openVersion && state.thread?.id === id)
      state.historyError = error.message;
  } finally {
    if (state.historyRequest === request) {
      state.historyRequest = null;
      renderChat(!older, older);
      updateComposer();
    }
  }
}
function activeTurn() {
  return state.turns.findLast((t) => t.status === "inProgress");
}
function updateComposer() {
  const active = activeTurn();
  $("prompt").disabled = Boolean(state.creatingChat);
  $("active-state").classList.toggle("hidden", !active);
  $("active-text").textContent = I18N.t("Codex arbeitet auf der KI-VM …");
  $("send").disabled =
    !state.connected ||
    state.pendingSend ||
    Boolean(state.creatingChat) ||
    state.openingChat ||
    Boolean(globalThis.codexFeatures?.uploading) ||
    (state.thread && !state.thread.draft && !state.historyLoaded);
  $("prompt").placeholder = active
    ? I18N.t("Codex während der Arbeit eine Anweisung geben …")
    : I18N.t("Gib Codex einen Auftrag …");
  $("composer")
    .closest("footer")
    .classList.toggle(
      "hidden",
      $("show-archived").checked || state.view !== "chat",
    );
  const selectedView = state.view === "chats" ? "chat" : state.view;
  for (const button of document.querySelectorAll("[data-view-tab]")) {
    button.classList.toggle(
      "selected",
      button.dataset.viewTab === selectedView,
    );
    button.setAttribute(
      "aria-current",
      button.dataset.viewTab === selectedView ? "page" : "false",
    );
  }
  for (const button of document.querySelectorAll("[data-activity]"))
    button.classList.toggle(
      "selected",
      button.dataset.activity ===
        (state.view === "tasks"
          ? "tasks"
          : state.view === "project"
            ? "projects"
            : state.view === "gallery"
              ? "images"
              : state.view === "agents"
                ? null
              : "chat"),
    );
  globalThis.codexFeatures?.updateContext();
}
function updateEfforts(preferred) {
  const model = state.models.find((m) => m.model === $("model").value);
  const old = preferred || $("effort").value || "medium";
  const efforts = model?.supportedReasoningEfforts || [
    { reasoningEffort: "medium" },
  ];
  $("effort").innerHTML = efforts
    .map(
      (e) =>
        `<option value="${escapeHtml(e.reasoningEffort)}">${escapeHtml(e.reasoningEffort.charAt(0).toUpperCase() + e.reasoningEffort.slice(1))}</option>`,
    )
    .join("");
  if (efforts.some((e) => e.reasoningEffort === old)) $("effort").value = old;
  else
    $("effort").value =
      model?.defaultReasoningEffort || efforts[0].reasoningEffort;
}
function accessOptions(forThread) {
  const access = $("access").value;
  if (access === "inherit") return {};
  const policy = access === "full" ? "never" : "on-request";
  const sandbox =
    access === "full"
      ? "danger-full-access"
      : access === "read"
        ? "read-only"
        : "workspace-write";
  const type =
    access === "full"
      ? "dangerFullAccess"
      : access === "read"
        ? "readOnly"
        : "workspaceWrite";
  return {
    approvalPolicy: policy,
    ...(forThread ? { sandbox } : { sandboxPolicy: { type } }),
  };
}
async function sendMessage(event) {
  event.preventDefault();
  const text = $("prompt").value.trim();
  if (
    (!text && !globalThis.codexFeatures?.attachments?.length) ||
    !state.connected ||
    state.pendingSend ||
    state.openingChat ||
    Boolean(globalThis.codexFeatures?.uploading) ||
    (state.thread && !state.thread.draft && !state.historyLoaded)
  )
    return;
  if (!state.project) {
    showProjectPicker();
    return;
  }
  if ($("show-archived").checked) {
    toast(I18N.t("Stelle den archivierten Chat zunächst wieder her."));
    return;
  }
  state.pendingSend = true;
  updateComposer();
  try {
    const prepared = await globalThis.codexFeatures?.beforeSend(text);
    if (!state.thread) {
      const project = selectedProject();
      const saved = await api(
        `/api/projects/${encodeURIComponent(project.id)}/chats`,
        {},
      );
      projectSnapshot(saved);
      state.thread = saved.thread;
    }
    if (state.thread.draft) {
      const draftId = state.thread.id;
      const created = await api(
        `/api/chats/${encodeURIComponent(state.thread.id)}/start`,
        {
          options: {
            model: $("model").value || undefined,
            ...accessOptions(true),
          },
        },
      );
      projectSnapshot(created);
      state.thread = { ...created.thread, model: created.model };
      globalThis.codexFeatures?.materialized(draftId, state.thread.id);
      state.historyLoaded = true;
      state.turns = [];
      localStorage.setItem("codex.thread", state.thread.id);
      state.threads.unshift(state.thread);
      renderSidebar();
    }

    const threadId = state.thread.id;
    if (state.resumeRequest?.threadId === threadId)
      await state.resumeRequest.promise;
    const input = prepared?.input || [
      { type: "text", text, text_elements: [] },
    ];
    const active = activeTurn();
    const queueMessage = active && state.followupMode === "queue";
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const nonce = [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
    const clientUserMessageId = `${nonce.slice(0, 8)}-${nonce.slice(8, 12)}-${nonce.slice(12, 16)}-${nonce.slice(16, 20)}-${nonce.slice(20)}`;
    const result = await rpc(
      queueMessage ? "thread/queue/add" : active ? "turn/steer" : "turn/start",
      queueMessage ? { threadId, clientUserMessageId, input } : active
        ? { threadId, expectedTurnId: active.id, input }
        : {
            threadId,
            input,
            model: $("model").value || undefined,
            effort: $("effort").value || undefined,
            ...accessOptions(false),
          },
    );
    if (state.thread?.id === threadId) {
      if ($("prompt").value.trim() === text) $("prompt").value = "";
      globalThis.codexFeatures?.sent(prepared);
      if (result.turn && !state.turns.some((t) => t.id === result.turn.id))
        state.turns.push(result.turn);
      renderChat(true);
      renderRequests();
      if (queueMessage) {
        globalThis.codexQueue?.refresh();
        toast(I18N.t("Nachricht in die Warteschlange gestellt."));
      }
    }
    refreshThreads().catch(() => {});
    $("prompt").focus();
  } finally {
    state.pendingSend = false;
    updateComposer();
  }
}
function ensureTurn(id) {
  let turn = state.turns.find((t) => t.id === id);
  if (!turn) {
    turn = { id, status: "inProgress", items: [] };
    state.turns.push(turn);
  }
  turn.items ||= [];
  return turn;
}
let renderTimer;
function scheduleChat() {
  if (!renderTimer)
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderChat();
    }, 75);
}
function handleEvent(message) {
  globalThis.codexAgents?.handleEvent(message);
  globalThis.codexFeatures?.handleEvent(message);
  globalThis.codexQuestions?.handleEvent(message);
  globalThis.codexQueue?.handleEvent(message);
  const { method, params: p = {} } = message;
  if (
    method === "turn/completed" ||
    (method === "item/completed" &&
      ["imageGeneration", "imageView", "fileChange"].includes(p.item?.type))
  ) {
    const id = state.threadProjects[p.threadId];
    if (id) state.projectPreviews.delete(id);
  }
  if (method === "account/rateLimits/updated") {
    if (state.usage) state.usage.rateLimits = p.rateLimits;
    updateUsageSummary({ rateLimits: p.rateLimits });
    return;
  }
  if (method === "console/status") return setConnection(p);
  if (method === "console/settings") {
    state.sendWith = p.sendWith;
    state.followupMode = p.followupMode;
    updateSendShortcut();
    return;
  }
  if (method === "console/projects") {
    projectSnapshot(p);
    renderSidebar();
    return;
  }
  if (message.id !== undefined) {
    state.requests.set(String(message.id), message);
    renderRequests();
    renderSidebar();
    return;
  }
  if (
    method === "serverRequest/resolved" ||
    method === "console/requestAnswered"
  ) {
    state.requests.delete(String(p.requestId));
    renderRequests();
    renderSidebar();
    return;
  }
  if (
    method === "command/exec/outputDelta" &&
    p.processId === state.terminalProcess
  ) {
    const bytes = Uint8Array.from(atob(p.deltaBase64), (c) => c.charCodeAt(0));
    $("terminal-output").textContent += state.terminalDecoder.decode(bytes, {
      stream: true,
    });
    $("terminal-output").scrollTop = $("terminal-output").scrollHeight;
    return;
  }
  if (method === "thread/status/changed") {
    const thread = state.threads.find((t) => t.id === p.threadId);
    if (thread) thread.status = p.status;
    renderSidebar();
  }
  if (method === "thread/name/updated") {
    const thread = state.threads.find((t) => t.id === p.threadId);
    if (thread) thread.name = p.threadName ?? p.name;
    renderSidebar();
  }
  if (!state.thread || p.threadId !== state.thread.id) return;
  if (method === "turn/started") {
    const turn = ensureTurn(p.turn.id);
    Object.assign(turn, p.turn, {
      items: p.turn.items?.length ? p.turn.items : turn.items,
    });
    updateComposer();
    scheduleChat();
  } else if (method === "turn/completed") {
    const turn = ensureTurn(p.turn.id);
    Object.assign(turn, p.turn, {
      items: p.turn.items?.length ? p.turn.items : turn.items,
    });
    for (const [id, request] of state.requests)
      if (
        request.params.threadId === p.threadId &&
        request.params.turnId === p.turn.id
      )
        state.requests.delete(id);
    renderRequests();
    updateComposer();
    scheduleChat();
    refreshThreads().catch(() => {});
    if (!$("tools").classList.contains("hidden") && state.tab === "git")
      refreshGit().catch(() => {});
  } else if (method === "item/started" || method === "item/completed") {
    const turn = ensureTurn(p.turnId);
    const index = turn.items.findIndex((i) => i.id === p.item.id);
    if (index < 0) turn.items.push(p.item);
    else turn.items[index] = { ...turn.items[index], ...p.item };
    scheduleChat();
  } else if (
    method === "item/agentMessage/delta" ||
    method === "item/plan/delta" ||
    method === "item/commandExecution/outputDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    const turn = ensureTurn(p.turnId);
    let item = turn.items.find((i) => i.id === p.itemId);
    const type = method.includes("commandExecution")
      ? "commandExecution"
      : method.includes("reasoning")
        ? "reasoning"
        : method.includes("/plan/")
          ? "plan"
          : "agentMessage";
    if (!item) {
      item = { id: p.itemId, type };
      turn.items.push(item);
    }
    const key =
      type === "commandExecution"
        ? "aggregatedOutput"
        : type === "reasoning"
          ? "consoleSummary"
          : "text";
    item[key] = (item[key] || "") + (p.delta || "");
    scheduleChat();
  } else if (method === "turn/diff/updated") {
    state.diffs.set(p.threadId, p.diff);
  } else if (method === "turn/plan/updated") {
    ensureTurn(p.turnId).plan = p.plan;
    scheduleChat();
  } else if (method === "error") {
    toast(p.error?.message || p.message || I18N.t("Codex meldet einen Fehler"));
  }
}
function itemHtml(item) {
  if (item.type === "imageGeneration" || item.type === "imageView")
    return renderImageItem(item);
  if (item.type === "userMessage") {
    const text = (item.content || [])
      .map((c) => questionReplyText(c.text || ""))
      .filter(Boolean)
      .join("\n");
    return `<article class="message user"><div class="message-label">${I18N.t("Du")}</div><div class="message-body">${escapeHtml(text)}${itemImageCards(item)}</div></article>`;
  }
  if (item.type === "agentMessage" || item.type === "plan")
    return `<article class="message assistant"><div class="message-label"><img class="avatar" src="/assets/logo.png?v=blue-terminal" alt=""> ${item.type === "plan" ? "Plan" : "Codex"}</div><div class="message-body">${outputPreview(item.text || "", item.id, true)}${itemImageCards(item, md(item.text || ""))}${globalThis.codexQuestions?.cards(item) || ""}</div></article>`;
  let title, text;
  if (item.type === "reasoning") {
    title = I18N.t("Überlegt");
    text =
      item.consoleSummary ||
      (item.summary || [])
        .map((s) => (typeof s === "string" ? s : s.text || ""))
        .join("\n");
    if (!text) return "";
  } else if (item.type === "commandExecution") {
    const command = item.command || I18N.t("Befehl");
    const first = command.split("\n")[0];
    title = `$ ${first.length > 115 ? first.slice(0, 115) + " …" : first}${command.includes("\n") ? I18N.t(" · mehrzeilig") : ""}${item.exitCode != null ? ` · Exit ${item.exitCode}` : ""}`;
    text = `${I18N.t("Befehl")}
${command}

${I18N.t("Ausgabe")}
${item.aggregatedOutput || I18N.t("Wird ausgeführt …")}`;
  } else if (item.type === "fileChange") {
    title = `${item.changes?.length || 0} ${I18N.t("Datei(en) geändert ·")} ${item.status || ""}`;
    text = (item.changes || [])
      .map((c) => `${c.path}\n${c.diff || ""}`)
      .join("\n\n");
  } else if (item.type === "mcpToolCall") {
    title = `${item.server || "Tool"} / ${item.tool || ""} · ${item.status || ""}`;
    text = JSON.stringify(item.result || item.error || item.arguments, null, 2);
  } else if (item.type === "webSearch") {
    title = I18N.t("Websuche");
    text = JSON.stringify(item.action || item.query || {}, null, 2);
  } else if (item.type === "contextCompaction") {
    title = I18N.t("Kontext komprimiert");
    text = I18N.t("Der Chat wurde für die weitere Arbeit zusammengefasst.");
  } else if (
    item.type === "enteredReviewMode" ||
    item.type === "exitedReviewMode"
  ) {
    title = "Code-Review";
    text = item.review || item.type;
  } else if (item.type === "collabAgentToolCall") {
    title = I18N.t("Agent-Aktivität");
    text = item.prompt || item.tool || "";
  } else {
    title = item.type || I18N.t("Aktivität");
    text = JSON.stringify(item, null, 2);
  }
  return (
    `<details class="activity"><summary>${escapeHtml(title)}</summary>${outputPreview(text || "", item.id, false)}</details>` +
    itemImageCards(item)
  );
}
function questionReplyText(text) {
  const match = text.match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (!match) return text;
  try {
    const replies = JSON.parse(match[1]);
    if (!Array.isArray(replies) || !replies.every((r) => typeof r.question === "string" && typeof r.answer === "string")) return text;
    return replies.map((r) => `${I18N.t("Antwort auf Rückfrage:")} ${r.question}\n${r.answer}`).join("\n\n");
  } catch { return text; }
}
function renderChat(forceBottom = false, preserveAnchor = false) {
  if (!state.thread) return;
  const chat = $("chat");
  const nearBottom =
    chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150;
  const previousHeight = chat.scrollHeight,
    previousTop = chat.scrollTop;
  const anchor =
    !forceBottom && (preserveAnchor || !nearBottom)
      ? [...chat.querySelectorAll("[data-item]")].find(
          (node) =>
            node.getBoundingClientRect().bottom >
            chat.getBoundingClientRect().top + 1,
        )
      : null;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const opened = new Set(
    [...chat.querySelectorAll("details[open]")].map((d) => d.dataset.item),
  );
  let html =
    state.olderCursor || state.historyError
      ? `<div class="history-pager" role="status">${state.historyError ? `<p>${escapeHtml(state.historyError)}</p><button class="subtle" type="button" data-history-retry>${I18N.t("Erneut versuchen")}</button>` : `<button class="subtle load-older" type="button" data-older ${state.historyRequest ? "disabled" : ""}>${state.historyRequest ? `<span class="loading-spinner" aria-hidden="true"></span> ${I18N.t("Ältere Nachrichten werden geladen …")}` : I18N.t("↑ Ältere Nachrichten laden")}</button><small>${I18N.t("Beim Hochscrollen werden weitere Nachrichten geladen.")}</small>`}</div>`
      : "";
  if (state.historyFocus)
    html =
      `<button type="button" class="subtle" data-history-latest>${I18N.t("↓ Zu den neuesten Nachrichten")}</button>` +
      html;
  for (const turn of state.turns) {
    for (const item of turn.items || [])
      html += `<div data-item="${escapeHtml(item.id)}">${itemHtml(item)}</div>`;
    if (turn.plan?.length)
      html += `<ol class="plan-list">${turn.plan.map((p) => `<li class="${escapeHtml(p.status)}">${escapeHtml(p.step)}</li>`).join("")}</ol>`;
    if (turn.status === "failed")
      html += `<div class="turn-state error">${I18N.t("Fehlgeschlagen:")} ${escapeHtml(turn.error?.message || I18N.t("Unbekannter Fehler"))}</div>`;
    else if (turn.status === "interrupted")
      html += `<div class="turn-state">${I18N.t("■ Gestoppt")}</div>`;
  }
  const template = document.createElement("template");
  template.innerHTML =
    html ||
    `<div class="empty-list">${I18N.t("Der Chat ist bereit. Gib Codex einen Auftrag.")}</div>`;
  const existing = new Map(
    [...chat.children]
      .filter((node) => node.dataset.item)
      .map((node) => [node.dataset.item, node]),
  );
  const nodes = [...template.content.children].map((node) => {
    const previous = existing.get(node.dataset.item);
    const markup = node.outerHTML;
    if (previous?.renderedMarkup === markup) return previous;
    // Keep loaded image elements alive while surrounding text continues streaming.
    const images = new Map();
    for (const img of previous?.querySelectorAll("img") || []) {
      const key = img.getAttribute("src");
      if (!images.has(key)) images.set(key, []);
      images.get(key).push(img);
    }
    for (const img of node.querySelectorAll("img")) {
      const old = images.get(img.getAttribute("src"))?.shift();
      if (old) img.replaceWith(old);
    }
    node.renderedMarkup = markup;
    return node;
  });
  chat.replaceChildren(...nodes);
  for (const detail of chat.querySelectorAll("details")) {
    detail.dataset.item = detail.parentElement.dataset.item;
    detail.open = opened.has(detail.dataset.item);
  }
  for (const link of chat.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (isLocalImage(href)) {
      link.href = imageUrl(href);
      link.dataset.image = "true";
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  if (anchor && chat.contains(anchor))
    chat.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  else if (forceBottom || (nearBottom && !preserveAnchor))
    chat.scrollTop = chat.scrollHeight;
  else
    chat.scrollTop =
      previousTop +
      (preserveAnchor ? Math.max(0, chat.scrollHeight - previousHeight) : 0);
  state.lastChatScrollTop = chat.scrollTop;
  globalThis.codexQuestions?.syncView();
  globalThis.codexQueue?.syncView();
}
function renderRequests() {
  const requests = [...state.requests.values()].filter(
    (r) => r.params.threadId === state.thread?.id,
  );
  $("requests").innerHTML = requests
    .map((request) => {
      const { method, params: p, id } = request;
      const key = escapeHtml(String(id));
      let content;
      if (
        /commandExecution\/requestApproval|fileChange\/requestApproval/.test(
          method,
        )
      ) {
        content = `<h3>${I18N.t("Codex benötigt eine Freigabe")}</h3><p>${escapeHtml(p.reason || p.command || p.grantRoot || I18N.t("Änderungen freigeben?"))}</p>${p.command && p.reason ? `<pre>${escapeHtml(p.command)}</pre>` : ""}<button data-decision="accept">${I18N.t("Einmal erlauben")}</button><button data-decision="acceptForSession">${I18N.t("Für diesen Chat erlauben")}</button><button data-decision="decline">${I18N.t("Ablehnen")}</button>`;
      } else if (method === "item/tool/requestUserInput") {
        content =
          `<h3>${I18N.t("Codex hat eine Rückfrage")}</h3>` +
          p.questions
            .map(
              (q) =>
                `<label>${escapeHtml(q.question)}${q.options?.length ? `<select data-question="${escapeHtml(q.id)}"><option value="">${I18N.t("Antwort auswählen …")}</option>${q.options.map((o) => `<option value="${escapeHtml(o.label)}">${escapeHtml(o.label)}${o.description ? ` — ${escapeHtml(o.description)}` : ""}</option>`).join("")}</select>` : ""}<input data-free-question="${escapeHtml(q.id)}" placeholder="${I18N.t("Eigene Antwort …")}" ${q.isSecret ? 'type="password"' : ""}></label>`,
            )
            .join("") +
          `<button data-questions>${I18N.t("Senden")}</button>`;
      } else if (method === "item/permissions/requestApproval") {
        content = `<h3>${I18N.t("Zusätzliche Berechtigungen")}</h3><p>${escapeHtml(p.reason || "")}</p><pre>${escapeHtml(JSON.stringify(p.permissions, null, 2))}</pre><button data-permissions="yes">${I18N.t("Für diesen Schritt erlauben")}</button><button data-permissions="no">${I18N.t("Ablehnen")}</button>`;
      } else if (
        method === "mcpServer/elicitation/request" &&
        p.mode === "url"
      ) {
        content = `<h3>${escapeHtml(p.serverName)} ${I18N.t("benötigt deine Eingabe")}</h3><p>${escapeHtml(p.message)}</p>${/^https?:\/\//.test(p.url || "") ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${I18N.t("Anmeldung öffnen ↗")}</a>` : ""}<br><button data-elicit="accept">${I18N.t("Erledigt")}</button><button data-elicit="decline">${I18N.t("Ablehnen")}</button>`;
      } else {
        content = `<h3>${I18N.t("Eingabe erforderlich ·")} ${escapeHtml(method)}</h3><pre>${escapeHtml(JSON.stringify(p, null, 2))}</pre><label>${I18N.t("API-Antwort als JSON")}<textarea data-json-response>{}</textarea></label><button data-json-send>${I18N.t("Antwort senden")}</button>`;
      }
      return `<section class="request" data-request="${key}">${content}</section>`;
    })
    .join("");
  const question = requests.find((request) => request.method === "item/tool/requestUserInput");
  const section = question && [...$("requests").querySelectorAll("[data-request]")].find((node) => node.dataset.request === String(question.id));
  if (section) globalThis.codexQuestions?.native(question, section);
}
async function answerRequest(event) {
  const button = event.target.closest("button");
  const section = button?.closest("[data-request]");
  if (!section) return;
  const id = section.dataset.request,
    request = state.requests.get(id);
  if (!request) return;
  let result;
  if (button.dataset.decision) result = { decision: button.dataset.decision };
  else if (button.hasAttribute("data-questions")) {
    const answers = {};
    for (const q of request.params.questions) {
      const input = [...section.querySelectorAll("[data-free-question]")].find(
        (el) => el.dataset.freeQuestion === q.id,
      );
      const select = [...section.querySelectorAll("[data-question]")].find(
        (el) => el.dataset.question === q.id,
      );
      const value = input?.value.trim() || select?.value;
      if (!value) throw new Error(I18N.t("Bitte beantworte die Rückfrage."));
      answers[q.id] = { answers: [value] };
    }
    result = { answers };
  } else if (button.dataset.permissions)
    result = {
      permissions:
        button.dataset.permissions === "yes" ? request.params.permissions : {},
      scope: "turn",
    };
  else if (button.dataset.elicit)
    result = { action: button.dataset.elicit, content: null };
  else if (button.hasAttribute("data-json-send"))
    result = JSON.parse(section.querySelector("textarea").value);
  else return;
  await api("/api/answer", { id, result });
  state.requests.delete(id);
  renderRequests();
  renderSidebar();
}
function showProjectDialog() {
  $("project-error").textContent = "";
  $("project-form").reset();
  $("project-mode").value = "local";
  $("project-path").value = "";
  $("project-path").placeholder = state.projectRoot + "/mein-projekt";
  $("project-path").dataset.manual = "";
  $("project-browser").classList.add("hidden");
  $("clone-label").classList.add("hidden");
  $("project-dialog").showModal();
  $("project-name").focus();
}
async function browseProject(pathname) {
  const requested = pathname;
  let result;
  for (;;) {
    try {
      result = await rpc("fs/readDirectory", { path: pathname });
      break;
    } catch (error) {
      if (
        !/no such file|not found|does not exist|os error 2/i.test(
          error.message,
        ) ||
        pathname === "/"
      )
        throw error;
      pathname = parentPath(pathname);
    }
  }
  $("project-path").value = requested;
  $("project-path").dataset.manual = "true";
  $("project-browser").classList.remove("hidden");
  $("project-browser").innerHTML =
    `<button type="button" data-browse="${escapeHtml(parentPath(pathname))}">${I18N.t("↑ Übergeordnetes Verzeichnis")}</button>` +
    result.entries
      .filter((e) => e.isDirectory && e.fileName !== ".git")
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
      .map(
        (e) =>
          `<button type="button" data-browse="${escapeHtml(joinPath(pathname, e.fileName))}">${folderIcon} ${escapeHtml(e.fileName)}</button>`,
      )
      .join("");
}
async function addProject(event) {
  event.preventDefault();
  $("project-submit").disabled = true;
  $("project-error").textContent = "";
  try {
    const result = await api("/api/projects", {
      name: $("project-name").value.trim(),
      path: $("project-path").value || undefined,
      mode: $("project-mode").value,
      repository: $("project-repo").value.trim(),
    });
    projectSnapshot(result);
    $("project-dialog").close();
    chooseProject(result.project.path);
    await newChat(result.project.id);
    toast(I18N.t("Projekt angelegt und erster Chat bereit."));
  } catch (error) {
    $("project-error").textContent = error.message;
  } finally {
    $("project-submit").disabled = false;
  }
}

async function hostCommand(
  command,
  cwd = state.project || undefined,
  timeoutMs = 20000,
  extra = {},
) {
  return rpc("command/exec", {
    command,
    ...(cwd ? { cwd } : {}),
    timeoutMs,
    outputBytesCap: 1024 * 1024,
    sandboxPolicy: { type: "dangerFullAccess" },
    ...extra,
  });
}
async function refreshFiles(pathname = state.directory || state.project) {
  if (!pathname) {
    $("file-list").innerHTML =
      `<div class="empty-list">${I18N.t("Wähle ein Projekt.")}</div>`;
    return;
  }
  const result = await rpc("fs/readDirectory", { path: pathname });
  state.directory = pathname;
  $("file-path").value = pathname;
  $("file-list").innerHTML =
    result.entries
      .sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) ||
          a.fileName.localeCompare(b.fileName),
      )
      .map(
        (e) =>
          `<button class="file-entry" data-file="${escapeHtml(joinPath(pathname, e.fileName))}" data-directory="${e.isDirectory}"><span>${e.isDirectory ? folderIcon : "·"}</span>${escapeHtml(e.fileName)}</button>`,
      )
      .join("") || `<div class="empty-list">${I18N.t("Dieses Verzeichnis ist leer.")}</div>`;
}
async function openFile(pathname) {
  if (!canLeaveEditor()) return;
  const result = await rpc("fs/readFile", { path: pathname });
  if (result.dataBase64.length > 3 * 1024 * 1024)
    throw new Error(I18N.t("Die Datei ist zu groß für den Editor (max. 2 MB)."));
  const bytes = Uint8Array.from(atob(result.dataBase64), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.includes(0))
    throw new Error(
      I18N.t("Diese Binärdatei kann nicht im Texteditor geöffnet werden."),
    );
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  state.editorPath = pathname;
  state.editorOriginal = content;
  $("editor-name").textContent = shortName(pathname);
  $("editor-name").title = pathname;
  $("file-content").value = content;
  $("editor").classList.remove("hidden");
}
async function saveFile() {
  if (!state.editorPath) return;
  const current = await rpc("fs/readFile", { path: state.editorPath });
  const currentText = new TextDecoder().decode(
    Uint8Array.from(atob(current.dataBase64), (c) => c.charCodeAt(0)),
  );
  if (
    currentText !== state.editorOriginal &&
    !confirm(
      I18N.t("Die Datei wurde seit dem Öffnen auf der VM geändert. Trotzdem überschreiben?"),
    )
  )
    return;
  const content = $("file-content").value;
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  await rpc("fs/writeFile", {
    path: state.editorPath,
    dataBase64: btoa(binary),
  });
  state.editorOriginal = content;
  toast(I18N.t("Datei auf der KI-VM gespeichert"));
}
async function refreshGit() {
  if (!state.project) return;
  const results = await Promise.allSettled([
    hostCommand(["git", "status", "--short", "--branch"]),
    hostCommand(["git", "--no-pager", "diff", "--no-ext-diff", "--no-color"]),
    hostCommand([
      "git",
      "--no-pager",
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-color",
    ]),
  ]);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  const [status, unstaged, staged] = results.map((r) => r.value);
  $("git-status").textContent =
    status.exitCode === 0
      ? status.stdout || I18N.t("Keine Änderungen")
      : status.stderr || status.stdout;
  const diff = [
    unstaged.stdout,
    staged.stdout ? `\n--- INDEX ---\n${staged.stdout}` : "",
  ].join("");
  $("git-diff").innerHTML = diff
    ? diff
        .split("\n")
        .map(
          (line) =>
            `<span class="${line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ") ? "diff-header" : line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : ""}">${escapeHtml(line)}</span>`,
        )
        .join("\n")
    : I18N.t("Kein Diff vorhanden. Neue, unversionierte Dateien stehen im Git-Status.");
}
async function runTerminal(event) {
  event.preventDefault();
  const command = $("terminal-command").value.trim();
  if (!command || !state.project || state.terminalProcess) return;
  // getRandomValues also works on plain HTTP hosts; randomUUID requires a
  // secure browser context and is absent on typical private-network IPs.
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16).padStart(8, "0"),
  ).join("");
  const processId = `console-${nonce}`;
  state.terminalProcess = processId;
  state.terminalDecoder = new TextDecoder();
  $("terminal-output").textContent = `$ ${command}\n\n`;
  $("terminal-command").disabled = true;
  $("terminal-stop").classList.remove("hidden");
  try {
    const result = await hostCommand(
      ["/bin/bash", "-lc", command],
      state.project,
      600000,
      { processId, streamStdoutStderr: true },
    );
    $("terminal-output").textContent +=
      state.terminalDecoder.decode() + `\n[Exit ${result.exitCode}]`;
  } finally {
    state.terminalProcess = null;
    $("terminal-command").disabled = false;
    $("terminal-stop").classList.add("hidden");
  }
}
async function selectTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll("[data-tab]"))
    button.classList.toggle("selected", button.dataset.tab === tab);
  for (const id of ["files", "git", "terminal"])
    $(`${id}-tab`).classList.toggle("hidden", id !== tab);
  await refreshTool();
}
async function refreshTool() {
  if (state.tab === "files") await refreshFiles();
  else if (state.tab === "git") await refreshGit();
}
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("codex.theme", theme);
  $("theme-toggle").textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#1e1e1e" : "#ffffff";
}
function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}
function showAuth(info) {
  globalThis.codexAgents?.leave();
  globalThis.codexQuestions?.logout();
  globalThis.codexQueue?.leave();
  state.returnChat = null;
  state.authenticated = false;
  state.csrf = null;
  state.connected = false;
  state.eventSocket?.close();
  state.threads = [];
  state.drafts = [];
  state.bookmarks = [];
  state.projects = [];
  state.turns = [];
  state.media = [];
  state.usage = null;
  updateUsageSummary(null);
  state.thread = null;
  state.requests.clear();
  $("thread-list").replaceChildren();
  $("project-list").replaceChildren();
  $("chat").innerHTML = welcomeHtml();
  $("requests").replaceChildren();
  $("file-content").value = "";
  state.editorPath = "";
  state.editorOriginal = "";
  $("terminal-output").textContent = I18N.t("Bereit.");
  $("info-content").replaceChildren();
  $("image-preview").removeAttribute("src");
  $("application").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  state.setupRequired = !info.configured;
  $("auth-title").textContent = state.setupRequired
    ? I18N.t("Dein Zugang zu Codex-Web")
    : I18N.t("Willkommen zurück");
  $("auth-description").textContent = state.setupRequired
    ? I18N.t("Lege beim ersten Start dein Passwort fest. Mindestens 4 Zeichen.")
    : I18N.t("Melde dich mit deinem Passwort an.");
  $("auth-confirm-label").classList.toggle("hidden", !state.setupRequired);
  $("auth-confirm").required = state.setupRequired;
  $("auth-password").autocomplete = state.setupRequired
    ? "new-password"
    : "current-password";
  $("auth-submit").textContent = state.setupRequired
    ? I18N.t("Passwort festlegen & starten")
    : I18N.t("Anmelden");
  $("auth-form").reset();
  $("auth-password").focus();
}
async function enterApplication(info) {
  state.authenticated = true;
  state.csrf = info.csrf;
  $("auth-screen").classList.add("hidden");
  $("application").classList.remove("hidden");
  const initial = await api("/api/state");
  projectSnapshot(initial);
  $("host-label").textContent = initial.hostLabel;
  renderSidebar();
  setConnection(initial.status);
  connectEvents();
  refreshUsageSummary().catch(() => {});
  globalThis.codexFeatures?.bootstrap();
}
async function initializeAuth() {
  await I18N.ready;
  const info = await (await fetch("/api/auth/status")).json();
  await I18N.setLanguage(info.language);
  state.sendWith = info.sendWith || "shiftEnter";
  state.followupMode = info.followupMode || "steer";
  updateSendShortcut();
  if (info.authenticated) await enterApplication(info);
  else showAuth(info);
}

let pickerAction = null,
  pickerView = null,
  deleteProjectId = null,
  contextActions = [];
function showProjectPicker(threadId = null, view = null) {
  pickerAction = threadId;
  pickerView = view;
  $("picker-description").textContent = threadId
    ? I18N.t("Wähle das Zielprojekt für diesen Chat.")
    : view
      ? I18N.t("Wähle ein Projekt.")
      : I18N.t("In welchem Projekt soll der neue Chat liegen?");
  $("picker-list").innerHTML =
    state.projects
      .map(
        (p) =>
          `<button type="button" data-pick-project="${escapeHtml(p.id)}">${escapeHtml(p.name)}<small class="muted"> · ${escapeHtml(p.path)}</small></button>`,
      )
      .join("") ||
    `<p>${I18N.t("Noch kein Projekt vorhanden. Lege dein erstes Projekt an.")}</p>`;
  $("project-picker").showModal();
}
function contextMenu(items, title, x, y) {
  contextActions = items;
  const menu = $("context-menu");
  menu.innerHTML =
    `<div class="menu-label">${escapeHtml(title)}</div>` +
    items
      .map(
        (item, index) =>
          `<button type="button" role="menuitem" data-context-action="${index}" class="${item.danger ? "danger-text" : ""}">${escapeHtml(item.label)}</button>`,
      )
      .join("");
  menu.classList.remove("hidden");
  menu.style.left =
    Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top =
    Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
  menu.querySelector("button")?.focus();
}
function hideContextMenu() {
  $("context-menu").classList.add("hidden");
}
function projectContext(id, x, y) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  contextMenu(
    [
      { label: I18N.t("Neuer Chat in diesem Projekt"), run: () => newChat(id) },
      { label: I18N.t("Bilder & Screenshots"), run: () => showGallery(id) },
      ...(globalThis.codexFeatures
        ? [
            {
              label: I18N.t("Projektvorgaben …"),
              run: () => globalThis.codexFeatures.projectSettings(id),
            },
          ]
        : []),
      {
        label: I18N.t("Projekt umbenennen"),
        run: async () => {
          const name = prompt(I18N.t("Projektname"), project.name);
          if (name?.trim()) {
            projectSnapshot(
              await api(`/api/projects/${id}`, { name: name.trim() }, "PATCH"),
            );
            renderSidebar();
          }
        },
      },
      {
        label: I18N.t("Projektordner anzeigen"),
        run: async () => {
          chooseProject(project.path);
          $("tools").classList.remove("hidden");
          await selectTab("files");
        },
      },
      {
        label: I18N.t("Projekt löschen …"),
        danger: true,
        run: () => showDeleteProject(id),
      },
    ],
    project.name,
    x,
    y,
  );
}
function getThread(id) {
  return (
    [...state.threads, ...state.drafts].find((t) => t.id === id) ||
    (state.thread?.id === id ? state.thread : null)
  );
}
function chatContext(id, x, y) {
  const thread = getThread(id);
  if (!thread) return;
  const archived = $("show-archived").checked;
  contextMenu(
    [
      { label: I18N.t("Chat öffnen"), run: () => openThread(id) },
      ...(globalThis.codexFeatures
        ? [
            {
              label: globalThis.codexFeatures.pins.includes(id)
                ? I18N.t("Chat lösen")
                : I18N.t("Chat anpinnen"),
              run: () => globalThis.codexFeatures.togglePin(id),
            },
            {
              label: I18N.t("Als Markdown exportieren"),
              run: () => globalThis.codexFeatures.exportChat(id),
            },
          ]
        : []),
      { label: I18N.t("Chat umbenennen"), run: () => renameChat(id) },
      { label: I18N.t("Projekt zuordnen …"), run: () => showProjectPicker(id) },
      {
        label: I18N.t("Weitere Chataktionen …"),
        run: async () => {
          if (state.thread?.id !== id) await openThread(id);
          if (state.thread?.id !== id) return;
          $("archive-chat").textContent = $("show-archived").checked
            ? I18N.t("Chat wiederherstellen")
            : I18N.t("Chat archivieren");
          $("actions-dialog").showModal();
        },
      },
      {
        label: archived ? I18N.t("Wiederherstellen") : I18N.t("Archivieren"),
        run: () => chatAction(id, archived ? "restore" : "archive"),
      },
      {
        label: I18N.t("Endgültig löschen …"),
        danger: true,
        run: () => deleteChats([id]),
      },
    ],
    thread.name || thread.preview || "Chat",
    x,
    y,
  );
}
function showDeleteProject(id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  deleteProjectId = id;
  $("delete-project-form").reset();
  $("delete-project-error").textContent = "";
  $("delete-project-description").textContent =
    `${project.name}\n${project.path}`;
  $("delete-project-name").placeholder = project.name;
  $("delete-project-dialog").showModal();
}
let confirmationResolver = null;
function confirmAction(title, description, label = I18N.t("Endgültig löschen")) {
  $("confirm-title").textContent = title;
  $("confirm-description").textContent = description;
  $("confirm-submit").textContent = label;
  $("confirm-dialog").showModal();
  return new Promise((resolve) => {
    confirmationResolver = resolve;
  });
}
async function renameChat(id = state.thread?.id) {
  const thread = getThread(id);
  if (!thread) return;
  const name = prompt(I18N.t("Name des Chats"), thread.name || "");
  if (name?.trim()) await chatAction(id, "rename", { name: name.trim() });
}
async function chatAction(id, action, input = {}) {
  const info = await api(
    `/api/chats/${encodeURIComponent(id)}/${action}`,
    input,
  );
  projectSnapshot(info);
  if (
    state.thread?.id === id &&
    ["archive", "restore", "delete"].includes(action)
  )
    clearChat();
  if (action === "rename" && state.thread?.id === id)
    state.thread.name = input.name;
  state.archiveSelection.delete(id);
  await refreshThreads();
  $("actions-dialog").close();
}
async function deleteChats(ids) {
  if (!ids.length) return toast(I18N.t("Wähle mindestens einen Chat aus."));
  if (
    !(await confirmAction(
      I18N.t("Chats endgültig löschen"),
      `${ids.length} ${I18N.t("Chat(s) samt Verlauf und abgezweigten Unterchats werden dauerhaft aus Codex entfernt. Projektdateien bleiben erhalten.")}`,
    ))
  )
    return;
  const result = await api("/api/chats/bulk", {
    ids,
    action: "delete",
    confirm: true,
  });
  projectSnapshot(result);
  for (const id of result.completed) state.archiveSelection.delete(id);
  if (result.completed.includes(state.thread?.id)) clearChat();
  await refreshThreads();
  if (result.failed.length) toast(result.failed.map((f) => f.error).join("\n"));
  else toast(I18N.t("Chats endgültig gelöscht."));
}
function updateArchiveSelection() {
  const n = state.archiveSelection.size;
  $("archive-selection").textContent = n
    ? `${n} ${I18N.t("Chat(s) ausgewählt")}`
    : I18N.t("Archivierte Chats verwalten");
  $("archive-restore-selected").disabled = !n;
  $("archive-delete-selected").disabled = !n;
}
function renderArchiveDashboard() {
  const list = visibleThreads();
  $("chat").innerHTML =
    `<section class="archive-dashboard"><div class="eyebrow">${I18N.t("AUFGERÄUMT. NICHT VERLOREN.")}</div><h1>${I18N.t("Dein Archiv")}</h1><p>${I18N.t("Suche links nach Chats oder wähle ein Projekt. Hier kannst du Verläufe ansehen, wiederherstellen und endgültig löschen.")}</p>${
      list
        .map((t) => {
          const p = state.projects.find((p) => p.id === threadProjectId(t));
          return `<div class="archive-card"><input type="checkbox" data-archive-select="${escapeHtml(t.id)}" aria-label="${I18N.t("Chat auswählen")}" ${state.archiveSelection.has(t.id) ? "checked" : ""}><button type="button" data-thread="${escapeHtml(t.id)}"><strong>${escapeHtml(t.name || t.preview || I18N.t("Neuer Chat"))}</strong><small>${escapeHtml(p?.name || shortName(t.cwd))} · ${new Date(t.updatedAt * 1000).toLocaleString(I18N.locale)}</small></button><button type="button" class="subtle" data-restore="${escapeHtml(t.id)}">${I18N.t("Wiederherstellen")}</button><button type="button" class="subtle danger-text" data-delete="${escapeHtml(t.id)}">${I18N.t("Löschen")}</button></div>`;
        })
        .join("") || `<div class="empty-list">${I18N.t("Das Archiv ist leer.")}</div>`
    }</section>`;
}
async function toggleArchive() {
  if (!canLeaveEditor()) return;
  $("show-archived").checked = !$("show-archived").checked;
  state.archiveSelection.clear();
  clearChat();
  await refreshThreads();
  updateComposer();
}
async function bulkRestore() {
  const ids = [...state.archiveSelection];
  if (!ids.length) return;
  const result = await api("/api/chats/bulk", { ids, action: "restore" });
  projectSnapshot(result);
  for (const id of result.completed) state.archiveSelection.delete(id);
  await refreshThreads();
  if (result.failed.length) toast(result.failed.map((f) => f.error).join("\n"));
  else toast(I18N.t("Chats wiederhergestellt."));
}

$("auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("auth-error").textContent = "";
  $("auth-submit").disabled = true;
  api(state.setupRequired ? "/api/auth/setup" : "/api/auth/login", {
    password: $("auth-password").value,
    confirmPassword: $("auth-confirm").value,
  })
    .then(enterApplication)
    .catch((e) => {
      $("auth-error").textContent = e.message;
    })
    .finally(() => {
      $("auth-submit").disabled = false;
    });
});
$("logout").onclick = safe(async () => {
  await globalThis.codexFeatures?.flushDraft();
  await api("/api/auth/logout", {});
  globalThis.codexFeatures?.logout();
  state.thread = null;
  state.turns = [];
  state.requests.clear();
  showAuth({ configured: true });
});
$("theme-toggle").onclick = toggleTheme;
$("auth-theme").onclick = toggleTheme;
$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  safe(sendMessage)(event);
});
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.shiftKey === (state.sendWith !== "enter") && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    event.stopPropagation();
    $("composer").requestSubmit();
  }
});
$("new-chat").onclick = safe(() => newChat());
$("project-list").onclick = safe((event) => {
  const menu = event.target.closest("[data-project-menu]");
  if (menu) {
    const r = menu.getBoundingClientRect();
    return projectContext(menu.dataset.projectMenu, r.right, r.bottom);
  }
  const button = event.target.closest("[data-project]");
  if (button) chooseProject(button.dataset.project);
});
$("project-list").oncontextmenu = (event) => {
  const row = event.target.closest("[data-project-row]");
  if (row) {
    event.preventDefault();
    projectContext(row.dataset.projectRow, event.clientX, event.clientY);
  }
};
$("thread-list").onclick = safe(async (event) => {
  const menu = event.target.closest("[data-thread-menu]");
  if (menu) {
    const r = menu.getBoundingClientRect();
    return chatContext(menu.dataset.threadMenu, r.right, r.bottom);
  }
  if (event.target.matches("[data-archive-select]")) {
    const id = event.target.dataset.archiveSelect;
    if (event.target.checked) state.archiveSelection.add(id);
    else state.archiveSelection.delete(id);
    updateArchiveSelection();
    return;
  }
  const b = event.target.closest("[data-thread]");
  if (b) await openThread(b.dataset.thread);
});
$("thread-list").oncontextmenu = (event) => {
  const row = event.target.closest("[data-thread-row]");
  if (row) {
    event.preventDefault();
    chatContext(row.dataset.threadRow, event.clientX, event.clientY);
  }
};
$("context-menu").onclick = safe(async (event) => {
  const b = event.target.closest("[data-context-action]");
  if (b) {
    const action = contextActions[Number(b.dataset.contextAction)];
    hideContextMenu();
    await action.run();
  }
});
$("context-menu").onkeydown = (event) => {
  const buttons = [...$("context-menu").querySelectorAll("button")],
    i = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    buttons[
      (i + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
        buttons.length
    ]?.focus();
  }
};
window.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
});
window.addEventListener("resize", hideContextMenu);
$("search").oninput = renderSidebar;
$("refresh").onclick = safe(() => refreshThreads());
$("more-threads").onclick = safe(() => refreshThreads(true));
$("open-archive").onclick = safe(toggleArchive);
$("show-archived").onchange = safe(() => {
  clearChat();
  return refreshThreads();
});
$("archive-overview").onclick = () => clearChat();
$("archive-select-all").onclick = () => {
  const ids = visibleThreads().map((t) => t.id);
  const all = ids.every((id) => state.archiveSelection.has(id));
  for (const id of ids)
    if (all) state.archiveSelection.delete(id);
    else state.archiveSelection.add(id);
  renderSidebar();
};
$("archive-restore-selected").onclick = safe(bulkRestore);
$("archive-delete-selected").onclick = safe(() =>
  deleteChats([...state.archiveSelection]),
);
$("model").onchange = () => {
  localStorage.setItem("codex.model", $("model").value);
  updateEfforts();
};
$("stop").onclick = safe(async () => {
  const turn = activeTurn();
  if (turn)
    await rpc("turn/interrupt", { threadId: state.thread.id, turnId: turn.id });
});
$("chat").onclick = safe(async (event) => {
  const target = event.target;
  if (target.closest("[data-history-latest]"))
    return openThread(state.thread.id);
  const retry = target.closest("[data-retry-image]");
  if (retry) {
    const frame = retry.closest(".chat-image-frame"),
      img = frame.querySelector("img");
    frame.querySelector("figcaption").hidden = true;
    const url = new URL(img.src, location.href);
    url.searchParams.set("retry", Date.now());
    img.loading = "eager";
    img.src = url.href;
    return;
  }
  const expand = target.closest("[data-expand-output]");
  if (expand) {
    const id = expand.dataset.expandOutput;
    if (state.expandedOutputs.has(id)) state.expandedOutputs.delete(id);
    else state.expandedOutputs.add(id);
    if (state.view === "agents") globalThis.codexAgents?.renderOutput();
    else renderChat();
    return;
  }
  if (target.matches("[data-archive-select]")) {
    const id = target.dataset.archiveSelect;
    if (target.checked) state.archiveSelection.add(id);
    else state.archiveSelection.delete(id);
    renderSidebar();
    return;
  }
  const reopen = target.closest("[data-reopen-thread]");
  if (reopen) return openThread(reopen.dataset.reopenThread);
  if (target.closest("[data-history-retry]"))
    return loadHistory(state.historyLoaded);
  if (target.closest("[data-older]")) return loadHistory(true);
  const thread = target.closest("[data-thread]");
  if (thread) return openThread(thread.dataset.thread);
  const restore = target.closest("[data-restore]");
  if (restore) return chatAction(restore.dataset.restore, "restore");
  const del = target.closest("[data-delete]");
  if (del) return deleteChats([del.dataset.delete]);
  const b = target.closest("[data-prompt]");
  if (b) {
    $("prompt").value = b.dataset.prompt;
    $("prompt").focus();
  }
  if (target.closest("#welcome-project")) showProjectDialog();
  const imageLink = target.closest("a[data-image]");
  if (imageLink) {
    event.preventDefault();
    return openImage(imageLink.href, imageLink.textContent);
  }
  const image = target.closest(".message-body img,.chat-image");
  if (image) openImage(image.src, image.alt || I18N.t("Bild"));
});
function loadOlderNearTop() {
  if (
    state.view === "chat" &&
    state.historyLoaded &&
    state.olderCursor &&
    !state.historyRequest &&
    !state.historyError &&
    $("chat").scrollTop < 180
  )
    loadHistory(true);
}
$("chat").addEventListener(
  "scroll",
  () => {
    const top = $("chat").scrollTop;
    const upwards = top < state.lastChatScrollTop;
    state.lastChatScrollTop = top;
    if (upwards) loadOlderNearTop();
  },
  { passive: true },
);
$("chat").addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY < 0) loadOlderNearTop();
  },
  { passive: true },
);
let historyTouchY;
$("chat").addEventListener(
  "touchstart",
  (event) => {
    historyTouchY = event.touches[0]?.clientY;
  },
  { passive: true },
);
$("chat").addEventListener(
  "touchmove",
  (event) => {
    if (event.touches[0]?.clientY > historyTouchY + 20) loadOlderNearTop();
  },
  { passive: true },
);
$("chat").addEventListener("keydown", (event) => {
  if (["PageUp", "Home", "ArrowUp"].includes(event.key)) loadOlderNearTop();
});
$("chat").addEventListener(
  "error",
  (event) => {
    const frame = event.target.closest?.(".chat-image-frame");
    if (frame) frame.querySelector("figcaption").hidden = false;
  },
  true,
);
$("requests").onclick = safe(answerRequest);
$("add-project").onclick = showProjectDialog;
$("project-form").onsubmit = addProject;
$("project-name").oninput = () => {
  if (!$("project-path").dataset.manual) {
    const slug = $("project-name")
      .value.normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    $("project-path").value = slug ? joinPath(state.projectRoot, slug) : "";
  }
};
$("project-path").oninput = () => {
  $("project-path").dataset.manual = "true";
};
$("project-mode").onchange = () =>
  $("clone-label").classList.toggle(
    "hidden",
    $("project-mode").value !== "clone",
  );
$("browse-project").onclick = safe(() =>
  browseProject($("project-path").value || state.projectRoot),
);
$("project-browser").onclick = safe(async (e) => {
  const b = e.target.closest("[data-browse]");
  if (b) await browseProject(b.dataset.browse);
});
$("picker-list").onclick = safe(async (e) => {
  const b = e.target.closest("[data-pick-project]");
  if (!b) return;
  $("project-picker").close();
  if (pickerAction) {
    const result = await api(
      `/api/chats/${encodeURIComponent(pickerAction)}/assign`,
      { projectId: b.dataset.pickProject },
    );
    projectSnapshot(result);
    if (state.thread?.id === pickerAction) {
      state.thread.projectId = b.dataset.pickProject;
      const destination = state.projects.find(
        (p) => p.id === b.dataset.pickProject,
      );
      state.project = destination.path;
      state.directory = destination.path;
      localStorage.setItem("codex.project", state.project);
      renderProjectHeader();
    }
    await refreshThreads();
  } else if (pickerView) {
    const project = state.projects.find((p) => p.id === b.dataset.pickProject);
    if (!project) return;
    if (pickerView === "gallery") return showGallery(project.id);
    if (pickerView === "agents") return globalThis.codexAgents?.show(project);
    if (!canLeaveEditor()) return;
    chooseProject(project.path, pickerView === "chat" ? "chats" : "project");
    if (["files", "git", "terminal"].includes(pickerView))
      await activateActivity(pickerView);
  } else await newChat(b.dataset.pickProject);
});
$("picker-new-project").onclick = () => {
  $("project-picker").close();
  showProjectDialog();
};
$("delete-project-form").onsubmit = async (event) => {
  event.preventDefault();
  $("delete-project-submit").disabled = true;
  $("delete-project-error").textContent = "";
  try {
    const project = state.projects.find((p) => p.id === deleteProjectId);
    const result = await api(
      `/api/projects/${deleteProjectId}`,
      {
        confirmName: $("delete-project-name").value,
        deleteDirectory: $("delete-project-files").checked,
      },
      "DELETE",
    );
    projectSnapshot(result);
    if (state.project === project?.path) {
      state.project = "";
      clearChat();
    }
    $("delete-project-dialog").close();
    await refreshThreads();
    toast(
      result.directoryDeleted
        ? I18N.t("Projekt und Ordner gelöscht.")
        : I18N.t("Projekt entfernt, Dateien behalten."),
    );
  } catch (e) {
    $("delete-project-error").textContent = e.message;
  } finally {
    $("delete-project-submit").disabled = false;
  }
};
$("confirm-form").onsubmit = (event) => {
  event.preventDefault();
  const resolve = confirmationResolver;
  confirmationResolver = null;
  $("confirm-dialog").close();
  resolve?.(true);
};
$("confirm-dialog").addEventListener("close", () => {
  confirmationResolver?.(false);
  confirmationResolver = null;
});
for (const b of document.querySelectorAll(".dialog-close"))
  b.onclick = () => b.closest("dialog").close();
$("close-tools").onclick = () => $("tools").classList.add("hidden");
for (const b of document.querySelectorAll("[data-tab]"))
  b.onclick = safe(() => selectTab(b.dataset.tab));
$("file-up").onclick = safe(() => refreshFiles(parentPath(state.directory)));
$("file-refresh").onclick = safe(() => refreshFiles());
$("file-path").onkeydown = safe(async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    await refreshFiles($("file-path").value);
  }
});
$("file-list").onclick = safe(async (e) => {
  const b = e.target.closest("[data-file]");
  if (b) {
    if (b.dataset.directory === "true") await refreshFiles(b.dataset.file);
    else await openFile(b.dataset.file);
  }
});
$("save-file").onclick = safe(saveFile);
$("close-editor").onclick = () => {
  if (canLeaveEditor()) {
    state.editorPath = "";
    $("editor").classList.add("hidden");
  }
};
$("git-refresh").onclick = safe(refreshGit);
$("terminal-form").onsubmit = safe(runTerminal);
$("terminal-stop").onclick = safe(async () => {
  if (state.terminalProcess)
    await rpc("command/exec/terminate", { processId: state.terminalProcess });
});
$("connection-info").onclick = safe(showInfo);
$("open-usage").onclick = safe(showInfo);
$("menu").onclick = () => $("sidebar").classList.toggle("open");
$("rename-chat").onclick = safe(() => renameChat());
$("assign-chat").onclick = () => {
  if (state.thread) {
    $("actions-dialog").close();
    showProjectPicker(state.thread.id);
  }
};
$("delete-chat").onclick = safe(async () => {
  if (state.thread) {
    $("actions-dialog").close();
    await deleteChats([state.thread.id]);
  }
});
$("fork-chat").onclick = safe(async () => {
  if (!state.thread || state.thread.draft)
    return toast(I18N.t("Starte zuerst einen Auftrag in diesem Chat."));
  const r = await rpc("thread/fork", {
    threadId: state.thread.id,
    excludeTurns: true,
  });
  $("show-archived").checked = false;
  await refreshThreads();
  await openThread(r.thread.id);
  $("actions-dialog").close();
});
$("compact-chat").onclick = safe(async () => {
  if (!state.thread || state.thread.draft)
    return toast(I18N.t("Dieser Chat hat noch keinen Verlauf."));
  await rpc("thread/compact/start", { threadId: state.thread.id });
  $("actions-dialog").close();
  toast(I18N.t("Kontextkomprimierung gestartet"));
});
$("archive-chat").onclick = safe(async () => {
  if (state.thread)
    await chatAction(
      state.thread.id,
      $("show-archived").checked ? "restore" : "archive",
    );
});
document.querySelector(".brand").onclick = (event) => {
  event.preventDefault();
  clearChat();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideContextMenu();
  if (!state.authenticated) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    safe(() => newChat())();
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s" &&
    !$("editor").classList.contains("hidden")
  ) {
    event.preventDefault();
    safe(saveFile)();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (editorDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
applyTheme(
  localStorage.getItem("codex.theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
);
initializeAuth().catch((e) => {
  $("auth-error").textContent = e.message;
});

function isLocalImage(value) {
  return (
    typeof value === "string" &&
    /^(?:sandbox:|file:\/\/)?\//.test(value) &&
    /\.(png|jpe?g|gif|webp|avif|bmp)(?:\?|$)/i.test(value)
  );
}
function imageUrl(filename) {
  if (
    /^data:image\//.test(filename) ||
    /^https?:\/\//.test(filename) ||
    /^\/assets\/logo\.png(?:[?#]|$)/.test(filename) ||
    filename.startsWith("/api/media?")
  )
    return filename;
  let p = filename.replace(/^sandbox:/, "").replace(/^file:\/\//, "");
  try {
    p = decodeURIComponent(p);
  } catch {}
  if (!p.startsWith("/"))
    p = joinPath(state.thread?.cwd || state.project || state.directory, p);
  return `/api/media?path=${encodeURIComponent(p)}`;
}
function imageMarkup(src, alt = I18N.t("Bild")) {
  return `<figure class="chat-image-frame"><img class="chat-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"><figcaption class="image-error" hidden>${I18N.t("Dieses Bild konnte nicht geladen werden.")} <button type="button" class="subtle" data-retry-image>${I18N.t("Erneut laden")}</button></figcaption></figure>`;
}
function renderMarkdown(text) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(text || "", { breaks: true });
  for (const img of template.content.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!/^https?:\/\//.test(src) && !/^data:image\//.test(src))
      img.setAttribute("src", imageUrl(src));
    img.setAttribute("loading", "lazy");
  }
  return DOMPurify.sanitize(template.innerHTML);
}
function itemImageCards(item, existing = "") {
  const refs = new Set();
  function walk(value, depth = 0) {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      if (isLocalImage(value)) refs.add(value);
      for (const match of value.matchAll(
        /(?<![\w/:])(?:sandbox:|file:\/\/)?(\/[^\s<>"'`\]\)]+\.(?:png|jpe?g|gif|webp|avif|bmp))/gi,
      ))
        refs.add(match[0]);
    } else if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1);
    } else if (typeof value === "object") {
      if (
        value.type === "image" &&
        value.data &&
        value.mimeType?.startsWith("image/")
      )
        refs.add(`data:${value.mimeType};base64,${value.data}`);
      for (const [key, child] of Object.entries(value))
        if (!["data", "command", "arguments", "encryptedContent"].includes(key))
          walk(child, depth + 1);
    }
  }
  walk(item);
  const unique = new Map([...refs].map((ref) => [imageUrl(ref), ref]));
  return [...unique]
    .slice(0, 8)
    .filter(([url]) => !existing.includes(url))
    .map(([url, ref]) =>
      imageMarkup(
        url,
        ref.startsWith("data:") ? I18N.t("Bild") : shortName(ref),
      ),
    )
    .join("");
}
function renderImageItem(item) {
  if (item.failure)
    return `<div class="turn-state error">${I18N.t("Bildgenerierung fehlgeschlagen:")} ${escapeHtml(item.failure.message || JSON.stringify(item.failure))}</div>`;
  let src = item.savedPath || item.path;
  if (
    item.type === "imageGeneration" &&
    (src ||
      item.result ||
      item.consoleImageAvailable ||
      item.fileId ||
      item.status === "completed")
  ) {
    const params = new URLSearchParams({
      threadId: state.thread.id,
      itemId: item.id,
    });
    if (src) params.set("path", src);
    src = `/api/media?${params}`;
  } else if (src) src = imageUrl(src);
  return `<article class="message assistant"><div class="message-label">${item.type === "imageGeneration" ? I18N.t("Generiertes Bild") : I18N.t("Bildansicht")} · ${escapeHtml(item.status || "")}</div>${src ? imageMarkup(src, item.revisedPrompt || I18N.t("Bild")) : `<p class="muted">${I18N.t("Das Bild wird bereitgestellt …")}</p>`}${item.revisedPrompt ? `<details class="activity"><summary>${I18N.t("Bildbeschreibung")}</summary><pre>${escapeHtml(item.revisedPrompt)}</pre></details>` : ""}</article>`;
}
function openImage(src, title) {
  $("image-preview").src = src;
  $("image-preview").alt = title;
  $("image-title").textContent = title;
  $("image-download").href = src;
  $("image-download").download = title || "bild";
  $("image-dialog").showModal();
}
async function showGallery(id) {
  if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  if (!canLeaveEditor()) return;
  $("show-archived").checked = false;
  chooseProject(project.path, "gallery");
  state.view = "gallery";
  state.mediaProjectId = id;
  const version = state.openVersion;
  updateComposer();
  $("tools").classList.add("hidden");
  $("sidebar").classList.remove("open");
  $("chat").innerHTML =
    `<div class="empty-list">${I18N.t("Projektbilder werden geladen …")}</div>`;
  const result = await api(`/api/projects/${encodeURIComponent(id)}/media`);
  if (
    version !== state.openVersion ||
    state.view !== "gallery" ||
    state.mediaProjectId !== id
  )
    return;
  state.media = result.images;
  state.projectPreviews.set(id, {
    images: result.images.slice(0, 6),
    at: Date.now(),
  });
  state.mediaTruncated = result.truncated;
  state.mediaFilter = "all";
  state.mediaSearch = "";
  renderGallery();
}
function projectChatsHtml(threads) {
  return `<section><div class="overview-section-heading"><h2>Chats <span class="muted">${threads.length}</span></h2><button type="button" class="accent-button" data-overview-new-chat>${I18N.t("+ Neuen Chat starten")}</button></div><div class="overview-chats">${threads.map((t) => `<div class="overview-chat-row" data-overview-chat-row="${escapeHtml(t.id)}"><button class="overview-chat" type="button" data-overview-thread="${escapeHtml(t.id)}"><strong>${escapeHtml(t.name || t.preview?.slice(0, 90) || I18N.t("Neuer Chat"))}</strong><small>${t.draft ? I18N.t("Entwurf") : t.status?.type === "active" ? I18N.t("Codex arbeitet …") : new Date(t.updatedAt * 1000).toLocaleString(I18N.locale)}</small></button><button type="button" class="subtle" data-overview-chat-menu="${escapeHtml(t.id)}" aria-label="${I18N.t("Chatmenü")}">⋯</button></div>`).join("") || `<p class="empty-list">${I18N.t("Noch keine Chats. Starte den ersten Chat für dieses Projekt.")}</p>`}</div>${state.threadCursor ? `<button class="subtle" type="button" data-overview-more>${I18N.t("Weitere Chats laden")}</button>` : ""}</section>`;
}
function renderProjectOverview() {
  const project = selectedProject();
  if (!project || !["project", "chats"].includes(state.view)) return;
  const threads = visibleThreads();
  if (state.view === "chats") {
    $("chat").innerHTML =
      `<section class="project-overview" data-project-chats data-overview-project="${escapeHtml(project.id)}"><header class="overview-heading"><div><div class="eyebrow">${I18N.t("PROJEKT")}</div><h1>${escapeHtml(project.name)}</h1><p class="muted">${escapeHtml(project.path)}</p></div><button class="subtle" type="button" data-overview-project-menu aria-label="${I18N.t("Projektmenü")}">⋯</button></header>${projectChatsHtml(threads)}</section>`;
    return;
  }
  let preview = state.projectPreviews.get(project.id);
  if (!preview || (!preview.loading && Date.now() - preview.at > 30000)) {
    preview = { ...preview, loading: true, at: Date.now() };
    state.projectPreviews.set(project.id, preview);
    api(`/api/projects/${encodeURIComponent(project.id)}/media`)
      .then((result) => {
        if (state.projectPreviews.get(project.id) !== preview) return;
        state.projectPreviews.set(project.id, {
          images: result.images.slice(0, 6),
          at: Date.now(),
        });
      })
      .catch(() => {
        if (state.projectPreviews.get(project.id) !== preview) return;
        state.projectPreviews.set(project.id, {
          images: preview.images || [],
          error: true,
          at: Date.now(),
        });
      })
      .finally(() => {
        if (state.view === "project" && selectedProject()?.id === project.id)
          renderProjectOverview();
      });
  }
  $("chat").innerHTML =
    `<section class="project-overview" data-overview-project="${escapeHtml(project.id)}"><header class="overview-heading"><div><div class="eyebrow">${I18N.t("PROJEKT")}</div><h1>${escapeHtml(project.name)}</h1><p class="muted">${escapeHtml(project.path)}</p></div><button class="subtle" type="button" data-overview-project-menu aria-label="${I18N.t("Projektmenü")}">⋯</button></header>${projectChatsHtml(threads)}<section><div class="overview-section-heading"><h2>${I18N.t("Bilder & Screenshots")}</h2><button class="subtle" type="button" data-overview-gallery>${I18N.t("Galerie öffnen →")}</button></div><div class="overview-images">${(preview.images || []).map((image, index) => `<button type="button" class="gallery-card" data-overview-image="${index}"><img src="${escapeHtml(imageUrl(image.path))}" alt="${escapeHtml(image.name)}" loading="lazy"><div><strong>${escapeHtml(image.name)}</strong></div></button>`).join("") || `<p class="empty-list">${preview.loading ? `<span class="loading-spinner" aria-hidden="true"></span> ${I18N.t("Projektbilder werden geladen …")}` : preview.error ? I18N.t("Die Vorschau konnte nicht geladen werden. Öffne die Galerie, um es erneut zu versuchen.") : I18N.t("Noch keine Bilder in diesem Projekt.")}</p>`}</div></section></section>`;
}
function imageContext(item, x, y) {
  const src = imageUrl(item.path);
  contextMenu(
    [
      { label: I18N.t("Bild öffnen"), run: () => openImage(src, item.name) },
      {
        label: I18N.t("Bild herunterladen"),
        run: () => {
          const link = document.createElement("a");
          link.href = src;
          link.download = item.name;
          link.click();
        },
      },
      ...(item.threadId
        ? [
            {
              label: I18N.t("Zugehörigen Chat öffnen"),
              run: () => openThread(item.threadId),
            },
          ]
        : []),
      {
        label: I18N.t("Projektgalerie öffnen"),
        run: () => showGallery(selectedProject().id),
      },
    ],
    item.name,
    x,
    y,
  );
}
async function activateView(view) {
  if (state.pendingSend) return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
  const project = selectedProject();
  if (!project) return showProjectPicker(null, view);
  if (view === "agents") return globalThis.codexAgents?.show(project);
  if (view === "gallery") return showGallery(project.id);
  if (view === "project") return chooseProject(project.path);
  if (state.returnChat?.project === project.path)
    return openThread(state.returnChat.id, { archived: state.returnChat.archived });
  if (!canLeaveEditor()) return;
  const archived = $("show-archived").checked;
  if (archived) {
    $("show-archived").checked = false;
    state.threads = [];
    state.threadCursor = null;
    state.archiveSelection.clear();
  }
  chooseProject(project.path, "chats");
  if (archived) await refreshThreads();
}
document.querySelector(".editor-tabs").onclick = safe((event) => {
  const button = event.target.closest("[data-view-tab]");
  if (button) return activateView(button.dataset.viewTab);
});
async function activateActivity(action) {
  if (action === "tasks") return globalThis.codexFeatures?.showTasks();
  if (action === "search") return globalThis.codexFeatures?.showSearch();
  if (action === "usage") return showInfo();
  if (action === "settings") return globalThis.codexSettings?.open();
  if (["projects", "chat", "images"].includes(action))
    return activateView(
      { projects: "project", chat: "chat", images: "gallery" }[action],
    );
  if (!selectedProject()) return showProjectPicker(null, action);
  $("tools").classList.remove("hidden");
  $("sidebar").classList.remove("open");
  await selectTab(action);
}
for (const nav of document.querySelectorAll(
  ".activity-bar, .mobile-workspaces",
))
  nav.onclick = safe((event) => {
    const button = event.target.closest("[data-activity]");
    if (button) return activateActivity(button.dataset.activity);
  });
$("chat").addEventListener("contextmenu", (event) => {
  const thread = event.target.closest("[data-overview-chat-row]");
  const image = event.target.closest(
    "[data-overview-image], [data-gallery-image]",
  );
  const project = event.target.closest("[data-overview-project]");
  if (!thread && !image && !project) return;
  event.preventDefault();
  if (thread)
    chatContext(thread.dataset.overviewChatRow, event.clientX, event.clientY);
  else if (image) {
    const item = image.hasAttribute("data-overview-image")
      ? state.projectPreviews.get(selectedProject()?.id)?.images?.[
          Number(image.dataset.overviewImage)
        ]
      : state.media.find((item) => item.id === image.dataset.galleryImage);
    if (item) imageContext(item, event.clientX, event.clientY);
  } else
    projectContext(
      project.dataset.overviewProject,
      event.clientX,
      event.clientY,
    );
});
$("chat").addEventListener(
  "click",
  safe(async (event) => {
    const target = event.target;
    if (target.closest("[data-overview-new-chat]"))
      return newChat(selectedProject()?.id);
    if (target.closest("[data-overview-gallery]"))
      return showGallery(selectedProject()?.id);
    const thread = target.closest("[data-overview-thread]");
    if (thread) return openThread(thread.dataset.overviewThread);
    const menu = target.closest(
      "[data-overview-chat-menu], [data-overview-project-menu]",
    );
    if (menu) {
      const rect = menu.getBoundingClientRect();
      return menu.hasAttribute("data-overview-chat-menu")
        ? chatContext(menu.dataset.overviewChatMenu, rect.right, rect.bottom)
        : projectContext(selectedProject().id, rect.right, rect.bottom);
    }
    if (target.closest("[data-overview-more]")) return refreshThreads(true);
    const image = target.closest("[data-overview-image]");
    if (image) {
      const item = state.projectPreviews.get(selectedProject()?.id)?.images?.[
        Number(image.dataset.overviewImage)
      ];
      if (item) openImage(imageUrl(item.path), item.name);
    }
  }),
);
function renderGallery() {
  const project = state.projects.find((p) => p.id === state.mediaProjectId);
  if (state.view !== "gallery" || !project || project.path !== state.project)
    return;
  const categories = {
    all: I18N.t("Alle Bilder"),
    generated: I18N.t("Generiert"),
    screenshots: "Screenshots",
    project: I18N.t("Projektbilder"),
  };
  const filtered = state.media.filter(
    (i) =>
      (state.mediaFilter === "all" || i.category === state.mediaFilter) &&
      (!state.mediaSearch ||
        `${i.name} ${i.relativePath}`
          .toLocaleLowerCase()
          .includes(state.mediaSearch)),
  );
  const groups = new Map();
  for (const image of filtered) {
    const date = new Date(image.modifiedAt).toLocaleDateString(I18N.locale, {
      weekday: "short",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(image);
  }
  $("chat").innerHTML =
    `<section class="gallery" data-project-id="${escapeHtml(project.id)}"><div class="gallery-heading"><div><div class="eyebrow">${escapeHtml(project.name)}</div><h1>${I18N.t("Bilder & Screenshots")}</h1></div><button class="subtle" type="button" data-gallery-refresh>${I18N.t("Aktualisieren ↻")}</button></div><p>${state.media.length} ${I18N.t("Bilder · aus diesem Projekt und seinen Chats")}</p><div class="gallery-filters">${Object.entries(
      categories,
    )
      .map(
        ([key, label]) =>
          `<button type="button" data-gallery-filter="${key}" class="${state.mediaFilter === key ? "selected" : ""}">${label} <span>${key === "all" ? state.media.length : state.media.filter((i) => i.category === key).length}</span></button>`,
      )
      .join(
        "",
      )}</div><input class="gallery-search" id="gallery-search" aria-label="${I18N.t("Bilder durchsuchen")}" placeholder="${I18N.t("Bilder nach Name oder Ordner durchsuchen …")}" value="${escapeHtml(state.mediaSearch || "")}">${[...groups].map(([date, images]) => `<h2 class="gallery-date-heading">${date}</h2><div class="gallery-grid">${images.map((i) => `<button type="button" class="gallery-card" data-gallery-image="${escapeHtml(i.id)}"><img src="${escapeHtml(imageUrl(i.path))}" alt="${escapeHtml(i.name)}" loading="lazy"><div><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.relativePath)}</small><small>${categories[i.category]} · ${Math.ceil(i.size / 1024)} KB</small></div></button>`).join("")}</div>`).join("") || `<div class="empty-list">${I18N.t("Keine passenden Bilder gefunden. Generierte Bilder und Screenshots erscheinen hier, sobald sie auf der KI-VM gespeichert sind.")}</div>`}${state.mediaTruncated ? `<p class="panel-note">${I18N.t("Es werden maximal 2.000 Bilder pro Projekt angezeigt.")}</p>` : ""}</section>`;
  $("gallery-search").oninput = (event) => {
    const start = event.target.selectionStart;
    state.mediaSearch = event.target.value.toLocaleLowerCase();
    renderGallery();
    $("gallery-search").focus();
    $("gallery-search").setSelectionRange(start, start);
  };
}
$("chat").addEventListener(
  "click",
  safe(async (event) => {
    const filter = event.target.closest("[data-gallery-filter]");
    if (filter) {
      state.mediaFilter = filter.dataset.galleryFilter;
      renderGallery();
    }
    const image = event.target.closest("[data-gallery-image]");
    if (image) {
      const item = state.media.find((i) => i.id === image.dataset.galleryImage);
      openImage(imageUrl(item.path), item.name);
    }
    if (event.target.closest("[data-gallery-refresh]"))
      await showGallery(state.mediaProjectId);
  }),
);
function updateUsageSummary(usage) {
  const buckets = Object.values(usage?.rateLimitsByLimitId || {});
  const limits = usage?.rateLimits || usage?.rateLimitsByLimitId?.codex || (buckets.length === 1 ? buckets[0] : null);
  const windows = [limits?.primary, limits?.secondary].filter(Boolean);
  const remaining = (window) => Number.isFinite(window?.usedPercent)
    ? `${Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)))}%` : "—";
  const fiveHours = windows.find((window) => window.windowDurationMins === 300);
  const weekly = windows.find((window) => window.windowDurationMins === 10080);
  $("activity-usage-primary").textContent = remaining(fiveHours);
  $("activity-usage-weekly").textContent = remaining(weekly);
}
async function refreshUsageSummary() {
  state.usageFetch ||= api("/api/usage").finally(() => {
    state.usageFetch = null;
  });
  const usage = await state.usageFetch;
  if (!state.authenticated) return usage;
  state.usage = usage;
  updateUsageSummary(usage);
  return usage;
}
function durationLabel(minutes) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} ${I18N.t("Tage")}`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} ${I18N.t("Stunden")}`;
  return `${minutes} ${I18N.t("Minuten")}`;
}
async function showInfo() {
  if (!$("info-dialog").open) $("info-dialog").showModal();
  const version = (state.usageViewVersion = (state.usageViewVersion || 0) + 1);
  renderUsage(state.usage, true);
  let usage;
  try {
    usage = await refreshUsageSummary();
  } catch (error) {
    if (version === state.usageViewVersion && $("info-dialog").open)
      renderUsage(state.usage, false, error.message);
    return;
  }
  if (version === state.usageViewVersion && $("info-dialog").open)
    renderUsage(usage);
}
function renderUsage(usage, loading = false, error = "") {
  $("info-content").setAttribute("aria-busy", String(loading));
  const account = state.account;
  const buckets = usage?.rateLimitsByLimitId
    ? Object.entries(usage.rateLimitsByLimitId)
    : usage?.rateLimits
      ? [["codex", usage.rateLimits]]
      : [];
  let html = `<div class="quota-header"><strong>${escapeHtml(account?.planType || "Codex")}${account?.email ? ` · ${escapeHtml(account.email)}` : ""}</strong><button class="subtle" id="usage-refresh" type="button" ${loading ? "disabled" : ""}>${I18N.t("Aktualisieren ↻")}</button></div><div class="quota-status" role="status">${loading ? `<span class="loading-spinner" aria-hidden="true"></span>${I18N.t("Kontingente werden geladen …")}` : error ? escapeHtml(error) : ""}</div>`;
  if (!usage)
    html += `<section class="quota-card quota-placeholder"><div class="quota-heading"><strong>${I18N.t("Nutzung")}</strong></div>${[I18N.t("Aktuelles Kontingent"), I18N.t("Wöchentliches Kontingent")].map((label) => `<div class="quota-window"><div><span>${label}</span><span class="skeleton skeleton-number"></span></div><div class="skeleton skeleton-bar"></div><div class="skeleton skeleton-text"></div></div>`).join("")}</section>`;
  for (const [id, bucket] of buckets) {
    if (!bucket) continue;
    html += `<section class="quota-card"><div class="quota-heading"><strong>${escapeHtml(bucket.limitName || id)}</strong></div>${[
      "primary",
      "secondary",
    ]
      .filter((key) => bucket[key])
      .map((key) => {
        const w = bucket[key],
          used = Math.max(0, Math.min(100, w.usedPercent));
        return `<div class="quota-window"><div><span>${durationLabel(w.windowDurationMins)}${I18N.t("-Fenster")}</span><strong>${Math.round(100 - used)}${I18N.t("% verfügbar")}</strong></div><progress max="100" value="${100 - used}"></progress><small>${Math.round(used)}${I18N.t("% verbraucht")}${w.resetsAt ? ` ${I18N.t("· erneuert sich")} ${new Date(w.resetsAt * 1000).toLocaleString(I18N.locale)}` : ""}</small></div>`;
      })
      .join(
        "",
      )}${bucket.credits?.unlimited ? `<small class="muted">${I18N.t("Unbegrenztes Zusatzguthaben")}</small>` : bucket.credits?.hasCredits && Number(bucket.credits.balance) > 0 ? `<small class="muted">${I18N.t("Zusatzguthaben:")} ${escapeHtml(bucket.credits.balance)}</small>` : ""}</section>`;
  }
  const reset = usage?.rateLimitResetCredits;
  html += `<section class="reset-card"><h3>${I18N.t("Verfügbare Rücksetzungen")}</h3><strong id="reset-count">${!usage && loading ? '<span class="skeleton skeleton-number"></span>' : reset ? reset.availableCount : I18N.t("Nicht verfügbar")}</strong><p>${!usage && loading ? I18N.t("Die verfügbaren Rücksetzungen werden abgefragt.") : reset ? I18N.t("Eine Rücksetzung wird erst nach deiner Bestätigung verwendet.") : I18N.t("Codex stellt für dieses Konto derzeit keine Angaben zu Rücksetzungen bereit.")}</p>${(reset?.credits || []).map((c) => `<div class="reset-detail">${escapeHtml(c.title || I18N.t("Kontingent-Rücksetzung"))}${c.expiresAt ? ` ${I18N.t("· gültig bis")} ${new Date(c.expiresAt * 1000).toLocaleDateString(I18N.locale)}` : ""}</div>`).join("")}<button type="button" id="usage-reset" class="accent-button" ${loading || !reset || reset.availableCount < 1 ? "disabled" : ""}>${I18N.t("Kontingent zurücksetzen …")}</button></section><div class="info-row"><strong>${I18N.t("Verbindung zur KI-VM")}</strong>${state.connected ? I18N.t("Verbunden") : I18N.t("Getrennt")} · ${escapeHtml(state.connectionInfo?.transport || "API")}</div>`;
  $("info-content").innerHTML = html;
  $("usage-refresh").onclick = safe(showInfo);
  $("usage-reset").onclick = safe(async () => {
    if (
      !confirm(
        I18N.t("Eine verfügbare Rücksetzung für dein Codex-Kontingent verwenden?"),
      )
    )
      return;
    $("usage-reset").disabled = true;
    const nonce = () =>
      Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
        n.toString(16).padStart(8, "0"),
      ).join("");
    state.resetAttempt ||= nonce();
    try {
      const result = await api("/api/usage/reset", {
        confirm: true,
        idempotencyKey: state.resetAttempt,
      });
      state.resetAttempt = null;
      toast(
        {
          reset: I18N.t("Kontingent zurückgesetzt."),
          alreadyRedeemed: I18N.t("Die Rücksetzung war bereits erfolgreich."),
          nothingToReset: I18N.t("Aktuell gibt es kein zurücksetzbares Kontingent."),
          noCredit: I18N.t("Keine Rücksetzung verfügbar."),
        }[result.outcome] || result.outcome,
      );
      await showInfo();
    } catch (e) {
      await showInfo();
      throw e;
    }
  });
}

function outputPreview(text, id, markdown = false) {
  const lines = text.split("\n"),
    long = text.length > 2200 || lines.length > 24,
    expanded = state.expandedOutputs.has(id);
  const clipped =
    long && !expanded ? lines.slice(0, 20).join("\n").slice(0, 2000) : text;
  return `<div class="output-preview ${expanded ? "expanded" : ""}">${markdown ? md(clipped) : `<pre>${escapeHtml(clipped)}</pre>`}${long ? `<button type="button" class="expand-output" data-expand-output="${escapeHtml(id)}">${expanded ? I18N.t("Weniger anzeigen") : `${I18N.t("Ganz anzeigen ·")} ${lines.length} ${I18N.t("Zeilen")}`}</button>` : ""}</div>`;
}

function updateSendShortcut() {
  $("send-shortcut-hint").textContent = state.sendWith === "enter"
    ? I18N.t("Enter senden · Shift + Enter Zeilenumbruch")
    : I18N.t("Enter Zeilenumbruch · Shift + Enter senden");
  $("send").title = state.sendWith === "enter" ? I18N.t("Nachricht senden (Enter)") : I18N.t("Nachricht senden (Shift+Enter)");
}
