import { test, expect } from "@playwright/test";
async function api(page, url, data, method = "POST") {
  const auth = await (await page.request.get("/api/auth/status")).json();
  const response = await page.request.fetch(url, { method, headers: { "X-CSRF-Token": auth.csrf }, ...(data ? { data } : {}) });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function login(page) {
  await page.goto("/");
  if (await page.locator("#auth-screen").isVisible()) {
    await page.locator("#auth-password").fill("test");
    if (await page.locator("#auth-confirm").isVisible()) await page.locator("#auth-confirm").fill("test");
    await page.locator("#auth-submit").click();
  }
  await expect(page.locator("#application")).toBeVisible();
  await expect(page.locator("#live-pill")).toContainText("API");
}
async function project(page, name) {
  const created = await api(page, "/api/projects", { name });
  const chat = await api(page, `/api/projects/${created.project.id}/chats`, {});
  await page.reload();
  await expect(page.locator("#application")).toBeVisible();
  await page.locator(`[data-thread="${chat.thread.id}"]`).click();
  return created.project;
}
async function cleanup(page, p) {
  await api(page, `/api/projects/${p.id}`, { confirmName: p.name, deleteDirectory: true }, "DELETE");
}
test("gear settings persist English and Enter behavior, preserve user names and restore ENV defaults", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Isolated preferences test only.");
  await login(page);
  const p = await project(page, "Dateien");
  try {
    await expect(page.locator("#activity-settings")).toHaveCount(0);
    await expect(page.locator("#open-settings + #open-usage")).toHaveCount(1);
    await page.locator("#open-settings").click();
    await expect(page.locator("#application-settings-dialog")).toBeVisible();
    await expect(page.locator("#settings-panel-general")).toBeVisible();
    await expect(page.locator("#setting-CODEX_WS_URL")).not.toBeVisible();
    await page.locator("#setting-CODEX_WEB_LANGUAGE").selectOption("en");
    await page.locator("#setting-CODEX_SEND_WITH").selectOption("enter");
    await page.locator('[data-settings-tab="codex"]').click();
    await page.locator("#setting-HOST_LABEL").fill("Custom browser host");
    await page.locator('[data-settings-tab="general"]').click();
    await page.locator('[data-settings-tab="codex"]').click();
    await expect(page.locator("#setting-HOST_LABEL")).toHaveValue("Custom browser host");
    await expect(page.locator("#application-settings-status")).toContainText("Noch nicht gespeichert");
    await page.locator("#save-application-settings").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#application")).toBeVisible();
    await expect(page.locator("#open-settings")).toContainText("Settings");
    await expect(page.locator("#host-label")).toHaveText("Custom browser host");
    await expect(page.locator(`[data-project-row="${p.id}"] .project-name`)).toHaveText("Dateien");
    await expect(page.locator("#send-shortcut-hint")).toContainText("Enter to send");
    await page.locator("#prompt").fill("First line");
    await page.locator("#prompt").press("Shift+Enter");
    await page.locator("#prompt").press("End");
    await page.locator("#prompt").type("Second line");
    await expect(page.locator(".message.user")).toHaveCount(0);
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect(page.locator(".message.user")).toContainText("Second line");
    await page.locator("#open-settings").click();
    await expect(page.locator("#application-settings-dialog")).toContainText("Empty fields use the environment configuration (ENV)");
    await page.locator('[data-settings-tab="codex"]').click();
    await page.locator('[data-setting-reset="HOST_LABEL"]').click();
    await page.locator('[data-settings-tab="general"]').click();
    await page.locator('[data-setting-reset="CODEX_WEB_LANGUAGE"]').click();
    await expect(page.locator("#settings-panel-general")).toBeVisible();
    await expect(page.locator("#settings-panel-general")).toContainText("Choose which key combination");
    await page.locator('[data-setting-reset="CODEX_SEND_WITH"]').click();
    await page.locator("#save-application-settings").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("#host-label")).toHaveText("Test VM");
    await expect(page.locator("#send-shortcut-hint")).toContainText("Shift + Enter senden");
  } finally {
    await api(page, "/api/settings", { values: { HOST_LABEL: "", CODEX_WEB_LANGUAGE: "", CODEX_SEND_WITH: "" } }, "PATCH");
    await cleanup(page, p);
  }
});
test("async questions open a dialog, accept a custom answer and remain answered after reload", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Synthetic question fixture only.");
  await login(page);
  const p = await project(page, "Question browser fixture");
  try {
    await page.locator("#prompt").fill("QUESTION_TEST");
    await page.locator("#prompt").press("Shift+Enter");
    await expect(page.locator("#question-dialog")).toBeVisible();
    await expect(page.locator("#question-dialog")).toContainText("Which option should be used?");
    await expect(page.locator('.question-options input[type="radio"]')).toHaveCount(2);
    await page.locator("#question-later").click();
    await expect(page.locator("#open-questions")).toBeVisible();
    await page.reload();
    await page.locator("#open-questions").click();
    await page.locator("#question-free-answer").fill("My custom choice <safe>");
    await page.locator("#question-submit").click();
    await expect(page.locator("#question-dialog")).not.toBeVisible();
    await expect(page.locator("#open-questions")).not.toBeVisible();
    await expect(page.locator(".message.user")).toHaveCount(2);
    await expect(page.locator(".message.user").last()).toContainText("My custom choice <safe>");
    await page.reload();
    await expect(page.locator("[data-open-question]")).toContainText("Beantwortet");
    await expect(page.locator("[data-open-question]")).toBeDisabled();
  } finally { await cleanup(page, p); }
});

