import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { readFile, writeFile, rename, open, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const equal = (a, b) => {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};
export const httpError = (status, message) =>
  Object.assign(new Error(message), { status });
export async function atomicJson(filename, value) {
  const temp = `${filename}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, filename);
}

export class AuthStore {
  static async load(directory) {
    await mkdir(directory, { recursive: true });
    const store = new AuthStore(directory);
    try {
      store.password = JSON.parse(await readFile(store.filename, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      store.sessions = JSON.parse(await readFile(store.sessionFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    return store;
  }
  constructor(directory) {
    this.filename = path.join(directory, "auth.json");
    this.sessionFile = path.join(directory, "sessions.json");
    this.sessions = {};
    this.attempts = new Map();
    this.writeQueue = Promise.resolve();
  }
  get configured() {
    return Boolean(this.password);
  }
  validate(password) {
    if (typeof password !== "string" || [...password].length < 4)
      throw httpError(400, "Das Passwort muss mindestens 4 Zeichen lang sein.");
    if (password.length > 1024)
      throw httpError(400, "Das Passwort ist zu lang.");
  }
  async setup(password, confirmation) {
    this.validate(password);
    if (password !== confirmation)
      throw httpError(400, "Die Passwörter stimmen nicht überein.");
    if (this.configured)
      throw httpError(
        409,
        "Das Passwort wurde bereits eingerichtet. Bitte anmelden.",
      );
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, 64)).toString("hex");
    let file;
    try {
      file = await open(this.filename, "wx", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      throw httpError(
        409,
        "Das Passwort wurde bereits eingerichtet. Bitte anmelden.",
      );
    }
    this.password = { salt, hash, createdAt: new Date().toISOString() };
    try {
      await file.writeFile(JSON.stringify(this.password));
    } finally {
      await file.close();
    }
  }
  async verify(password, ip) {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (attempt?.until > now && attempt.count >= 10)
      throw httpError(
        429,
        "Zu viele Anmeldeversuche. Bitte in einer Minute erneut versuchen.",
      );
    if (!this.configured)
      throw httpError(409, "Bitte zuerst ein Passwort festlegen.");
    const validInput = typeof password === "string" && password.length <= 1024;
    const hash = validInput
      ? (await scrypt(password, this.password.salt, 64)).toString("hex")
      : "";
    if (!equal(hash, this.password.hash)) {
      const current =
        attempt?.until > now ? attempt : { count: 0, until: now + 60000 };
      current.count++;
      this.attempts.set(ip, current);
      throw httpError(401, "Das Passwort ist nicht korrekt.");
    }
    this.attempts.delete(ip);
  }
  persistSessions() {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => {
        const now = Date.now();
        for (const [key, session] of Object.entries(this.sessions))
          if (session.expiresAt < now) delete this.sessions[key];
        return atomicJson(this.sessionFile, this.sessions);
      });
    return this.writeQueue;
  }
  async createSession(req, res) {
    const token = randomBytes(32).toString("base64url");
    const id = createHash("sha256").update(token).digest("hex");
    const session = {
      id,
      csrf: randomBytes(24).toString("base64url"),
      expiresAt: Date.now() + 7 * 86400000,
    };
    this.sessions[id] = session;
    await this.persistSessions();
    res.setHeader("Set-Cookie", this.cookie(token, req, 7 * 86400));
    return session;
  }
  cookie(token, req, age) {
    const secure =
      req.socket.encrypted ||
      req.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https";
    return `codex_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  }
  session(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("codex_session="));
    if (!cookie) return null;
    const id = createHash("sha256")
      .update(cookie.slice("codex_session=".length))
      .digest("hex");
    const session = this.sessions[id];
    return session?.expiresAt > Date.now() ? session : null;
  }
  sameOrigin(req) {
    if (!req.headers.origin) return true;
    try {
      return (
        new URL(req.headers.origin).host ===
        (req.headers["x-forwarded-host"] || req.headers.host)
      );
    } catch {
      return false;
    }
  }
  require(req, mutate = false) {
    const session = this.session(req);
    if (!session) throw httpError(401, "Bitte anmelden.");
    if (
      !this.sameOrigin(req) ||
      (mutate && !equal(req.headers["x-csrf-token"], session.csrf))
    )
      throw httpError(
        403,
        "Die Sitzung ist ungültig. Bitte die Seite neu laden.",
      );
    return session;
  }
  async logout(req, res) {
    const session = this.require(req, true);
    delete this.sessions[session.id];
    await this.persistSessions();
    res.setHeader("Set-Cookie", this.cookie("", req, 0));
    return session.id;
  }
}
