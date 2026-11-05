import { test, expect } from "@playwright/test";

test("project agents show active and archived output without starting work and ignore stale detail responses", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Synthetic agents in disposable projects only.");
  await page.goto("/");
  if (await page.locator("#auth-screen").isVisible()) {
    await page.locator("#auth-password").fill("test");
    if (await page.locator("#auth-confirm").isVisible()) await page.locator("#auth-confirm").fill("test");
    await page.locator("#auth-submit").click();
  }
  await expect(page.locator("#application")).toBeVisible();
  const auth = await (await page.request.get("/api/auth/status")).json();
  async function api(url, data, method = "POST") {
    const r = await page.request.fetch(url, { method, headers: { "X-CSRF-Token": auth.csrf }, data });
    expect(r.ok(), await r.text()).toBe(true); return r.json();
  }
  const { project } = await api("/api/projects", { name: "Agents browser fixture" });
  const { project: other } = await api("/api/projects", { name: "Other agents fixture" });
  try {
    const { thread } = await api(`/api/projects/${project.id}/chats`, {});
    await page.reload();
    await page.locator(`[data-thread="${thread.id}"]`).click();
    await page.locator("#prompt").fill("AGENTS_TEST");
    await page.locator("#prompt").press("Shift+Enter");
    await expect(page.locator(".message.assistant")).toContainText("CONSOLE_STREAM_OK");
    const native = await (await page.request.get("/api/state")).json();
    const mainChat = Object.keys(native.threadProjects).find((id) => native.threadProjects[id] === project.id && !id.startsWith("draft-"));
    const mutations = [];
    const observe = (r) => { if (r.url().endsWith("/api/rpc") && ["thread/resume", "turn/start", "turn/steer"].includes(r.postDataJSON()?.method)) mutations.push(r.postDataJSON().method); };
    page.on("request", observe);
    await page.locator('[data-view-tab="agents"]').click();
    await expect(page.locator("[data-agent-id]")).toHaveCount(2);
    await expect(page.locator("#agent-list")).not.toContainText("Foreign helper");
    await expect(page.locator("#agent-output")).toContainText("agent-line-059");
    await expect(page.locator("#agent-output")).not.toContainText("agent-line-000");
    await page.locator("#agent-history-more").click();
    await expect(page.locator("#agent-output")).toContainText("agent-line-020");
    await page.locator("#agent-history-more").click();
    await expect(page.locator("#agent-output")).toContainText("agent-line-000");
    await expect(page.locator("#agent-history-more")).not.toBeVisible();
    await page.locator('[data-agents-filter="active"]').click();
    await expect(page.locator("[data-agent-id]")).toHaveCount(1);
    await page.locator('[data-agents-filter="past"]').click();
    await page.getByRole("button", { name: /Earlier helper/ }).click();
    await expect(page.locator("#agent-output")).toContainText("ARCHIVED_AGENT_RESULT");
    await expect(page.locator("#agent-list")).toContainText("Archiviert");
    expect(mutations).toEqual([]);
    page.off("request", observe);
    await page.locator('[data-view-tab="chat"]').click();
    await expect(page.locator(".thread.active")).toHaveAttribute("data-thread", mainChat);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const requestStarted = new Promise((resolve) => { started = resolve; });
    await page.route(/\/api\/projects\/[^/]+\/agents\/[^/?]+$/, async (route) => {
      const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
    });
    await page.locator('[data-view-tab="agents"]').click();
    await requestStarted;
    await page.locator(`[data-project-row="${other.id}"] .project`).click();
    release();
    await expect(page.locator("#project-title")).toHaveText(other.name);
    await expect(page.locator(".project-agents")).toHaveCount(0);
    await expect(page.locator("#chat")).not.toContainText("agent-line-");
  } finally {
    await api(`/api/projects/${project.id}`, { confirmName: project.name, deleteDirectory: true }, "DELETE");
    await api(`/api/projects/${other.id}`, { confirmName: other.name, deleteDirectory: true }, "DELETE");
  }
});
