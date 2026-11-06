import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createConsoleServer } from "../../server.mjs";
import { FakeBridge } from "./fake-bridge.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "codex-viewport-browser-"));
await mkdir(path.join(root, "home/.codex"), { recursive: true });
const bridge = new FakeBridge(root);
const app = await createConsoleServer({
  environment: { ...process.env, CODEX_VIEWPORT_LANGUAGE: "de" },
  releaseFetcher: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: "v9.0.0", html_url: "https://github.com/example/codex-viewport/releases/tag/v9.0.0", published_at: "2026-11-05T12:00:00Z" }) }),
  bridge,
  dataDir: path.join(root, "data"),
  projectRoot: path.join(root, "home/projects"),
  hostLabel: "Test VM",
});
app.server.listen(8791, "127.0.0.1", () =>
  console.log("Browser fixture ready on :8791"),
);
const close = async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
