import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson, httpError } from "./auth.mjs";

const sources = ["cli", "vscode", "appServer", "exec"];
const childOf = (child, parent) =>
  child === parent || child.startsWith(parent.replace(/\/$/, "") + "/");
const missing = (error) =>
  /not found|no such file|does not exist|os error 2/i.test(error.message);
export function projectSlug(name) {
  return (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "projekt"
  );
}
export function validateDeletePath(
  target,
  { home, codexHome, projectRoot, otherPaths = [] },
) {
  const normalized = path.posix.normalize(target);
  const forbidden = [
    "/",
    "/home",
    "/tmp",
    "/var",
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/root",
    "/opt",
    "/srv",
    "/mnt",
    "/media",
    "/run",
    "/proc",
    "/sys",
    "/dev",
    home,
    codexHome,
    projectRoot,
  ];
  if (
    !path.posix.isAbsolute(target) ||
    normalized !== target ||
    forbidden.includes(target)
  )
    throw httpError(
      400,
      "Dieses Verzeichnis kann nicht als Projektordner gelöscht werden.",
    );
  if ([home, codexHome, projectRoot].some((p) => p && childOf(p, target)))
    throw httpError(
      400,
      "Ein übergeordnetes System- oder Projektverzeichnis kann nicht gelöscht werden.",
    );
  if (
    [
      codexHome,
      ...[".ssh", ".config", ".local"].map((p) => path.posix.join(home, p)),
      "/etc",
      "/usr",
      "/proc",
      "/sys",
      "/dev",
      "/run",
    ].some((p) => p && childOf(target, p))
  )
    throw httpError(
      400,
      "Geschützte Verzeichnisse können nicht gelöscht werden.",
    );
  if (otherPaths.some((p) => childOf(p, target)))
    throw httpError(
      409,
      "Der Ordner enthält ein weiteres verwaltetes Projekt.",
    );
}

