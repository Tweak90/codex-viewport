import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
export const version = pkg.version;
export const defaultRepository = new URL(pkg.repository.url).pathname.replace(/^\//, "").replace(/\.git$/, "");
const newer = (a, b) => {
  const first = String(a).replace(/^v/, "").split(".").map(Number), second = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(first[i])) return false;
    if (first[i] !== second[i]) return first[i] > second[i];
  }
  return false;
};
export class ReleaseInfo {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
    this.configure({ repository: process.env.CODEX_RELEASE_REPOSITORY, token: process.env.CODEX_GITHUB_TOKEN });
  }
  configure({ repository, token }) {
    const next = repository || defaultRepository;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(next))
      throw new Error("CODEX_RELEASE_REPOSITORY muss owner/repo enthalten.");
    if (this.repository !== next || this.token !== token) {
      this.revision = (this.revision || 0) + 1;
      this.latest = null; this.checkedAt = null; this.error = null; this.pending = null;
    }
    this.repository = next;
    this.token = token;
  }
  snapshot() {
    return {
      current: version,
      latest: this.latest?.tag_name?.replace(/^v/, "") || null,
      publishedAt: this.latest?.published_at || null,
      url: this.latest?.html_url || `https://github.com/${this.repository}/releases`,
      updateAvailable: Boolean(this.latest && newer(this.latest.tag_name, version)),
      checkedAt: this.checkedAt || null,
      error: this.error || null,
    };
  }
  async check(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.checkedAt && Date.now() - this.checkedAt < 15 * 60000) return this.snapshot();
    const pending = this.refresh();
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = null; }
  }
  async refresh() {
    const { repository, token, revision } = this;
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Codex Viewport/${version}`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 404) throw new Error();
      const data = response.status === 404 ? null : await response.json();
      if (this.revision !== revision) return this.snapshot();
      this.latest = data ? {
        tag_name: data.tag_name,
        html_url: data.html_url,
        published_at: Number.isFinite(Date.parse(data.published_at)) ? new Date(data.published_at).toISOString() : null,
      } : null;
      this.error = null;
    } catch {
      if (this.revision !== revision) return this.snapshot();
      this.error = "Updateprüfung momentan nicht möglich. GitHub ist nicht erreichbar oder das Anfragelimit wurde erreicht. Bitte später erneut versuchen.";
    }
    this.checkedAt = Date.now();
    return this.snapshot();
  }
}
