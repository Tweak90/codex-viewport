"use strict";
(() => {
  const F = {
    pins: [],
    pinnedThreads: [],
    attachments: [],
    uploading: 0,
    currentKey: null,
    drafts: new Map(),
    writes: new Map(),
    contexts: new Map(),
    inputRevision: 0,
    searchRevision: 0,
    async bootstrap() {
      if (!state.authenticated || F.loading) return;
      F.loading = true;
      try {
        const data = await api("/api/workbench");
        if (!state.authenticated) return;
        F.pins = data.pins;
        await F.refreshPins();
        F.version(false).catch(() => {});
        F.refreshTasks().catch(() => {});
      } catch (error) {
        if (state.authenticated) toast(error.message);
      } finally {
        F.loading = false;
      }
    },
    async refreshPins() {
      if (!F.pins.length) {
        F.pinnedThreads = [];
        renderSidebar();
        return;
      }
      const archived = $("show-archived").checked;
      const result = await api(
        `/api/pins?archived=${$("show-archived").checked ? 1 : 0}`,
      );
      if (archived !== $("show-archived").checked) return;
      F.pinnedArchive = archived;
      F.pinnedThreads = result.data;
      if (state.authenticated) renderSidebar();
    },
    async togglePin(id) {
      const pins = F.pins.includes(id)
        ? F.pins.filter((other) => other !== id)
        : [...F.pins, id];
      const result = await api("/api/workbench", { pins }, "PATCH");
      F.pins = result.pins;
      await F.refreshPins();
      F.decoratePins();
    },
    decoratePins() {
      document
        .querySelectorAll("[data-thread-row], [data-overview-chat-row]")
        .forEach((row) => {
          const id = row.dataset.threadRow || row.dataset.overviewChatRow;
          row.classList.toggle("pinned-chat", F.pins.includes(id));
          const title = row.querySelector(
            ".thread-title, .overview-chat strong",
          );
          if (title)
            title.title = F.pins.includes(id) ? I18N.t("Angepinnter Chat") : "";
        });
    },
    localDraft(id) {
      try {
        return JSON.parse(localStorage.getItem("codex.composer." + id));
      } catch {
        return null;
      }
    },
    cacheDraft(id, value) {
      F.drafts.set(id, value);
      try {
        localStorage.setItem("codex.composer." + id, JSON.stringify(value));
      } catch {}
    },
    capture() {
      return { text: $("prompt").value, attachments: [...F.attachments] };
    },
    saveDraft() {
      clearTimeout(F.saveTimer);
      const id = F.currentKey;
      if (!id || !state.authenticated) return Promise.resolve();
      const value = F.capture();
      F.cacheDraft(id, value);
      const signature = JSON.stringify(value);
      if (F.savedSignatures?.get(id) === signature)
        return F.writes.get(id) || Promise.resolve();
      F.savedSignatures ||= new Map();
      F.savedSignatures.set(id, signature);
      const previous = F.writes.get(id) || Promise.resolve();
      const request = previous
        .catch(() => {})
        .then(() =>
          api(`/api/chats/${encodeURIComponent(id)}/composer`, value, "PUT"),
        );
      F.writes.set(id, request);
      request.catch(() => {
        F.savedSignatures.delete(id);
      });
      return request;
    },
    flushDraft() {
      return F.saveDraft();
    },
    leaveChat() {
      F.saveDraft().catch(() => {});
      F.currentKey = null;
      F.attachments = [];
      F.renderAttachments();
    },
    openChat(thread) {
      F.currentKey = thread.id;
      F.inputRevision++;
      const revision = F.inputRevision;
      const cached = F.drafts.get(thread.id) || F.localDraft(thread.id);
      $("prompt").value = cached?.text || "";
      F.attachments = cached?.attachments || [];
      F.renderAttachments();
      if (thread.draft) F.applyProjectDefaults();
      api(`/api/chats/${encodeURIComponent(thread.id)}/composer`)
        .then((value) => {
          if (
            F.currentKey !== thread.id ||
            F.inputRevision !== revision ||
            cached
          )
            return;
          $("prompt").value = value.text;
          F.attachments = value.attachments;
          F.cacheDraft(thread.id, value);
          F.renderAttachments();
        })
        .catch((error) => {
          if (F.currentKey === thread.id) toast(error.message);
        });
      F.fetchContext(thread.id);
    },
    materialized(from, to) {
      const value = F.capture();
      F.currentKey = to;
      F.cacheDraft(to, value);
      F.drafts.delete(from);
      F.savedSignatures?.delete(from);
      try {
        localStorage.removeItem("codex.composer." + from);
      } catch {}
      F.pins = F.pins.map((id) => (id === from ? to : id));
    },
    async beforeSend(text) {
      await F.flushDraft();
      const attachments = [...F.attachments];
      const input = text ? [{ type: "text", text, text_elements: [] }] : [];
      for (const file of attachments) {
        if (file.image) input.push({ type: "localImage", path: file.path });
        else
          input.push({
            type: "text",
            text: `${I18N.t("Angehängte Datei:")} ${file.name}
${I18N.t("Pfad auf der KI-VM:")} ${file.path}`,
            text_elements: [],
          });
      }
      return { input, attachments };
    },
    sent(prepared) {
      const sent = new Set(
        (prepared?.attachments || []).map((file) => file.path),
      );
      F.attachments = F.attachments.filter((file) => !sent.has(file.path));
      F.renderAttachments();
      F.saveDraft().catch(() =>
        toast(
          I18N.t("Nachricht gesendet; der gespeicherte Entwurf konnte nicht aktualisiert werden."),
        ),
      );
    },
    logout() {
      clearTimeout(F.saveTimer);
      clearTimeout(F.searchTimer);
      F.currentKey = null;
      F.attachments = [];
      F.drafts.clear();
      F.contexts.clear();
      F.pins = [];
      F.pinnedThreads = [];
      F.searchRevision++;
      for (const key of Object.keys(localStorage))
        if (key.startsWith("codex.composer.")) localStorage.removeItem(key);
      $("prompt").value = "";
      F.renderAttachments();
      document.title = "Codex-Web · VM Console";
    },
    renderAttachments() {
      $("composer-attachments").innerHTML = F.attachments
        .map(
          (file, index) =>
            `<div class="attachment-chip">${file.image ? `<img src="${escapeHtml(imageUrl(file.path))}" alt="">` : '<span aria-hidden="true">▤</span>'}<span title="${escapeHtml(file.path)}">${escapeHtml(file.name)}<small>${Math.ceil(file.size / 1024)} KB</small></span><button type="button" data-remove-attachment="${index}" aria-label="${I18N.t("Anhang entfernen")}" title="${I18N.t("Aus Nachricht entfernen; Datei bleibt im Projekt")}">×</button></div>`,
        )
        .join("");
      $("upload-status").textContent = F.uploading
        ? `${F.uploading} ${I18N.t("Datei(en) werden hochgeladen …")}`
        : "";
      $("attach-files").disabled = F.uploading > 0 || state.pendingSend;
    },
    async upload(files, directory = null) {
      const project = selectedProject();
      if (!project) return toast(I18N.t("Wähle zuerst ein Projekt."));
      const list = [...files];
      if (!list.length) return;
      let chat = state.thread;
      if (!directory) {
        if (state.creatingChat) chat = await state.creatingChat.promise;
        else if (!chat) chat = await newChat(project.id);
        if (!chat?.id) return;
      }
      const key = chat?.id;
      if (!directory && list.length + F.attachments.length > 20)
        return toast(I18N.t("Maximal 20 Anhänge je Nachricht."));
      F.uploading += list.length;
      F.renderAttachments();
      updateComposer();
      for (const file of list) {
        try {
          if (file.size > 25 * 1024 * 1024)
            throw new Error(`${file.name}${I18N.t(": maximal 25 MB je Datei.")}`);
          const query = new URLSearchParams({ name: file.name || "Bild.png" });
          if (directory) query.set("directory", directory);
          const response = await fetch(
            `/api/projects/${encodeURIComponent(project.id)}/uploads?${query}`,
            {
              method: "PUT",
              headers: {
                "X-CSRF-Token": state.csrf,
                "Content-Type": "application/octet-stream",
              },
              body: file,
            },
          );
          const value = await response.json();
          if (!response.ok)
            throw new Error(value.error || I18N.t("Upload fehlgeschlagen."));
          if (!directory) {
            if (F.currentKey === key) {
              F.attachments.push(value);
              F.inputRevision++;
              await F.saveDraft();
            } else {
              const previous = F.drafts.get(key) ||
                F.localDraft(key) || { text: "", attachments: [] };
              previous.attachments = [...previous.attachments, value];
              F.cacheDraft(key, previous);
              await api(
                `/api/chats/${encodeURIComponent(key)}/composer`,
                previous,
                "PUT",
              );
            }
          }
          if (selectedProject()?.id === project.id)
            state.projectPreviews.delete(project.id);
        } catch (error) {
          toast(error.message);
        } finally {
          F.uploading--;
          F.renderAttachments();
          updateComposer();
        }
      }
      if (directory && selectedProject()?.id === project.id) {
        await refreshFiles(directory);
        toast(I18N.t("Dateien ins Projekt hochgeladen."));
      }
    },
    async attachExisting(filename) {
      const project = selectedProject();
      if (!project) return;
      const info = await api(`/api/projects/${project.id}/files`, {
        op: "stat",
        path: filename,
      });
      if (info.directory) return toast(I18N.t("Bitte eine Datei auswählen."));
      if (!state.thread) await newChat(project.id);
      if (!F.attachments.some((file) => file.path === filename))
        F.attachments.push({
          path: filename,
          name: shortName(filename),
          size: info.size,
          image: /\.(png|jpe?g|webp|gif)$/i.test(filename),
        });
      F.renderAttachments();
      await F.saveDraft();
    },
    async fileAction(op, filename, destination) {
      const project = selectedProject();
      if (!project) return;
      if (
        ["move", "delete"].includes(op) &&
        state.editorPath &&
        (state.editorPath === filename ||
          state.editorPath.startsWith(filename + "/")) &&
        !canLeaveEditor()
      )
        return;
      let input = { op, path: filename };
      if (op === "delete") {
        const name = shortName(filename);
        const confirmation = prompt(
          `„${name}${I18N.t("“ endgültig löschen?")}
${filename}

${I18N.t("Zum Bestätigen den Namen eingeben.")}`,
          "",
        );
        if (confirmation !== name) return;
        input.confirm = confirmation;
      }
      if (destination) input.destination = destination;
      await api(`/api/projects/${encodeURIComponent(project.id)}/files`, input);
      if (selectedProject()?.id === project.id) {
        if (
          state.editorPath &&
          (state.editorPath === filename ||
            state.editorPath.startsWith(filename + "/"))
        ) {
          state.editorPath = "";
          $("editor").classList.add("hidden");
        }
        await refreshFiles();
        state.projectPreviews.delete(project.id);
      }
    },
    async createFile(folder = false, directory = state.directory) {
      const name = prompt(
        folder
          ? I18N.t("Neuer Ordner (relativ zum aktuellen Verzeichnis)")
          : I18N.t("Neue Datei (relativ zum aktuellen Verzeichnis)"),
        "",
      );
      if (name?.trim())
        await F.fileAction(
          folder ? "folder" : "file",
          joinPath(directory, name.trim()),
        );
    },
    fileMenu(filename, directory, x, y) {
      contextMenu(
        [
          {
            label: directory ? I18N.t("Ordner öffnen") : I18N.t("Datei öffnen"),
            run: () =>
              directory ? refreshFiles(filename) : openFile(filename),
          },
          ...(directory
            ? [
                {
                  label: I18N.t("Neue Datei …"),
                  run: () => F.createFile(false, filename),
                },
                {
                  label: I18N.t("Neuer Ordner …"),
                  run: () => F.createFile(true, filename),
                },
              ]
            : [
                {
                  label: I18N.t("An Chat anhängen"),
                  run: () => F.attachExisting(filename),
                },
              ]),
          {
            label: I18N.t("Umbenennen …"),
            run: async () => {
              const name = prompt(I18N.t("Neuer Name"), shortName(filename));
              if (name?.trim())
                await F.fileAction(
                  "move",
                  filename,
                  joinPath(parentPath(filename), name.trim()),
                );
            },
          },
          {
            label: I18N.t("Verschieben …"),
            run: async () => {
              const dest = prompt(
                I18N.t("Zielpfad innerhalb des Projekts (absolut oder relativ)"),
                filename,
              );
              if (dest?.trim() && dest !== filename)
                await F.fileAction("move", filename, dest.trim());
            },
          },
          {
            label: directory ? I18N.t("Als ZIP herunterladen") : I18N.t("Herunterladen"),
            run: () => F.downloadFile(filename),
          },
          {
            label: I18N.t("Endgültig löschen …"),
            danger: true,
            run: () => F.fileAction("delete", filename),
          },
        ],
        shortName(filename),
        x,
        y,
      );
    },
    downloadFile(filename) {
      const project = selectedProject();
      if (project)
        F.download(
          `/api/projects/${project.id}/download?path=${encodeURIComponent(filename)}`,
        );
    },
    exportChat(id) {
      F.download(`/api/chats/${encodeURIComponent(id)}/export`);
    },
    download(url) {
      const link = document.createElement("a");
      link.href = url;
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    },
    applyProjectDefaults() {
      const settings = selectedProject()?.settings;
      if (!settings) return;
      if (
        settings.model &&
        state.models.some((model) => model.model === settings.model)
      )
        $("model").value = settings.model;
      updateEfforts(settings.effort || undefined);
    },
    projectSettings(id) {
      const project = state.projects.find((p) => p.id === id);
      if (!project) return;
      F.settingsProject = id;
      $("project-settings-title").textContent = `${I18N.t("Vorgaben ·")} ${project.name}`;
      $("project-default-model").innerHTML =
        '<option value="">VM-/Modellvorgabe</option>' +
        state.models
          .map(
            (model) =>
              `<option value="${escapeHtml(model.model)}">${escapeHtml(model.displayName || model.model)}</option>`,
          )
          .join("");
      $("project-default-model").value = project.settings?.model || "";
      F.projectEfforts(project.settings?.effort || "");
      $("project-instructions").value = project.settings?.instructions || "";
      $("project-settings-error").textContent = "";
      $("project-settings-dialog").showModal();
    },
    projectEfforts(preferred = "") {
      const model = state.models.find(
        (model) =>
          model.model ===
          ($("project-default-model").value || $("model").value),
      );
      const choices = model?.supportedReasoningEfforts || [];
      $("project-default-effort").innerHTML =
        `<option value="">${I18N.t("Modellvorgabe")}</option>` +
        choices
          .map(
            (choice) =>
              `<option value="${escapeHtml(choice.reasoningEffort)}">${escapeHtml(choice.reasoningEffort)}</option>`,
          )
          .join("");
      if (choices.some((choice) => choice.reasoningEffort === preferred))
        $("project-default-effort").value = preferred;
    },
    async fetchContext(id) {
      if (!id || id.startsWith("draft-")) {
        F.updateContext();
        return;
      }
      try {
        const info = await api(`/api/chats/${encodeURIComponent(id)}/context`);
        if ((info.observedAt || 0) >= (F.contexts.get(id)?.observedAt || 0))
          F.contexts.set(id, info);
        if (state.thread?.id === id) F.updateContext();
      } catch {}
    },
    updateContext() {
      const button = $("context-indicator");
      if (!button) return;
      button.classList.toggle("hidden", state.view !== "chat" || !state.thread);
      const info = F.contexts.get(state.thread?.id),
        used = info?.last?.totalTokens,
        cap = info?.modelContextWindow;
      button.textContent = Number.isFinite(used)
        ? `${I18N.t("Kontext:")} ${cap > 0 ? Math.min(100, Math.round((100 * used) / cap)) + "%" : used.toLocaleString(I18N.locale) + " Tokens"}`
        : I18N.t("Kontext: —");
      button.title = Number.isFinite(used)
        ? `${used.toLocaleString(I18N.locale)} ${I18N.t("zuletzt gemeldete Tokens")}${cap ? " / " + cap.toLocaleString(I18N.locale) : ""}`
        : I18N.t("Noch keine Kontextwerte von Codex gemeldet");
      if ($("context-dialog").open) F.renderContext();
    },
    renderContext() {
      const info = F.contexts.get(state.thread?.id) || {},
        used = info.last?.totalTokens,
        cap = info.modelContextWindow;
      $("context-content").innerHTML = Number.isFinite(used)
        ? `<p><strong>${used.toLocaleString(I18N.locale)}</strong>${cap ? I18N.t(" von ") + cap.toLocaleString(I18N.locale) : ""} ${I18N.t("Tokens zuletzt gemeldet")}</p>${cap ? `<progress max="${cap}" value="${Math.min(used, cap)}"></progress>` : ""}<p class="muted">${I18N.t("Gesamtverbrauch dieses Chats:")} ${Number(info.total?.totalTokens || 0).toLocaleString(I18N.locale)} Tokens</p><p>${I18N.t("Beobachtete Komprimierungen:")} ${info.compactions || 0}${info.lastCompactedAt ? I18N.t(" · zuletzt ") + new Date(info.lastCompactedAt).toLocaleString(I18N.locale) : ""}</p><small class="muted">${I18N.t("Zuletzt gemeldet:")} ${new Date(info.recordedAt || info.observedAt).toLocaleString(I18N.locale)}${I18N.t(". Diese Anzeige beschreibt den Chatkontext, nicht dein Kontingent.")}</small>`
        : `<p>${I18N.t("Codex hat für diesen Chat noch keine Kontextwerte gemeldet. Sobald Werte eintreffen, erscheinen sie hier.")}</p>`;
      $("context-compact").disabled =
        !state.thread || state.thread.draft || $("show-archived").checked;
    },
    async refreshTasks() {
      const result = await api("/api/tasks");
      F.tasks = result.tasks;
      const active = result.tasks.filter((task) =>
        ["working", "waiting"].includes(task.status),
      ).length;
      $("tasks-count").textContent = active || "";
      if (state.view === "tasks") F.renderTasks();
      return result;
    },
    async showTasks() {
      if (state.pendingSend)
        return toast(I18N.t("Der Auftrag wird gerade übermittelt."));
      if (!canLeaveEditor()) return;
      clearChat("tasks");
      updateComposer();
      $("chat").innerHTML =
        `<div class="history-loading"><span class="loading-spinner"></span> ${I18N.t("Aufgaben werden geladen …")}</div>`;
      try {
        await F.refreshTasks();
      } catch (error) {
        if (state.view === "tasks")
          $("chat").innerHTML =
            `<div class="empty-list">${escapeHtml(error.message)}</div>`;
      }
    },
    renderTasks() {
      if (state.view !== "tasks") return;
      const labels = {
        working: I18N.t("Arbeitet"),
        waiting: I18N.t("Wartet auf dich"),
        completed: I18N.t("Fertig"),
        failed: I18N.t("Fehler"),
        interrupted: I18N.t("Gestoppt"),
        idle: I18N.t("Bereit"),
      };
      $("chat").innerHTML =
        `<section class="task-dashboard"><div class="gallery-heading"><div><div class="eyebrow">${I18N.t("PROJEKTÜBERGREIFEND")}</div><h1>${I18N.t("Aufgaben")}</h1></div><button class="subtle" type="button" data-task-refresh>${I18N.t("Aktualisieren ↻")}</button></div><p class="muted">${I18N.t("Laufende und zuletzt bearbeitete Chats")}</p>${(F.tasks || []).map((task) => `<article class="task-card" data-task="${escapeHtml(task.threadId)}"><div><span class="task-status ${escapeHtml(task.status)}">${labels[task.status] || I18N.t("Bereit")}</span><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.projectName)}${task.startedAt ? " · " + Math.max(0, Math.floor(((task.status === "working" || task.status === "waiting" ? Date.now() : task.updatedAt) - task.startedAt) / 1000)) + " s" : ""}</small>${task.error ? `<p class="danger-text">${escapeHtml(task.error)}</p>` : ""}</div><div><button type="button" class="subtle" data-task-open="${escapeHtml(task.threadId)}">${I18N.t("Chat öffnen")}</button>${["working", "waiting"].includes(task.status) ? `<button class="subtle danger-text" type="button" data-task-stop="${escapeHtml(task.threadId)}" data-turn-id="${escapeHtml(task.turnId || "")}">${I18N.t("Stoppen")}</button>` : ""}</div></article>`).join("") || `<p class="empty-list">${I18N.t("Noch keine Aufgaben vorhanden.")}</p>`}</section>`;
    },
    handleEvent(message) {
      const { method, params: p = {} } = message;
      if (method === "turn/started") {
        F.refreshTasks().catch(() => {});
      }
      if (method === "console/workbench") {
        F.pins = p.pins;
        F.refreshPins().catch(() => {});
      }
      if (method === "thread/tokenUsage/updated") {
        F.contexts.set(p.threadId, {
          ...F.contexts.get(p.threadId),
          ...p.tokenUsage,
          observedAt: Date.now(),
          compactions: F.contexts.get(p.threadId)?.compactions || 0,
        });
        F.updateContext();
      }
      if (method === "item/completed" && p.item?.type === "contextCompaction") {
        const info = F.contexts.get(p.threadId) || {};
        info.compactions = (info.compactions || 0) + 1;
        info.lastCompactedAt = Date.now();
        F.contexts.set(p.threadId, info);
        F.updateContext();
      }
      if (method === "turn/completed") {
        F.refreshTasks().catch(() => {});
      }
    },
    focusHistory() {
      const id = state.historyFocus?.itemId;
      if (!id) return;
      const node = [...$("chat").children].find(
        (node) => node.dataset.item === id,
      );
      if (node) {
        node.classList.add("search-target");
        node.scrollIntoView({ block: "center" });
        state.lastChatScrollTop = $("chat").scrollTop;
      } else
        toast(
          I18N.t("Die Fundstelle hat sich geändert. Bitte den Suchindex aktualisieren."),
        );
    },
    showSearch() {
      $("global-search-project").innerHTML =
        `<option value="">${I18N.t("Alle Projekte")}</option>` +
        state.projects
          .map(
            (project) =>
              `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`,
          )
          .join("");
      $("global-search-project").value = "";
      $("global-search-dialog").showModal();
      $("global-search-input").focus();
      F.search();
    },
    async search(force = false) {
      clearTimeout(F.searchTimer);
      const revision = ++F.searchRevision;
      const query = new URLSearchParams({
        q: $("global-search-input").value,
        projectId: $("global-search-project").value,
        archived: $("global-search-archive").checked ? "1" : "0",
      });
      if (force) query.set("refresh", "1");
      try {
        const result = await api("/api/search?" + query);
        if (revision !== F.searchRevision || !$("global-search-dialog").open)
          return;
        F.searchResults = result.results;
        const progress = result.progress;
        $("global-search-status").textContent = progress.running
          ? `${I18N.t("Index wird aktualisiert …")} ${progress.done}/${progress.total} Chats`
          : `${result.total} ${I18N.t("Treffer")}${result.total > 100 ? I18N.t(" · erste 100 angezeigt") : ""}${progress.errors ? I18N.t(" · Einige Chats konnten noch nicht gelesen werden.") : ""}`;
        $("global-search-results").innerHTML =
          result.results
            .map(
              (hit, index) =>
                `<button class="search-result" type="button" data-search-result="${index}"><strong>${escapeHtml(hit.threadName)}${hit.archived ? I18N.t(" · Archiv") : ""}</strong><small>${escapeHtml(hit.projectName)}</small><p>${escapeHtml(hit.snippet)}</p></button>`,
            )
            .join("") ||
          `<p class="empty-list">${progress.running ? I18N.t("Die ersten Treffer erscheinen während der Indexierung.") : $("global-search-input").value ? I18N.t("Keine Treffer.") : I18N.t("Suchbegriff eingeben.")}</p>`;
        if (progress.running) F.searchTimer = setTimeout(() => F.search(), 800);
      } catch (error) {
        if (revision === F.searchRevision)
          $("global-search-status").textContent = error.message;
      }
    },
    async version(force) {
      const value = await api("/api/version?check=" + (force ? "force" : "1"));
      F.release = value;
      $("version-button").textContent =
        "v" +
        value.current +
        (value.updateAvailable ? I18N.t(" · Update verfügbar") : "");
      $("version-button").classList.toggle(
        "update-available",
        value.updateAvailable,
      );
      if ($("work-settings-dialog").open) F.renderVersion();
    },
    renderVersion() {
      const value = F.release;
      const published = value?.publishedAt ? new Date(value.publishedAt).toLocaleDateString(I18N.locale, { year: "numeric", month: "long", day: "numeric" }) : null;
      $("version-details").innerHTML = value
        ? `<strong>${I18N.t("Installiert:")} ${escapeHtml(value.current)}</strong><p class="release-state">${value.updateAvailable ? I18N.t("Neue Version verfügbar") : value.latest ? I18N.t("Keine neuere Version verfügbar.") : I18N.t("Noch keine Release-Information verfügbar.")}</p>${value.latest ? `<dl class="release-details"><dt>${I18N.t("Version")}</dt><dd>${escapeHtml(value.latest)}</dd><dt>${I18N.t("Veröffentlicht am")}</dt><dd>${escapeHtml(published || I18N.t("Nicht verfügbar"))}</dd></dl>` : ""}${value.error ? `<p class="muted">${escapeHtml(I18N.t(value.error))}</p>` : ""}<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener noreferrer">${I18N.t("GitHub-Releases öffnen ↗")}</a><p class="muted">${I18N.t("Die Prüfung liest nur Release-Informationen. Aktualisierungen führt der Betreiber durch.")}</p>`
        : I18N.t("Release-Information wird geladen …");
    },
  };
  globalThis.codexFeatures = F;

  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <dialog id="global-search-dialog" class="wide-dialog"><div class="dialog-heading"><h2>${I18N.t("Chats durchsuchen")}</h2><button type="button" class="icon-button" data-feature-close aria-label="${I18N.t("Schließen")}">×</button></div><input id="global-search-input" type="search" placeholder="${I18N.t("Alle Nachrichten und Aktivitäten durchsuchen …")}" aria-label="${I18N.t("Volltextsuche")}"><div class="search-options"><select id="global-search-project" aria-label="${I18N.t("Suchprojekt")}"></select><label><input type="checkbox" id="global-search-archive" checked> ${I18N.t("Archiv einbeziehen")}</label><button class="subtle" type="button" id="refresh-search-index">${I18N.t("Index aktualisieren")}</button></div><p id="global-search-status" role="status" class="muted"></p><div id="global-search-results"></div></dialog>
  <dialog id="project-settings-dialog"><form id="project-settings-form"><div class="dialog-heading"><h2 id="project-settings-title">${I18N.t("Projektvorgaben")}</h2><button type="button" class="icon-button" data-feature-close aria-label="${I18N.t("Schließen")}">×</button></div><label>${I18N.t("Standardmodell")}<select id="project-default-model"></select></label><label>${I18N.t("Denkaufwand")}<select id="project-default-effort"><option value="">${I18N.t("Modellvorgabe")}</option>${["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((value) => `<option>${value}</option>`).join("")}</select></label><label>${I18N.t("Projektanweisungen")}<textarea id="project-instructions" rows="7" maxlength="20000" placeholder="${I18N.t("Zum Beispiel: Antworte auf Deutsch. Verwende die vorhandenen Projektkonventionen.")}"></textarea></label><p class="muted">${I18N.t("Modell und Denkaufwand gelten als Vorgabe für neue Chats. Projektanweisungen werden beim Start oder erneuten Öffnen eines Chats übernommen.")}</p><p id="project-settings-error" class="form-error"></p><div class="dialog-actions"><button type="button" class="subtle" data-feature-close>${I18N.t("Abbrechen")}</button><button type="submit" class="accent-button">${I18N.t("Speichern")}</button></div></form></dialog>
  <dialog id="context-dialog"><div class="dialog-heading"><h2>${I18N.t("Chatkontext")}</h2><button type="button" class="icon-button" data-feature-close aria-label="${I18N.t("Schließen")}">×</button></div><div id="context-content"></div><div class="dialog-actions"><button id="context-refresh" type="button" class="subtle">${I18N.t("Aktualisieren")}</button><button id="context-compact" type="button" class="accent-button">${I18N.t("Kontext komprimieren")}</button></div></dialog>
  <dialog id="work-settings-dialog"><div class="dialog-heading"><h2>${I18N.t("Info")}</h2><button type="button" class="icon-button" data-feature-close aria-label="${I18N.t("Schließen")}">×</button></div><h3>Codex-Web</h3><div id="version-details"></div><button type="button" class="subtle" id="check-version">${I18N.t("Nach Updates suchen")}</button></dialog>
  <input type="file" id="attachment-picker" multiple hidden><input type="file" id="explorer-upload-picker" multiple hidden>
  `,
  );
  document
    .querySelector(".brand")
    .insertAdjacentHTML(
      "afterend",
      `<div class="workbench-nav"><button type="button" class="archive-nav" id="open-global-search">${I18N.t("⌕ Suche")} <kbd>Ctrl Shift F</kbd></button><button type="button" class="archive-nav" id="open-tasks">${I18N.t("☷ Aufgaben")} <span id="tasks-count" class="count"></span></button></div>`,
    );
  $("composer").insertAdjacentHTML(
    "afterbegin",
    '<div id="composer-attachments" class="composer-attachments"></div>',
  );
  $("composer").insertAdjacentHTML(
    "afterend",
    '<div id="upload-status" role="status" class="upload-status"></div>',
  );
  document
    .querySelector(".top-actions")
    .insertAdjacentHTML(
      "afterbegin",
      `<button id="context-indicator" type="button" class="subtle hidden">${I18N.t("Kontext: —")}</button>`,
    );
  document
    .querySelector(".ide-statusbar")
    .insertAdjacentHTML(
      "beforeend",
      `<button type="button" id="version-button" title="${I18N.t("Version und Updatehinweis")}">${I18N.t("Version …")}</button>`,
    );
  document
    .querySelector(".file-toolbar")
    .insertAdjacentHTML(
      "afterend",
      `<div class="file-actions"><button type="button" class="subtle" id="new-file">${I18N.t("+ Datei")}</button><button type="button" class="subtle" id="new-folder">${I18N.t("+ Ordner")}</button><button type="button" class="subtle" id="upload-project-files">↑ Upload</button><button type="button" class="subtle" id="download-directory">↓ ZIP</button></div>`,
    );
  updateSendShortcut();
  I18N.capture(document.body);

  document.addEventListener(
    "click",
    safe(async (event) => {
      if (event.target.closest("[data-feature-close]"))
        event.target.closest("dialog").close();
      const result = event.target.closest("[data-search-result]");
      if (result) {
        const hit = F.searchResults[Number(result.dataset.searchResult)];
        $("global-search-dialog").close();
        await openThread(hit.threadId, {
          cursor: hit.cursor,
          itemId: hit.itemId,
          archived: hit.archived,
        });
      }
      const remove = event.target.closest("[data-remove-attachment]");
      if (remove) {
        F.attachments.splice(Number(remove.dataset.removeAttachment), 1);
        F.inputRevision++;
        F.renderAttachments();
        await F.saveDraft();
      }
      const task = event.target.closest("[data-task-open]");
      if (task) await openThread(task.dataset.taskOpen, { archived: false });
      const stop = event.target.closest("[data-task-stop]");
      if (stop) {
        stop.disabled = true;
        await rpc("turn/interrupt", {
          threadId: stop.dataset.taskStop,
          turnId: stop.dataset.turnId,
        });
        await F.refreshTasks();
      }
      if (event.target.closest("[data-task-refresh]")) await F.refreshTasks();
    }),
  );
  $("prompt").addEventListener("input", () => {
    F.inputRevision++;
    if (F.currentKey) F.cacheDraft(F.currentKey, F.capture());
    clearTimeout(F.saveTimer);
    F.saveTimer = setTimeout(
      () =>
        F.saveDraft().catch(() =>
          toast(
            I18N.t("Entwurf lokal gespeichert; Speicherung auf dem Server momentan nicht möglich."),
          ),
        ),
      350,
    );
  });
  $("prompt").addEventListener("paste", (event) => {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      F.upload(files).catch((error) => toast(error.message));
    }
  });
  for (const node of [$("composer"), $("files-tab")]) {
    node.addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
        node.classList.add("file-drop-active");
      }
    });
    node.addEventListener("dragleave", () =>
      node.classList.remove("file-drop-active"),
    );
    node.addEventListener("drop", (event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      node.classList.remove("file-drop-active");
      const directory =
        node.id === "files-tab"
          ? event.target.closest('[data-directory="true"]')?.dataset.file ||
            state.directory
          : null;
      F.upload(event.dataTransfer.files, directory).catch((error) =>
        toast(error.message),
      );
    });
  }
  $("attach-files").onclick = () => $("attachment-picker").click();
  $("attachment-picker").onchange = safe(async (event) => {
    await F.upload(event.target.files);
    event.target.value = "";
  });
  $("upload-project-files").onclick = () => $("explorer-upload-picker").click();
  $("explorer-upload-picker").onchange = safe(async (event) => {
    await F.upload(event.target.files, state.directory);
    event.target.value = "";
  });
  $("new-file").onclick = safe(() => F.createFile(false));
  $("new-folder").onclick = safe(() => F.createFile(true));
  $("download-directory").onclick = () => F.downloadFile(state.directory);
  $("file-list").addEventListener("contextmenu", (event) => {
    const file = event.target.closest("[data-file]");
    if (file) {
      event.preventDefault();
      F.fileMenu(
        file.dataset.file,
        file.dataset.directory === "true",
        event.clientX,
        event.clientY,
      );
    }
  });
  $("open-global-search").onclick = () => F.showSearch();
  $("open-tasks").onclick = safe(() => F.showTasks());
  $("global-search-input").oninput = () => {
    clearTimeout(F.searchTimer);
    F.searchRevision++;
    F.searchTimer = setTimeout(() => F.search(), 200);
  };
  $("global-search-project").onchange = () => F.search();
  $("global-search-archive").onchange = () => F.search();
  $("refresh-search-index").onclick = () => F.search(true);
  $("global-search-dialog").addEventListener("close", () => {
    F.searchRevision++;
    clearTimeout(F.searchTimer);
  });
  $("project-default-model").onchange = () => F.projectEfforts();
  $("project-settings-form").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api(
        `/api/projects/${F.settingsProject}/settings`,
        {
          model: $("project-default-model").value,
          effort: $("project-default-effort").value,
          instructions: $("project-instructions").value,
        },
        "PATCH",
      );
      projectSnapshot(result);
      if (state.thread?.draft) F.applyProjectDefaults();
      $("project-settings-dialog").close();
      toast(I18N.t("Projektvorgaben gespeichert."));
    } catch (error) {
      $("project-settings-error").textContent = error.message;
    }
  };
  $("context-indicator").onclick = () => {
    F.renderContext();
    $("context-dialog").showModal();
  };
  $("context-refresh").onclick = () => F.fetchContext(state.thread?.id);
  $("context-compact").onclick = safe(async () => {
    if (state.thread && !state.thread.draft) {
      await rpc("thread/compact/start", { threadId: state.thread.id });
      $("context-dialog").close();
      toast(I18N.t("Kontextkomprimierung gestartet."));
    }
  });
  const showInfo = () => {
    F.renderVersion();
    $("work-settings-dialog").showModal();
    F.version(false).catch(() => {});
  };
  $("version-button").onclick = showInfo;
  $("check-version").onclick = safe(async () => {
    $("check-version").disabled = true;
    try {
      await F.version(true);
    } finally {
      $("check-version").disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      state.authenticated &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      F.showSearch();
    }
  });
  window.addEventListener("pagehide", () => {
    F.saveDraft().catch(() => {});
  });
  // Persist widths per browser; the mobile layout continues to use its overlay panels.
  let widths = {};
  try {
    widths = JSON.parse(localStorage.getItem("codex.panel-widths") || "{}");
  } catch {}
  const applyWidths = () => {
    for (const key of ["sidebar", "tools"])
      if (widths[key])
        document.documentElement.style.setProperty(
          "--" + key + "-width",
          widths[key] + "px",
        );
  };
  applyWidths();
  for (const key of ["sidebar", "tools"]) {
    const panel = $(key),
      handle = document.createElement("div");
    handle.className = "panel-resizer " + key + "-resizer";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute(
      "aria-label",
      key === "sidebar"
        ? I18N.t("Breite der Projektleiste")
        : I18N.t("Breite des Werkzeugpanels"),
    );
    handle.setAttribute("aria-orientation", "vertical");
    panel.append(handle);
    const resize = (value) => {
      const max =
        key === "sidebar"
          ? Math.min(500, innerWidth - 500)
          : Math.min(850, innerWidth * 0.7);
      widths[key] = Math.max(
        key === "sidebar" ? 180 : 260,
        Math.min(max, value),
      );
      applyWidths();
      handle.setAttribute("aria-valuenow", Math.round(widths[key]));
      localStorage.setItem("codex.panel-widths", JSON.stringify(widths));
    };
    handle.onpointerdown = (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = event.clientX,
        width = panel.getBoundingClientRect().width;
      document.body.classList.add("resizing-panels");
      handle.onpointermove = (move) =>
        resize(width + (move.clientX - start) * (key === "sidebar" ? 1 : -1));
    };
    const end = () => {
      handle.onpointermove = null;
      document.body.classList.remove("resizing-panels");
    };
    handle.onpointerup = end;
    handle.onpointercancel = end;
    handle.onkeydown = (event) => {
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        resize(
          panel.getBoundingClientRect().width +
            (event.key === "ArrowRight" ? 10 : -10) *
              (key === "sidebar" ? 1 : -1),
        );
      }
    };
    handle.ondblclick = () => {
      delete widths[key];
      document.documentElement.style.removeProperty("--" + key + "-width");
      localStorage.setItem("codex.panel-widths", JSON.stringify(widths));
    };
  }
  const observer = new MutationObserver(() => F.decoratePins());
  observer.observe($("thread-list"), { childList: true });
  observer.observe($("chat"), { childList: true });
  setInterval(() => {
    if (
      state.authenticated &&
      (state.view === "tasks" && !document.hidden)
    )
      F.refreshTasks().catch(() => {});
  }, 10000);
  if (state.authenticated) F.bootstrap();
})();