export class ProjectStore {
  static async load(directory, bridge, projectRoot) {
    const store = new ProjectStore(directory, bridge, projectRoot);
    try {
      const saved = JSON.parse(await readFile(store.filename, "utf8"));
      if (Array.isArray(saved))
        store.data.projects = saved.map((p) => ({
          ...p,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        }));
      else store.data = { ...store.data, ...saved };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await store.save();
    return store;
  }
  constructor(directory, bridge, projectRoot) {
    this.filename = path.join(directory, "projects.json");
    this.bridge = bridge;
    this.configuredRoot = projectRoot;
    this.data = {
      version: 2,
      projects: [],
      deletedProjects: [],
      hiddenPaths: [],
      threadProjects: {},
      drafts: [],
      mediaIndex: {},
    };
    this.queue = Promise.resolve();
    this.operationQueue = Promise.resolve();
  }
  get home() {
    const codexHome = this.bridge.status.info?.codexHome;
    if (!codexHome || !path.posix.isAbsolute(codexHome))
      throw httpError(
        503,
        "Das Codex-Benutzerverzeichnis ist noch nicht verfügbar. Bitte die API-Verbindung prüfen.",
      );
    return path.posix.dirname(codexHome);
  }
  get projectRoot() {
    return this.configuredRoot || path.posix.join(this.home, "codex-projects");
  }
  snapshot() {
    return {
      projects: this.data.projects,
      deletedProjects: this.data.deletedProjects,
      hiddenPaths: this.data.hiddenPaths,
      threadProjects: this.data.threadProjects,
      drafts: this.data.drafts,
      projectRoot:
        this.configuredRoot ||
        (this.bridge.status.info?.codexHome ? this.projectRoot : null),
    };
  }
  save() {
    this.queue = this.queue
      .catch(() => {})
      .then(() => atomicJson(this.filename, this.data));
    return this.queue;
  }
  operation(fn) {
    const next = this.operationQueue.catch(() => {}).then(fn);
    this.operationQueue = next;
    return next;
  }
  find(id) {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) throw httpError(404, "Das Projekt existiert nicht mehr.");
    return project;
  }
  async observe(threads) {
    let changed = false;
    for (const thread of threads) {
      let project = this.data.projects.find(
        (p) => p.id === this.data.threadProjects[thread.id],
      );
      if (
        !project &&
        thread.cwd &&
        !this.data.hiddenPaths.includes(thread.cwd)
      ) {
        project = this.data.projects.find((p) => p.path === thread.cwd);
        if (!project) {
          project = {
            id: randomUUID(),
            name: path.posix.basename(thread.cwd),
            path: thread.cwd,
            createdAt: new Date().toISOString(),
            imported: true,
          };
          this.data.projects.push(project);
          changed = true;
        }
        this.data.threadProjects[thread.id] = project.id;
        changed = true;
      }
      thread.projectId = project?.id || null;
    }
    if (changed) await this.save();
    return threads;
  }
  async command(
    command,
    cwd = this.home,
    timeoutMs = 20000,
    outputBytesCap = 1048576,
  ) {
    const result = await this.bridge.call(
      "command/exec",
      {
        command,
        cwd,
        timeoutMs,
        outputBytesCap,
        sandboxPolicy: { type: "dangerFullAccess" },
      },
      timeoutMs + 10000,
    );
    if (result.exitCode !== 0)
      throw httpError(
        400,
        (result.stderr || result.stdout || "Befehl fehlgeschlagen").slice(
          -2000,
        ),
      );
    return result;
  }
  async create(input) {
    return this.operation(async () => {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 120)
        throw httpError(
          400,
          "Bitte einen Projektnamen mit höchstens 120 Zeichen eingeben.",
        );
      const target = path.posix.normalize(
        input.path || path.posix.join(this.projectRoot, projectSlug(name)),
      );
      if (!target.startsWith("/") || target === "/")
        throw httpError(400, "Bitte einen absoluten Projektpfad angeben.");
      if (this.data.projects.some((p) => p.path === target))
        throw httpError(
          409,
          "Dieses Verzeichnis ist bereits einem Projekt zugeordnet.",
        );
      const mode = input.mode || "local";
      if (!["local", "existing", "create", "clone"].includes(mode))
        throw httpError(400, "Ungültige Projektaktion.");
      if (mode === "local") {
        await this.bridge.call("fs/createDirectory", {
          path: target,
          recursive: true,
        });
      } else if (mode !== "existing") {
        try {
          await this.bridge.call("fs/getMetadata", { path: target });
          throw httpError(
            409,
            "Das Verzeichnis existiert bereits. Wähle „Vorhandenes Verzeichnis“.",
          );
        } catch (e) {
          if (!missing(e)) throw e;
        }
        await this.bridge.call("fs/createDirectory", {
          path: path.posix.dirname(target),
          recursive: true,
        });
        if (mode === "clone") {
          if (
            typeof input.repository !== "string" ||
            !input.repository.trim() ||
            input.repository.startsWith("-")
          )
            throw httpError(400, "Bitte eine Repository-URL eingeben.");
          await this.command(
            ["git", "clone", "--", input.repository.trim(), target],
            path.posix.dirname(target),
            600000,
          );
        } else {
          await this.bridge.call("fs/createDirectory", {
            path: target,
            recursive: false,
          });
          await this.command(["git", "init", "--", target], target);
        }
      }
      const meta = await this.bridge.call("fs/getMetadata", { path: target });
      if (!meta.isDirectory)
        throw httpError(400, "Der Projektpfad ist kein Verzeichnis.");
      const project = {
        id: randomUUID(),
        name,
        path: target,
        createdAt: new Date().toISOString(),
      };
      this.data.projects.push(project);
      this.data.hiddenPaths = this.data.hiddenPaths.filter((p) => p !== target);
      await this.save();
      return project;
    });
  }
  async rename(id, name) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
      throw httpError(400, "Bitte einen gültigen Projektnamen eingeben.");
    const project = this.find(id);
    project.name = name.trim();
    await this.save();
    return project;
  }
  async settings(id, input) {
    const project = this.find(id);
    const model = String(input.model || "").trim(),
      effort = String(input.effort || "");
    const instructions = String(input.instructions || "");
    if (
      model.length > 200 ||
      instructions.length > 20000 ||
      ![
        "",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ].includes(effort)
    )
      throw httpError(400, "Ungültige Projektvorgaben.");
    project.settings = { model, effort, instructions };
    await this.save();
    return project;
  }
  async draft(projectId) {
    const project = this.find(projectId);
    const now = Math.floor(Date.now() / 1000);
    const draft = {
      id: `draft-${randomUUID()}`,
      projectId,
      cwd: project.path,
      name: "Neuer Chat",
      preview: "",
      draft: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      turns: [],
    };
    this.data.drafts.push(draft);
    await this.save();
    return draft;
  }
  async instructionOptions(project) {
    if (!project.settings) return {};
    const current = await this.bridge.call("config/read", {
      cwd: project.path,
      includeLayers: false,
    });
    const base =
      current.config?.developer_instructions ||
      current.config?.developerInstructions ||
      "";
    return {
      developerInstructions: [base, project.settings.instructions]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  async materialize(draftId, options) {
    const draft = this.data.drafts.find((d) => d.id === draftId);
    if (!draft) throw httpError(404, "Der Chatentwurf existiert nicht mehr.");
    const project = this.find(draft.projectId);
    const result = await this.bridge.call("thread/start", {
      ...(project.settings?.model ? { model: project.settings.model } : {}),
      ...(await this.instructionOptions(project)),
      ...options,
      cwd: project.path,
    });
    this.data.threadProjects[result.thread.id] = project.id;
    this.data.drafts = this.data.drafts.filter((d) => d.id !== draftId);
    await this.save();
    result.thread.projectId = project.id;
    return result;
  }
  async allThreads(archived, cwd) {
    let cursor,
      threads = [];
    do {
      const result = await this.bridge.call("thread/list", {
        sourceKinds: sources,
        modelProviders: [],
        limit: 100,
        archived,
        ...(cwd ? { cwd } : {}),
        ...(cursor ? { cursor } : {}),
      });
      threads.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return threads;
  }
  async deleteProject(id, options) {
    return this.operation(async () => {
      const project = this.find(id);
      if (options.confirmName !== project.name)
        throw httpError(
          400,
          "Bitte den Projektnamen zur Bestätigung eingeben.",
        );
      const all = await this.allThreads(false);
      const threads = all.filter(
        (t) => this.data.threadProjects[t.id] === id || t.cwd === project.path,
      );
      if (
        all.some(
          (t) =>
            t.status?.type === "active" &&
            (threads.some((own) => own.id === t.id) ||
              (options.deleteDirectory && childOf(t.cwd || "", project.path))),
        )
      )
        throw httpError(
          409,
          "In diesem Projekt läuft noch ein Auftrag. Stoppe ihn vor dem Löschen.",
        );
      let canonical;
      if (options.deleteDirectory) {
        const otherPaths = this.data.projects
          .filter((p) => p.id !== id)
          .map((p) => p.path);
        const context = {
          home: this.home,
          codexHome:
            this.bridge.status.info?.codexHome ||
            path.posix.join(this.home, ".codex"),
          projectRoot: this.projectRoot,
          otherPaths,
        };
        validateDeletePath(project.path, context);
        const script =
          'import json,os,sys; p=sys.argv[1]; print(json.dumps({"exists":os.path.lexists(p),"canonical":os.path.realpath(p),"symlink":os.path.islink(p)}))';
        const inspected = JSON.parse(
          (await this.command(["python3", "-c", script, project.path])).stdout,
        );
        if (inspected.symlink)
          throw httpError(
            400,
            "Ein verknüpfter Projektordner wird nicht automatisch gelöscht.",
          );
        canonical = inspected.canonical;
        validateDeletePath(canonical, context);
      }
      for (const thread of threads)
        await this.bridge.call("thread/archive", { threadId: thread.id });
      if (options.deleteDirectory)
        await this.bridge.call("fs/remove", {
          path: canonical,
          recursive: true,
          force: true,
        });
      this.data.projects = this.data.projects.filter((p) => p.id !== id);
      for (const draft of this.data.drafts)
        if (draft.projectId === id) draft.archived = true;
      this.data.deletedProjects.push({
        ...project,
        deletedAt: new Date().toISOString(),
      });
      if (!this.data.hiddenPaths.includes(project.path))
        this.data.hiddenPaths.push(project.path);
      await this.save();
      return {
        archivedChats: threads.length,
        directoryDeleted: Boolean(options.deleteDirectory),
      };
    });
  }
  async chatAction(id, action, input = {}) {
    const draft = this.data.drafts.find((d) => d.id === id);
    if (action === "restore") {
      const projectId = draft?.projectId || this.data.threadProjects[id];
      const removed = this.data.deletedProjects.find((p) => p.id === projectId);
      if (removed && !this.data.projects.some((p) => p.id === projectId)) {
        try {
          const meta = await this.bridge.call("fs/getMetadata", {
            path: removed.path,
          });
          if (!meta.isDirectory) throw new Error("missing");
        } catch {
          throw httpError(
            409,
            "Der Projektordner existiert nicht mehr. Ordne den Chat zuerst einem vorhandenen Projekt zu.",
          );
        }
        this.data.projects.push({ ...removed });
        this.data.hiddenPaths = this.data.hiddenPaths.filter(
          (p) => p !== removed.path,
        );
      }
    }
    if (action === "assign") {
      const project = this.find(input.projectId);
      if (draft) {
        draft.projectId = project.id;
        draft.cwd = project.path;
      } else this.data.threadProjects[id] = project.id;
    } else if (draft) {
      if (action === "delete")
        this.data.drafts = this.data.drafts.filter((d) => d.id !== id);
      else if (action === "archive" || action === "restore")
        draft.archived = action === "archive";
      else if (action === "rename")
        draft.name = input.name?.trim() || "Neuer Chat";
      else throw httpError(400, "Ungültige Chataktion.");
    } else {
      const methods = {
        archive: "thread/archive",
        restore: "thread/unarchive",
        delete: "thread/delete",
        rename: "thread/name/set",
      };
      if (!methods[action]) throw httpError(400, "Ungültige Chataktion.");
      await this.bridge.call(methods[action], {
        threadId: id,
        ...(action === "rename" ? { name: input.name } : {}),
      });
      if (action === "delete") delete this.data.threadProjects[id];
    }
    await this.save();
  }
}
