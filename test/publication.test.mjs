import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPublicationData } from "../scripts/check-publication.mjs";

test("publication guard rejects private configuration and credentials without disclosing values", () => {
  const values = [
    "ws://" + [10, 23, 45, 67].join("."),
    "/home/" + "example-user/private-project",
    "ghp_" + "A".repeat(36),
    "sk-proj-" + "B".repeat(60),
    ["person", "private-domain.invalid"].join("@"),
  ];
  const findings = inspectPublicationData(
    Buffer.from(values.join("\n")),
    "config.txt",
  );
  assert.equal(findings.length, values.length);
  for (const value of values)
    assert.ok(!JSON.stringify(findings).includes(value));
});

test("publication guard accepts reserved examples and public project metadata", () => {
  assert.deepEqual(
    inspectPublicationData(
      Buffer.from(
        [
          "ws://codex-host.example:4500",
          "http://127.0.0.1:8787",
          "/home/node/.ssh",
          "/home/test/project",
          "codex@codex-host.example",
          "user@example.org",
          "user@users.noreply.github.com",
          "actions/checkout@v7.0.1",
        ].join("\n"),
      ),
      "examples.md",
    ),
    [],
  );
});

test("publication history check detects data removed from the working tree", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-viewport-publication-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.org");
  git("config", "commit.gpgsign", "false");
  const file = path.join(root, "config.txt");
  await writeFile(file, [192, 168, 23, 45].join("."));
  git("add", ".");
  git("commit", "-qm", "Add synthetic fixture");
  await writeFile(file, "codex-host.example");
  git("add", ".");
  git("commit", "-qm", "Neutralize fixture");
  const script = fileURLToPath(
    new URL("../scripts/check-publication.mjs", import.meta.url),
  );
  const current = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(current.status, 0, current.stderr);
  const history = spawnSync(process.execPath, [script, "--history"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(history.status, 1);
  assert.match(history.stderr, /private-network-address/);
  const uploads = path.join(root, ".codex-viewport/uploads");
  await mkdir(uploads, { recursive: true });
  await writeFile(
    path.join(uploads, "attachment.txt"),
    "Synthetic private attachment",
  );
  git("add", "--all");
  const attachment = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(attachment.status, 1);
  assert.match(attachment.stderr, /runtime-or-secret-file/);
});