test("project tabs return to the last open chat until another project is selected", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Isolated navigation test only.");
  await login(page);
  const p = await project(page, "Return to chat fixture");
  const original = await page.locator(".thread.active").getAttribute("data-thread");
  try {
    await page.locator("#prompt").fill("Draft kept across project tabs");
    await page.locator('[data-view-tab="project"]').click();
    await expect(page.locator(".project-overview")).toBeVisible();
    await page.locator('[data-view-tab="chat"]').click();
    await expect(page.locator(".thread.active")).toHaveAttribute("data-thread", original);
    await expect(page.locator("#prompt")).toHaveValue("Draft kept across project tabs");
    await page.locator('[data-view-tab="gallery"]').click();
    await expect(page.locator(".gallery")).toBeVisible();
    await page.locator('[data-view-tab="chat"]').click();
    await expect(page.locator(".thread.active")).toHaveAttribute("data-thread", original);
    const other = await api(page, "/api/projects", { name: "Other return fixture" });
    await page.locator(`[data-project-row="${other.project.id}"] [data-project]`).click();
    await page.locator(`[data-project-row="${p.id}"] [data-project]`).click();
    await page.locator('[data-view-tab="chat"]').click();
    await expect(page.locator("[data-project-chats]")).toBeVisible();
    await expect(page.locator(".thread.active")).toHaveCount(0);
    await cleanup(page, other.project);
  } finally { await cleanup(page, p); }
});
test("follow-up mode chooses native queue or steer while an earlier turn is running", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Synthetic queue fixture only.");
  await login(page);
  const p = await project(page, "Queued messages fixture");
  const methods = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/rpc")) methods.push(request.postDataJSON()?.method); });
  try {
    await api(page, "/api/settings", { values: { CODEX_FOLLOWUP_MODE: "queue" } }, "PATCH");
    await page.reload();
    await expect(page.locator("#prompt")).toBeVisible();
    await page.locator("#prompt").fill("WAIT_TEST first task");
    await page.locator("#prompt").press("Shift+Enter");
    await expect(page.locator("#active-state")).toBeVisible();
    await page.locator("#prompt").fill("Queued follow-up");
    await page.locator("#prompt").press("Shift+Enter");
    await expect(page.locator("#message-queue")).toBeVisible();
    await expect(page.locator("#message-queue-items")).toContainText("Queued follow-up");
    expect(methods).toContain("thread/queue/add");
    expect(methods).not.toContain("turn/steer");
    await expect(page.locator(".message.user")).toHaveCount(2);
    await expect(page.locator("#message-queue")).not.toBeVisible();
    await api(page, "/api/settings", { values: { CODEX_FOLLOWUP_MODE: "steer" } }, "PATCH");
    await page.locator("#prompt").fill("WAIT_TEST next task");
    await page.locator("#prompt").press("Shift+Enter");
    await expect(page.locator("#active-state")).toBeVisible();
    await page.locator("#prompt").fill("Immediate steering message");
    await page.locator("#prompt").press("Shift+Enter");
    await expect.poll(() => methods.includes("turn/steer")).toBe(true);
    await expect(page.locator("#active-state")).not.toBeVisible();
  } finally {
    await api(page, "/api/settings", { values: { CODEX_FOLLOWUP_MODE: "" } }, "PATCH");
    await cleanup(page, p);
  }
});
