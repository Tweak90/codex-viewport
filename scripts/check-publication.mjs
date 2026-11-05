import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 128 * 1024 * 1024 });

// Values are never included in findings: reports must not reproduce a credential.
export function inspectPublicationData(data, filename) {
  const text = data.toString("utf8");
  const findings = [];
  const add = (kind, index) =>
    findings.push({
      kind,
      file: filename,
      line: text.slice(0, index).split("\n").length,
    });
  for (const match of text.matchAll(
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
  ))
    add("private-network-address", match.index);
  for (const match of text.matchAll(/\/(?:home|Users)\/([A-Za-z0-9_.-]+)/g))
    if (!["node", "test", "codex"].includes(match[1]))
      add("personal-home-path", match.index);
  const credentials = [
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
    /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{30,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g,
  ];
  for (const rule of credentials)
    for (const match of text.matchAll(rule))
      add("possible-credential", match.index);
  for (const match of text.matchAll(
    /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g,
  ))
    if (
      !/@(?:users\.noreply\.github\.com|example\.(?:com|org|net)|[^@]+\.example)$/i.test(
        match[0],
      )
    )
      add("email-address", match.index);
  return findings;
}

const excludedPath = (name) =>
  /(^|\/)(?:\.env(?:\..*)?|\.data|\.codex-web|ssh|dist|test-results|playwright-report)(?:\/|$)/.test(
    name,
  ) && name !== ".env.example";

export function checkPublication({ history = false } = {}) {
  const findings = [];
  let files = 0;
  if (history) {
    for (const line of git("rev-list", "--objects", "--all")
      .toString()
      .trim()
      .split("\n")) {
      const [sha, ...parts] = line.split(" ");
      const name = parts.join(" ");
      if (!name || git("cat-file", "-t", sha).toString().trim() !== "blob")
        continue;
      files++;
      if (excludedPath(name))
        findings.push({
          kind: "runtime-or-secret-file",
          file: `${sha.slice(0, 12)}:${name}`,
        });
      findings.push(
        ...inspectPublicationData(
          git("cat-file", "blob", sha),
          `${sha.slice(0, 12)}:${name}`,
        ),
      );
    }
    const metadata = git("log", "--all", "--format=%B%n%an <%ae>%n%cn <%ce>");
    findings.push(...inspectPublicationData(metadata, "commit-metadata"));
    for (const tag of git("tag")
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)) {
      if (git("cat-file", "-t", tag).toString().trim() === "tag")
        findings.push(
          ...inspectPublicationData(git("cat-file", "tag", tag), `tag:${tag}`),
        );
    }
  } else {
    const names = new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .toString()
        .split("\0")
        .filter(Boolean),
    );
    for (const name of names) {
      files++;
      if (excludedPath(name))
        findings.push({ kind: "runtime-or-secret-file", file: name });
      try {
        findings.push(...inspectPublicationData(readFileSync(name), name));
      } catch (error) {
        findings.push({
          kind: "unreadable-file",
          file: name,
          code: error.code,
        });
      }
    }
  }
  return { history, files, findings };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const result = checkPublication({
    history: process.argv.includes("--history"),
  });
  for (const item of result.findings)
    console.error(
      `${item.kind}: ${item.file}${item.line ? ":" + item.line : ""}`,
    );
  console.log(
    `${result.history ? "History" : "Working tree"}: ${result.files} files/blobs, ${result.findings.length} findings.`,
  );
  process.exitCode = result.findings.length ? 1 : 0;
}
