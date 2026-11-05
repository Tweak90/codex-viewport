"use strict";
(() => {
  const groups = [
    { id: "general", title: () => I18N.t("Allgemeine Einstellungen"), description: () => I18N.t("Sprache, Sendetaste und Folgenachrichten."), fields: ["CODEX_WEB_LANGUAGE", "CODEX_SEND_WITH", "CODEX_FOLLOWUP_MODE"] },
    { id: "codex", title: () => I18N.t("Codex-Einstellungen"), description: () => I18N.t("Codex-Host, Verbindung und Speicherort für neue Projekte."), fields: ["HOST_LABEL", "CODEX_WS_URL", "CODEX_API_TOKEN", "CODEX_PROJECTS_ROOT"] },
    { id: "updates", title: () => I18N.t("Updates"), description: () => I18N.t("GitHub-Releases und Informationen zu dieser Weboberfläche."), fields: ["CODEX_RELEASE_REPOSITORY", "CODEX_GITHUB_TOKEN"] },
  ];
  const help = {
    CODEX_WEB_LANGUAGE: () => I18N.t("Sprache für Menüs und Bedienelemente. Chatnachrichten werden nicht übersetzt."),
    HOST_LABEL: () => I18N.t("Dieser Name wird in der Oberfläche für deinen Codex-Host angezeigt."),
    CODEX_SEND_WITH: () => I18N.t("Wähle, welche Tastenkombination sendet und welche einen Zeilenumbruch einfügt."),
    CODEX_FOLLOWUP_MODE: () => I18N.t("Steuern gibt eine Nachricht direkt an die laufende Aufgabe weiter. Die Warteschlange wartet, bis die Aufgabe beendet ist."),
    CODEX_WS_URL: () => I18N.t("Adresse der externen Codex-API, beginnend mit ws:// oder wss://."),
    CODEX_API_TOKEN: () => I18N.t("Bearer-Token für die Codex-API, falls der Endpunkt einen Token verlangt. Dies ist kein OpenAI-API-Key."),
    CODEX_PROJECTS_ROOT: () => I18N.t("Neue Projekte werden unter diesem absoluten Pfad angelegt. Leer lassen für die automatische Vorgabe."),
    CODEX_RELEASE_REPOSITORY: () => I18N.t("GitHub-Repository im Format owner/repo. Leer lassen, um dieses Projekt zu verwenden."),
    CODEX_GITHUB_TOKEN: () => I18N.t("Für öffentliche Releases nicht nötig. Optional für private Repositorys oder ein höheres GitHub-Anfragelimit."),
  };
  const dialog = document.createElement("dialog");
  dialog.id = "application-settings-dialog";
  dialog.setAttribute("aria-labelledby", "application-settings-title");
  dialog.innerHTML = `<form id="application-settings-form">
    <header class="settings-header">
      <div class="dialog-heading"><h2 id="application-settings-title">${I18N.t("Einstellungen")}</h2><button class="icon-button" type="button" data-settings-close aria-label="${I18N.t("Schließen")}">×</button></div>
      <details class="settings-help"><summary>${I18N.t("Woher kommen die Standardwerte?")}</summary><p>${I18N.t("Leere Felder übernehmen den Standard aus der Umgebungskonfiguration (ENV) oder der Anwendungsvorgabe. Eigene Angaben haben Vorrang. Änderungen werden im Datenvolume gespeichert.")}</p></details>
    </header>
    <div class="settings-layout">
      <nav class="settings-nav" role="tablist" aria-label="${I18N.t("Einstellungsbereiche")}" aria-orientation="vertical">${groups.map((group, index) => `<button type="button" id="settings-tab-${group.id}" role="tab" aria-controls="settings-panel-${group.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-settings-tab="${group.id}" disabled>${group.title()}</button>`).join("")}</nav>
      <div id="application-settings-fields" class="settings-panels" aria-busy="true"></div>
    </div>
    <footer class="settings-footer">
      <div class="settings-feedback"><p id="application-settings-status" role="status"></p><p id="application-settings-error" class="form-error" role="alert"></p></div>
      <div class="dialog-actions"><button type="button" class="subtle" data-settings-close>${I18N.t("Abbrechen")}</button><button type="submit" class="accent-button" id="save-application-settings">${I18N.t("Speichern")}</button></div>
    </footer>
  </form>`;
  document.body.append(dialog);
  I18N.capture(dialog);
  let snapshot, loadVersion = 0;
  const optionName = (value) => ({
    steer: I18N.t("Laufenden Auftrag steuern"), queue: I18N.t("Nachricht in Warteschlange stellen"),
    de: "Deutsch", en: "English", shiftEnter: I18N.t("Shift+Enter senden · Enter Zeilenumbruch"), enter: I18N.t("Enter senden · Shift+Enter Zeilenumbruch"),
  })[value] || value;
  function fallbackText(field) {
    if (field.name === "CODEX_WS_URL" && !field.fallback) return I18N.t("API-Adresse erforderlich");
    return field.secret
      ? field.fallbackConfigured ? I18N.t("Standardwert vorhanden (verborgen)") : I18N.t("Kein Standardwert hinterlegt")
      : field.fallback || I18N.t("Automatische Vorgabe");
  }
  function sourceText(field, overridden) {
    return overridden ? I18N.t("Eigener Wert") : field.fallbackSource === "env" ? I18N.t("Umgebungswert") : I18N.t("Standardwert");
  }
  function fieldHtml(field) {
    const id = `setting-${field.name}`;
    const fallback = fallbackText(field);
    const automatic = field.type === "select" ? `${I18N.t("Standard")} · ${optionName(field.fallback)}` : "";
    const control = field.type === "select"
      ? `<select id="${id}" name="${field.name}" aria-describedby="${id}-help"><option value="">${escapeHtml(automatic)}</option>${field.options.map((value) => `<option value="${value}" ${value === field.override ? "selected" : ""}>${escapeHtml(optionName(value))}</option>`).join("")}</select>`
      : `<input id="${id}" name="${field.name}" type="${field.secret ? "password" : "text"}" aria-describedby="${id}-help" autocomplete="off" value="${escapeHtml(field.override || "")}" placeholder="${escapeHtml(field.secret && field.hasOverride ? I18N.t("Gespeicherter Wert aktiv (verborgen)") : fallback)}" ${field.secret ? 'data-secret="true"' : ""}>`;
    return `<section class="application-setting" data-setting="${field.name}">
      <div class="setting-label-row"><label for="${id}">${escapeHtml(I18N.t(field.label))}</label><span class="setting-source-badge ${field.hasOverride ? "is-overridden" : ""}">${sourceText(field, field.hasOverride)}</span></div>
      <p class="setting-description" id="${id}-help">${escapeHtml(help[field.name]?.() || "")}</p>
      ${control}
      ${field.secret && field.hasOverride ? `<small class="setting-secret-note">${I18N.t("Der gespeicherte geheime Wert wird nicht angezeigt. Ohne Änderung bleibt er erhalten. „Standard verwenden“ entfernt ihn.")}</small>` : ""}
      <div class="setting-meta"><details class="setting-details"><summary>${I18N.t("ENV-Details")}</summary><code>${field.name}</code><p>${I18N.t("Standardwert")}: <span>${escapeHtml(fallback)}</span></p></details><button type="button" class="subtle" data-setting-reset="${field.name}" ${field.hasOverride ? "" : "disabled"}>${I18N.t("Standard verwenden")}</button></div>
    </section>`;
  }
  function selectGroup(id, focus = false) {
    for (const tab of dialog.querySelectorAll("[data-settings-tab]")) {
      const selected = tab.dataset.settingsTab === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of dialog.querySelectorAll("[data-settings-panel]")) panel.hidden = panel.dataset.settingsPanel !== id;
    $("application-settings-fields").scrollTop = 0;
  }
  function renderFields() {
    const fields = new Map(snapshot.fields.map((field) => [field.name, field]));
    $("application-settings-fields").innerHTML = groups.map((group) => `<section role="tabpanel" id="settings-panel-${group.id}" aria-labelledby="settings-tab-${group.id}" data-settings-panel="${group.id}" ${group.id === "general" ? "" : "hidden"}>
      <h3 class="settings-section-title">${group.title()}</h3><p class="settings-section-description">${group.description()}</p>
      ${group.fields.filter((name) => fields.has(name)).map((name) => fieldHtml(fields.get(name))).join("")}
      ${group.id === "updates" ? `<button type="button" class="settings-info subtle" id="open-version-details">${I18N.t("Info")} <span aria-hidden="true">↗</span></button>` : ""}
    </section>`).join("");
    $("application-settings-fields").setAttribute("aria-busy", "false");
    for (const tab of dialog.querySelectorAll("[data-settings-tab]")) tab.disabled = false;
    selectGroup("general");
  }
  async function openSettings() {
    const version = ++loadVersion;
    snapshot = undefined;
    $("application-settings-error").textContent = "";
    $("application-settings-status").textContent = I18N.t("Einstellungen werden geladen …");
    $("application-settings-fields").setAttribute("aria-busy", "true");
    $("application-settings-fields").innerHTML = '<div class="settings-loading"><span class="loading-spinner" aria-hidden="true"></span></div>';
    for (const tab of dialog.querySelectorAll("[data-settings-tab]")) tab.disabled = true;
    $("save-application-settings").disabled = true;
    dialog.showModal();
    try {
      const loaded = await api("/api/settings");
      if (version !== loadVersion || !dialog.open) return;
      snapshot = loaded;
      renderFields();
      $("application-settings-status").textContent = "";
      $("save-application-settings").disabled = false;
    } catch (error) {
      if (version !== loadVersion || !dialog.open) return;
      $("application-settings-fields").setAttribute("aria-busy", "false");
      $("application-settings-fields").replaceChildren();
      $("application-settings-status").textContent = "";
      $("application-settings-error").textContent = error.message;
    }
  }
  function updateField(input) {
    const field = snapshot?.fields.find((field) => field.name === input.name);
    if (!field) return;
    input.dataset.changed = "true";
    const overridden = Boolean(input.value.trim());
    const section = input.closest(".application-setting");
    const badge = section.querySelector(".setting-source-badge");
    badge.textContent = sourceText(field, overridden);
    badge.classList.toggle("is-overridden", overridden);
    section.querySelector("[data-setting-reset]").disabled = !overridden;
    if (field.secret) {
      input.placeholder = fallbackText(field);
      section.querySelector(".setting-secret-note")?.classList.add("hidden");
    }
    $("application-settings-status").textContent = I18N.t("Noch nicht gespeichert");
  }
  $("open-settings").onclick = safe(openSettings);
  const narrowLayout = matchMedia("(max-width: 640px)");
  const updateOrientation = () => dialog.querySelector(".settings-nav").setAttribute("aria-orientation", narrowLayout.matches ? "horizontal" : "vertical");
  narrowLayout.addEventListener("change", updateOrientation);
  updateOrientation();
  dialog.addEventListener("close", () => { loadVersion++; });
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-settings-close]")) dialog.close();
    const tab = event.target.closest("[data-settings-tab]");
    if (tab && !tab.disabled) selectGroup(tab.dataset.settingsTab);
    const reset = event.target.closest("[data-setting-reset]");
    if (reset && !reset.disabled) {
      const input = $(`setting-${reset.dataset.settingReset}`);
      input.value = "";
      updateField(input);
    }
    if (event.target.closest("#open-version-details")) {
      dialog.close();
      $("version-button").click();
    }
  });
  dialog.querySelector(".settings-nav").addEventListener("keydown", (event) => {
    const tabs = [...dialog.querySelectorAll("[data-settings-tab]:not(:disabled)")];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    selectGroup(tabs[next].dataset.settingsTab, true);
    tabs[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  dialog.addEventListener("input", (event) => updateField(event.target));
  $("application-settings-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!snapshot || !canLeaveEditor()) return;
    $("save-application-settings").disabled = true;
    $("application-settings-error").textContent = "";
    try {
      await globalThis.codexFeatures?.flushDraft();
      const values = {};
      for (const field of snapshot.fields) {
        const input = $(`setting-${field.name}`);
        if (!field.secret || input.dataset.changed || !field.hasOverride)
          values[field.name] = input.value;
      }
      const saved = await api("/api/settings", { values }, "PATCH");
      localStorage.setItem("codex.language", saved.language);
      location.reload();
    } catch (error) {
      $("application-settings-error").textContent = error.message;
      $("save-application-settings").disabled = false;
    }
  };
})();
