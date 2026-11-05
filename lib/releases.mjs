import { readFile } from "node:fs/promises";
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
export const version = pkg.version;
const newer = (a, b) => {
  const first = String(a).replace(/^v/, "").split(".").map(Number),
    second = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(first[i])) return false;
    if (first[i] !== second[i]) return first[i] > second[i];
  }
  return false;
};
export class ReleaseInfo {
  constructor(projects, fetcher = fetch) {
    this.projects = projects;
    this.fetcher = fetcher;
    this.configure({ repository: process.env.CODEX_RELEASE_REPOSITORY, token: process.env.CODEX_GITHUB_TOKEN });
  }
  configure({ repository, token }) {
    const next = repository ||
      new URL(pkg.repository.url).pathname
        .replace(/^\//, "")
        .replace(/\.git$/, "");
    if (
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(
        next,
      )
    )
      throw new Error("CODEX_RELEASE_REPOSITORY muss owner/repo enthalten.");
    if (this.repository !== next || this.token !== token) {
      this.latest = null;
      this.checkedAt = null;
      this.error = null;
    }
    this.repository = next;
    this.token = token;
  }
  snapshot() {
    return {
      current: version,
      latest: this.latest?.tag_name?.replace(/^v/, "") || null,
      url:
        this.latest?.html_url ||
        `https://github.com/${this.repository}/releases`,
      updateAvailable: Boolean(
        this.latest && newer(this.latest.tag_name, version),
      ),
      checkedAt: this.checkedAt || null,
      error: this.error || null,
    };
  }
  async check(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.checkedAt && Date.now() - this.checkedAt < 15 * 60000)
      return this.snapshot();
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async refresh() {
    try {
      if (this.token) {
        const r = await this.fetcher(
          `https://api.github.com/repos/${this.repository}/releases/latest`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: "application/vnd.github+json",
            },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!r.ok) throw new Error();
        this.latest = await r.json();
      } else {
        // Reuse the VM user's existing GitHub login; no credentials leave the VM.
        const args = [
          "api",
          `repos/${this.repository}/releases/latest`,
          "--jq",
          "{tag_name,html_url,published_at}",
        ];
        let result;
        try {
          result = await this.projects.command(
            ["gh", ...args],
            this.projects.home,
            15000,
          );
        } catch (error) {
          if (!/no such file|not found|ENOENT/i.test(error.message))
            throw error;
          result = await this.projects.command(
            [this.projects.home + "/.local/bin/gh", ...args],
            this.projects.home,
            15000,
          );
        }
        this.latest = JSON.parse(result.stdout);
      }
      this.error = null;
    } catch {
      this.error =
        "Updateprüfung momentan nicht möglich. Auf der KI-VM muss gh bei GitHub angemeldet sein, alternativ CODEX_GITHUB_TOKEN im Web-Container setzen.";
    }
    this.checkedAt = Date.now();
    return this.snapshot();
  }
}
