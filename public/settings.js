"use strict";
(() => {
  const dialog = document.createElement("dialog");
  dialog.id = "application-settings-dialog";
  dialog.className = "wide-dialog";
  dialog.innerHTML = `<form id="application-settings-form"><div class="dialog-heading"><h2>${I18N.t("Einstellungen")}</h2><button class="icon-button" type="button" data-settings-close aria-label="${I18N.t("Schließen")}">×</button></div><p class="muted">${I18N.t("Leeres Feld: ENV-Wert verwenden. Ausgefülltes Feld: Einstellung hat Vorrang. Änderungen werden im Datenvolume gespeichert.")}</p><div id="application-settings-fields" class="application-settings-fields"></div><details class="settings-deployment"><summary>${I18N.t("Docker-Konfiguration")}</summary><p>${I18N.t("Ports, Volume-Mounts, Image-Tags und Gateway-Parameter werden über Docker oder Compose festgelegt. Diese Seite ändert keine Container und führt keine Deployments aus.")}</p></details><p id="application-settings-status" role="status"></p><p id="application-settings-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="subtle" id="open-notification-settings">${I18N.t("Benachrichtigungen & Version")}</button><button type="button" class="subtle" data-settings-close>${I18N.t("Abbrechen")}</button><button type="submit" class="accent-button" id="save-application-settings">${I18N.t("Speichern")}</button></div></form>`;
  document.body.append(dialog);
  I18N.capture(dialog);
  let snapshot;
  const optionName = (value) => ({
    steer: I18N.t("Laufenden Auftrag steuern"), queue: I18N.t("Nachricht in Warteschlange stellen"),
    de: "Deutsch", en: "English", shiftEnter: I18N.t("Shift+Enter senden · Enter Zeilenumbruch"), enter: I18N.t("Enter senden · Shift+Enter Zeilenumbruch"),
  })[value] || value;
  function fieldHtml(field) {
    const id = `setting-${field.name}`;
    const fallback = field.secret
      ? field.fallbackConfigured ? I18N.t("ENV-Wert vorhanden (verborgen)") : I18N.t("Kein ENV-Wert gesetzt")
      : field.fallback || I18N.t("Automatische Vorgabe");
    const control = field.type === "select"
      ? `<select id="${id}" name="${field.name}"><option value="">${I18N.t("ENV verwenden")}</option>${field.options.map((value) => `<option value="${value}" ${value === field.override ? "selected" : ""}>${escapeHtml(optionName(value))}</option>`).join("")}</select>`
      : `<input id="${id}" name="${field.name}" type="${field.secret ? "password" : "text"}" autocomplete="off" value="${escapeHtml(field.override || "")}" placeholder="${escapeHtml(field.secret && field.hasOverride ? I18N.t("Gespeicherter Wert aktiv (verborgen)") : fallback)}" ${field.secret ? 'data-secret="true"' : ""}>`;
    return `<section class="application-setting" data-setting="${field.name}"><label for="${id}">${escapeHtml(I18N.t(field.label))}</label><code>${field.name}</code>${control}<div class="setting-source"><small>${field.hasOverride ? I18N.t("Quelle: Einstellung") : field.source === "env" ? I18N.t("Quelle: ENV") : I18N.t("Quelle: Vorgabe")} · ${field.secret ? escapeHtml(fallback) : `ENV: ${escapeHtml(fallback)}`}</small><button type="button" class="subtle" data-setting-reset="${field.name}">${I18N.t("ENV verwenden")}</button></div>${field.secret && field.hasOverride ? `<small class="muted">${I18N.t("Der gespeicherte geheime Wert wird nicht angezeigt. Ohne Änderung bleibt er erhalten. „ENV verwenden“ entfernt ihn.")}</small>` : ""}</section>`;
  }
  async function openSettings() {
    $("application-settings-error").textContent = "";
    $("application-settings-status").textContent = I18N.t("Einstellungen werden geladen …");
    $("application-settings-fields").replaceChildren();
    $("save-application-settings").disabled = true;
    dialog.showModal();
    try {
      snapshot = await api("/api/settings");
      $("application-settings-fields").innerHTML = snapshot.fields.map(fieldHtml).join("");
      $("application-settings-status").textContent = "";
      $("save-application-settings").disabled = false;
    } catch (error) {
      $("application-settings-status").textContent = "";
      $("application-settings-error").textContent = error.message;
    }
  }
  $("open-settings").onclick = safe(openSettings);
  $("activity-settings").onclick = safe(openSettings);
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-settings-close]")) dialog.close();
    const reset = event.target.closest("[data-setting-reset]");
    if (reset) {
      const input = $(`setting-${reset.dataset.settingReset}`);
      input.value = "";
      input.dataset.changed = "true";
      input.placeholder = I18N.t("ENV verwenden");
      reset.closest(".application-setting").querySelector(".setting-source small").textContent = I18N.t("Quelle nach Speichern: ENV");
    }
  });
  dialog.addEventListener("input", (event) => { event.target.dataset.changed = "true"; });
  $("open-notification-settings").onclick = () => {
    dialog.close();
    $("version-button").click();
  };
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
