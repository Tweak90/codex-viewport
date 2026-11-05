import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson, httpError } from "./auth.mjs";
import { defaultRepository } from "./releases.mjs";

export const settingFields = [
  { name: "CODEX_WEB_LANGUAGE", label: "Sprache", type: "select", options: ["de", "en"], default: "en" },
  { name: "CODEX_SEND_WITH", label: "Nachricht senden mit", type: "select", options: ["shiftEnter", "enter"], default: "shiftEnter" },
  { name: "CODEX_FOLLOWUP_MODE", label: "Folgenachrichten während der Arbeit", type: "select", options: ["steer", "queue"], default: "steer" },
  { name: "HOST_LABEL", label: "Name des Codex-Hosts", default: "Codex-Host" },
  { name: "CODEX_WS_URL", label: "Codex-WebSocket-Adresse", type: "url" },
  { name: "CODEX_API_TOKEN", label: "Codex-API-Token", secret: true },
  { name: "CODEX_PROJECTS_ROOT", label: "Basisverzeichnis für neue Projekte", type: "path" },
  { name: "CODEX_RELEASE_REPOSITORY", label: "Repository für Updatehinweise", type: "repository", default: defaultRepository },
  { name: "CODEX_GITHUB_TOKEN", label: "GitHub-Token für Updatehinweise", secret: true },
];
const fields = new Map(settingFields.map((field) => [field.name, field]));
export class SettingsStore {
  static async load(directory, environment = process.env) {
    const store = new SettingsStore(directory, environment);
    try {
      const data = JSON.parse(await readFile(store.filename, "utf8"));
      const saved = data.overrides || {};
      const supported = Object.fromEntries(Object.entries(saved).filter(([name]) => fields.has(name)));
      store.overrides = store.validate(supported);
      if (Object.keys(saved).length !== Object.keys(supported).length)
        await atomicJson(store.filename, { version: 1, overrides: store.overrides });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return store;
  }
  constructor(directory, environment) {
    this.filename = path.join(directory, "settings.json");
    this.environment = { ...environment };
    this.overrides = {};
    this.queue = Promise.resolve();
  }
  fallback(name) {
    return this.environment[name] || fields.get(name)?.default || "";
  }
  value(name, overrides = this.overrides) {
    return overrides[name] || this.fallback(name);
  }
  validate(values) {
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw httpError(400, "Ungültige Einstellungen.");
    const result = {};
    for (const [name, input] of Object.entries(values)) {
      const field = fields.get(name);
      if (!field || typeof input !== "string" || input.length > 8192 || /[\u0000-\u001f]/.test(input))
        throw httpError(400, "Ungültiger Einstellungswert.");
      const value = input.trim();
      if (!value) continue;
      if (field.options && !field.options.includes(value))
        throw httpError(400, "Ungültige Auswahl.");
      if (field.type === "path" && !path.posix.isAbsolute(value))
        throw httpError(400, "Bitte einen absoluten Pfad angeben.");
      if (field.type === "url") {
        let url;
        try { url = new URL(value); } catch {}
        if (!url || !["ws:", "wss:"].includes(url.protocol) || url.username || url.password)
          throw httpError(400, "Bitte eine ws://- oder wss://-Adresse ohne eingebettete Zugangsdaten angeben.");
      }
      if (field.type === "repository" && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value))
        throw httpError(400, "Das Repository muss owner/repo enthalten.");
      if (name === "HOST_LABEL" && value.length > 100)
        throw httpError(400, "Der Hostname darf höchstens 100 Zeichen enthalten.");
      result[name] = value;
    }
    return result;
  }
  snapshot() {
    return {
      language: this.value("CODEX_WEB_LANGUAGE"),
      sendWith: this.value("CODEX_SEND_WITH"),
      followupMode: this.value("CODEX_FOLLOWUP_MODE"),
      fields: settingFields.map((field) => ({
        ...field,
        override: field.secret ? null : this.overrides[field.name] || "",
        fallback: field.secret ? null : this.fallback(field.name),
        effective: field.secret ? null : this.value(field.name),
        hasOverride: Boolean(this.overrides[field.name]),
        fallbackConfigured: Boolean(this.fallback(field.name)),
        fallbackSource: this.environment[field.name] ? "env" : "default",
        source: this.overrides[field.name] ? "settings" : this.environment[field.name] ? "env" : "default",
      })),
    };
  }
  async update(values, beforeSave = () => {}) {
    // Serialize merge, validation and persistence; simultaneous saves cannot lose keys.
    const operation = this.queue.catch(() => {}).then(async () => {
      const next = { ...this.overrides };
      this.validate(values);
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) next[key] = value.trim();
        else delete next[key];
      }
      await beforeSave(next);
      await atomicJson(this.filename, { version: 1, overrides: next });
      this.overrides = next;
      return this.snapshot();
    });
    this.queue = operation;
    return operation;
  }
}
