import test from "node:test";
import assert from "node:assert/strict";
import { ReleaseInfo } from "../lib/releases.mjs";

test("optional release credentials stay out of responses; missing and failed lookups stay informational", async () => {
  const requests = [];
  let status = 200;
  const release = new ReleaseInfo(async (url, options) => {
    requests.push({ url, options });
    return { ok: status === 200, status, json: async () => ({ tag_name: "v9.0.0", html_url: "https://github.com/example/releases/releases/tag/v9.0.0", published_at: "invalid date" }) };
  });
  release.configure({ repository: "example/releases", token: "example-private-release-token" });
  const first = await release.check();
  assert.equal(requests[0].options.headers.Authorization, "Bearer example-private-release-token");
  assert.equal(first.publishedAt, null);
  assert.equal(JSON.stringify(first).includes("example-private-release-token"), false);
  release.configure({ repository: "example/releases" });
  status = 404;
  const empty = await release.check();
  assert.equal(empty.error, null);
  assert.equal(empty.updateAvailable, false);
  assert.equal(requests.at(-1).options.headers.Authorization, undefined);
  status = 403;
  const limited = await release.check(true);
  assert.ok(limited.error);
  assert.equal(limited.updateAvailable, false);
});

test("changing release repositories discards a late response from the previous repository", async () => {
  let finish;
  const release = new ReleaseInfo(async (url) => {
    if (url.includes("example/first")) await new Promise(resolve => { finish = resolve; });
    const second = url.includes("example/second");
    return { ok: true, status: 200, json: async () => ({ tag_name: second ? "v3.0.0" : "v9.0.0", published_at: "2026-11-05T12:00:00Z" }) };
  });
  release.configure({ repository: "example/first" });
  const old = release.check();
  release.configure({ repository: "example/second" });
  await release.check();
  finish();
  await old;
  assert.equal(release.snapshot().latest, "3.0.0");
  assert.equal(release.snapshot().url, "https://github.com/example/second/releases");
});
