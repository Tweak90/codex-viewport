import { readdir, readFile, writeFile, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../docs/wiki/", import.meta.url));
const files = (await readdir(source)).filter((file) => file.endsWith(".md"));
const pages = new Map();
const links = /\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
for (const file of files) {
  const content = await readFile(path.join(source, file), "utf8");
  for (const [, href] of content.matchAll(links)) {
    if (/^[a-z][a-z\d+.-]*:|^#/i.test(href)) continue;
    const target = decodeURIComponent(href.split("#")[0]);
    if (!files.includes(target))
      throw new Error(`${file}: unbekannte interne Wiki-Seite ${href}`);
  }
  pages.set(file, content);
}

const destination = process.argv[2];
if (!destination || process.argv.length !== 3)
  throw new Error("Aufruf: node scripts/sync-wiki.mjs --check | <Wiki-Checkout>");
if (destination === "--check") {
  console.log(`${files.length} Wiki-Seiten: interne Links geprüft.`);
} else {
  const checkout = await realpath(destination);
  const git = (...args) =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  if (await realpath(git("rev-parse", "--show-toplevel")) !== checkout)
    throw new Error("Ziel muss das Stammverzeichnis des Wiki-Checkouts sein.");
  if (!/\.wiki\.git\/?$/.test(git("remote", "get-url", "origin")))
    throw new Error("Das Ziel muss ein GitHub-Wiki-Repository als origin haben.");
  for (const [file, content] of pages) {
    const exported = content.replace(links, (match, href) =>
      /^[a-z][a-z\d+.-]*:|^#/i.test(href)
        ? match
        : match.replace(href, href.replace(/\.md(?=#|$)/, "")),
    );
    await writeFile(path.join(checkout, file), exported);
  }
  console.log(`${files.length} Wiki-Seiten exportiert. Commit und Push separat ausführen.`);
}
