import { taggedPng } from "../support/image.mjs";
import { test, expect } from "@playwright/test";
const password = process.env.TEST_PASSWORD || "test";
async function login(page) {
  await page.goto("/");
  const info = await (await page.request.get("/api/auth/status")).json();
  if (!info.authenticated) {
    await page.locator("#auth-password").fill(password);
    if (!info.configured) await page.locator("#auth-confirm").fill(password);
    await page.locator("#auth-submit").click();
  }
  await expect(page.locator("#application")).toBeVisible();
  await expect(page.locator("#live-pill")).toHaveText("API VERBUNDEN");
}
async function api(page, url, body, method = "POST") {
  const session = await (await page.request.get("/api/auth/status")).json();
  const r = await page.request.fetch(url, {
    method,
    headers: { "X-CSRF-Token": session.csrf },
    ...(body === undefined ? {} : { data: body }),
  });
  const data = await r.json();
  expect(r.ok(), JSON.stringify(data)).toBe(true);
  return data;
}
async function createProject(page) {
  const name = `Browser Projekt ${Date.now()}`;
  await page.locator("#add-project").click();
  await expect(page.locator("#project-mode")).toHaveValue("local");
  await page.locator("#project-name").fill(name);
  await page.locator("#project-submit").click();
  await expect(page.locator("#project-dialog")).not.toBeVisible();
  await expect(page.locator("#project-title")).toHaveText(name);
  const info = await api(page, "/api/state", undefined, "GET");
  return info.projects.find((p) => p.name === name);
}
async function projectMenu(page, p) {
  await page.locator(`[data-project-row="${p.id}"]`).click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
}
async function removeProject(page, p, deleteDirectory = true) {
  await projectMenu(page, p);
  await page.getByRole("menuitem", { name: "Projekt löschen …" }).click();
  await page.locator("#delete-project-name").fill(p.name);
  if (deleteDirectory) await page.locator("#delete-project-files").check();
  await page.locator("#delete-project-submit").click();
  await expect(page.locator("#delete-project-dialog")).not.toBeVisible();
  await expect(page.locator(`[data-project-row="${p.id}"]`)).toHaveCount(0);
}

test("first login sets password, remembers theme and protects data after logout", async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Isolated first-run test only.",
  );
  expect((await request.get("/api/state")).status()).toBe(401);
  await page.goto("/");
  await expect(page.locator("#auth-confirm")).toBeVisible();
  await page.locator("#auth-password").fill("abc");
  await page.locator("#auth-confirm").fill("abc");
  expect(
    await page.locator("#auth-password").evaluate((e) => e.checkValidity()),
  ).toBe(false);
  await page.locator("#auth-password").fill(password);
  await page.locator("#auth-confirm").fill(password);
  await page.locator("#auth-submit").click();
  await expect(page.locator("#application")).toBeVisible();
  await page.locator("#theme-toggle").click();
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.locator("#logout").click();
  await expect(page.locator("#auth-screen")).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(401);
  await login(page);
  await expect(page.locator("#live-pill")).toHaveText("API VERBUNDEN");
});

test("project overview lists chats, previews project images and supports context menus", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic image fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  await page.locator("#prompt").fill("IMAGE_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".chat-image")).toBeVisible();
  await page.locator(`[data-project-row="${p.id}"] [data-project]`).click();
  await expect(page.locator(".project-overview h1")).toHaveText(p.name);
  await expect(page.locator("[data-overview-chat-row]")).toHaveCount(1);
  await expect(page.locator("[data-overview-image]")).toHaveCount(1);
  await page.locator("[data-overview-chat-row]").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Chat umbenennen" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("[data-overview-image]").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Bild herunterladen" }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Bild öffnen", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator("#image-preview").evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  await page.locator("#image-dialog .dialog-close").click();
  await page.locator("[data-overview-new-chat]").click();
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator('[data-view-tab="project"]').click();
  await expect(page.locator("[data-overview-chat-row]")).toHaveCount(2);
  await page.locator("[data-overview-project-menu]").click();
  await expect(
    page.getByRole("menuitem", { name: "Projekt löschen …" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
    await page.locator("#theme-toggle").click();
  await page.screenshot({ path: "test-results/ide-project-dark.png" });
  await page.locator("#theme-toggle").click();
  await page.screenshot({ path: "test-results/ide-project-light.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/ide-project-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await removeProject(page, p, true);
});

test("Chat navigation lists project chats and creates a chat only after the explicit action", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic navigation fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  await page.locator("#prompt").fill("CONSOLE_STREAM_OK");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.assistant")).toContainText(
    "CONSOLE_STREAM_OK",
  );
  const existing = await page
    .locator("#thread-list .thread.active")
    .getAttribute("data-thread");
  await page.locator("#new-chat").click();
  await expect(page.locator("#thread-list .thread.active")).toHaveAttribute(
    "data-thread",
    /^draft-/,
  );
  const draft = await page
    .locator("#thread-list .thread.active")
    .getAttribute("data-thread");
  await page.locator("#prompt").fill("Mein ungesendeter Entwurf");
  const other = (
    await api(page, "/api/projects", {
      name: `Leeres Browser Projekt ${Date.now()}`,
    })
  ).project;
  await expect(page.locator(`[data-project-row="${other.id}"]`)).toBeVisible();
  let created = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/projects\/[^/]+\/chats$/.test(new URL(request.url()).pathname)
    )
      created++;
  });
  await page.locator(`[data-project-row="${other.id}"] [data-project]`).click();
  await page.locator(`[data-project-row="${p.id}"] [data-project]`).click();
  await page.locator('[data-view-tab="chat"]').click();
  const list = page.locator("[data-project-chats]");
  await expect(list).toBeVisible();
  await expect(list.locator("[data-overview-chat-row]")).toHaveCount(2);
  await expect(
    list.locator(`[data-overview-thread="${existing}"]`),
  ).toBeVisible();
  await expect(list.locator(`[data-overview-thread="${draft}"]`)).toBeVisible();
  await expect(list.locator("[data-overview-image]")).toHaveCount(0);
  await expect(page.locator("#prompt")).not.toBeVisible();
  await expect(page.locator('[data-view-tab="chat"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  const start = await list.locator("[data-overview-new-chat]").boundingBox();
  const first = await list
    .locator("[data-overview-chat-row]")
    .first()
    .boundingBox();
  expect(start.y + start.height).toBeLessThanOrEqual(first.y);
  await page.locator('[data-view-tab="chat"]').click();
  await list.locator(`[data-overview-thread="${existing}"]`).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "CONSOLE_STREAM_OK",
  );
  await page.locator('[data-view-tab="chat"]').click();
  await expect(page.locator(".thread.active")).toHaveAttribute("data-thread", existing);
  await page.locator('[data-view-tab="project"]').click();
  await expect(page.locator("[data-overview-chat-row]")).toHaveCount(2);
  await page
    .locator(`[data-overview-chat-row="${existing}"]`)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Weitere Chataktionen …" }).click();
  await expect(page.locator("#actions-dialog")).toBeVisible();
  await expect(page.locator("#fork-chat")).toBeVisible();
  await page.locator("#actions-dialog .dialog-close").click();
  await page.locator('[data-view-tab="project"]').click();
  await page.locator(`[data-overview-thread="${draft}"]`).click();
  await expect(page.locator("#prompt")).toHaveValue(
    "Mein ungesendeter Entwurf",
  );
  expect(created).toBe(0);
  await page.locator('[data-project=""]').click();
  await page.locator('[data-view-tab="chat"]').click();
  await expect(page.locator("#project-picker")).toBeVisible();
  await page.locator(`[data-pick-project="${p.id}"]`).click();
  await expect(list.locator("[data-overview-chat-row]")).toHaveCount(2);
  expect(created).toBe(0);
  await page.locator('[data-project=""]').click();
  await page.locator('.activity-bar [data-activity="files"]').click();
  await page.locator(`[data-pick-project="${p.id}"]`).click();
  await expect(page.locator("#tools")).toBeVisible();
  expect(created).toBe(0);
  await page.locator("#close-tools").click();
  await page.locator(`[data-project-row="${other.id}"] [data-project]`).click();
  await page.locator('[data-view-tab="chat"]').click();
  await expect(list.locator("[data-overview-chat-row]")).toHaveCount(0);
  await expect(list).toContainText("Noch keine Chats");
  expect(created).toBe(0);
  await list.locator("[data-overview-new-chat]").click();
  await expect(page.locator("#prompt")).toBeVisible();
  expect(created).toBe(1);
  const state = await api(page, "/api/state", undefined, "GET");
  expect(state.drafts.filter((d) => d.projectId === other.id)).toHaveLength(1);
  await removeProject(page, other);
  await removeProject(page, p);
});

test("header stays compact, new-chat action follows search and composer actions work on desktop and mobile", async ({
  page,
}) => {
  await login(page);
  const p = await createProject(page);
  await expect(page.locator(".top-actions button")).toHaveCount(3);
  expect(
    await page
      .locator(".top-actions button")
      .evaluateAll((nodes) => nodes.map((n) => n.id).sort()),
  ).toEqual(["context-indicator", "logout", "theme-toggle"]);
  const search = await page.locator("#search").boundingBox();
  const create = await page.locator("#new-chat").boundingBox();
  const first = await page.locator("#thread-list").boundingBox();
  expect(create.y).toBeGreaterThanOrEqual(search.y + search.height);
  expect(create.y + create.height).toBeLessThanOrEqual(first.y);
  await expect(page.locator("#attach-files svg")).toBeVisible();
  await expect(page.locator("#send")).toContainText("Senden");
  await page.locator("#version-button").click();
  await expect(page.locator("#work-settings-dialog")).toBeVisible();
  await page.locator("#work-settings-dialog [data-feature-close]").click();
  await page.locator("#prompt").fill("Nachricht für die Vorschau");
  await expect(page.locator("#toast")).not.toBeVisible({ timeout: 7000 });
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme-toggle").click();
    await page.screenshot({
      path: `test-results/project-chat-composer-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.locator('.activity-bar [data-activity="files"]').click();
  const options = await page.locator(".model-options").boundingBox();
  const attachment = await page.locator("#attach-files").boundingBox();
  expect(options.y + options.height).toBeLessThanOrEqual(attachment.y);
  await page.screenshot({
    path: "test-results/project-chat-composer-tools.png",
  });
  await page.locator("#close-tools").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#attach-files")).toBeVisible();
  await expect(page.locator("#send")).toBeVisible();
  const composer = await page.locator("#composer").boundingBox();
  for (const id of ["attach-files", "send"]) {
    const box = await page.locator("#" + id).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(composer.x);
    expect(box.x + box.width).toBeLessThanOrEqual(composer.x + composer.width);
  }
  await page.screenshot({
    path: "test-results/project-chat-composer-mobile.png",
  });
  await page.locator("#menu").click();
  await page.locator('.mobile-workspaces [data-activity="files"]').click();
  await expect(page.locator("#tools")).toBeVisible();
  await page.locator("#close-tools").click();
  await expect(page.locator("#prompt")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await removeProject(page, p);
});

test("a delayed gallery response cannot replace a different project or an open chat", async ({
  page,
}) => {
  await login(page);
  const a = await createProject(page),
    b = await createProject(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let intercepted;
  const started = new Promise((resolve) => {
    intercepted = resolve;
  });
  await page.route(`**/api/projects/${a.id}/media`, async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await projectMenu(page, a);
  await page.getByRole("menuitem", { name: "Bilder & Screenshots" }).click();
  await started;
  await page.locator(`[data-project-row="${b.id}"] [data-project]`).click();
  await expect(page.locator(".project-overview h1")).toHaveText(b.name);
  release();
  await expect(page.locator(".project-overview h1")).toHaveText(b.name);
  await expect(page.locator(".gallery")).toHaveCount(0);
  await removeProject(page, a, true);
  await removeProject(page, b, true);
});

test("quota dialog renders its full shell immediately, then fills values without raw credit data", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/usage", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        rateLimits: {
          limitName: "Codex",
          primary: { usedPercent: 25, windowDurationMins: 300 },
          secondary: { usedPercent: 10, windowDurationMins: 10080 },
          credits: { hasCredits: false, unlimited: false, balance: "0" },
        },
        rateLimitResetCredits: { availableCount: 2, credits: [] },
      },
    });
  });
  await login(page);
  await page.locator("#open-usage").click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator("#info-content")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.locator(".quota-placeholder")).toBeVisible();
  await expect(page.locator(".reset-card")).toBeVisible();
  await expect(page.locator("#usage-reset")).toBeDisabled();
  await page.screenshot({ path: "test-results/ide-quota-loading.png" });
  release();
  await expect(page.locator("#info-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#info-content")).toContainText("75% verfügbar");
  await expect(page.locator("#activity-usage-primary")).toHaveText("75%");
  await expect(page.locator("#activity-usage-weekly")).toHaveText("90%");
  await expect(page.locator("#reset-count")).toHaveText("2");
  await expect(page.locator("#info-content")).not.toContainText("hasCredits");
  await page.locator("#usage-refresh").click();
  await expect(page.locator("#info-content")).toContainText("75% verfügbar");
  await page.evaluate(() => handleEvent({ method: "account/rateLimits/updated", params: { rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300 }, secondary: { usedPercent: 80, windowDurationMins: 10080 } } } }));
  await expect(page.locator("#activity-usage-primary")).toHaveText("60%");
  await expect(page.locator("#activity-usage-weekly")).toHaveText("20%");
});

test("historical images recover after reload and remain mounted while more messages arrive", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic historical image fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  await page.locator("#prompt").fill("PAST_IMAGE_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  await expect
    .poll(() => page.locator(".chat-image").evaluate((img) => img.naturalWidth))
    .toBe(1);
  let failImage = true;
  await page.route("**/api/media?threadId=**", async (route) => {
    if (failImage) {
      failImage = false;
      return route.fulfill({ status: 503, body: "Temporarily unavailable" });
    }
    return route.continue();
  });
  await page.reload();
  await expect(page.locator("[data-retry-image]")).toBeVisible();
  await page.locator("[data-retry-image]").click();
  await expect
    .poll(() => page.locator(".chat-image").evaluate((img) => img.naturalWidth))
    .toBe(1);
  const image = await page.locator(".chat-image").elementHandle();
  await page.locator("#prompt").fill("Nachricht nach dem Bild");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.user")).toHaveCount(2);
  expect(
    await image.evaluate((img) => img.isConnected && img.naturalWidth === 1),
  ).toBe(true);
  await removeProject(page, p, true);
});

test("chat logos use web assets while project images use authenticated media", async ({ page }) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Synthetic asset fixture only.");
  await login(page);
  const invalidMedia = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const filename = url.searchParams.get("path") || "";
    if (url.pathname === "/api/media" &&
        (filename === "/assets/logo.png" || filename.includes("web-host.example")))
      invalidMedia.push(request.url());
  });
  const p = await createProject(page);
  await page.locator("#prompt").fill("WEB_ASSET_TEST IMAGE_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  const logo = page.locator('#chat img[alt="Web-Logo"]');
  const projectImage = page.locator('#chat img[alt="Projektbild"]');
  await expect(logo).toHaveAttribute("src", "/assets/logo.png");
  await expect(page.getByRole("link", { name: "Logo öffnen" })).toHaveAttribute("href", "/assets/logo.png");
  await expect(projectImage).toHaveAttribute("src", /^\/api\/media\?path=/);
  await expect.poll(() => logo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => projectImage.evaluate((img) => img.naturalWidth)).toBe(1);
  expect(invalidMedia).toEqual([]);
  await page.reload();
  await expect(logo).toHaveAttribute("src", "/assets/logo.png");
  await expect.poll(() => logo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  expect(invalidMedia).toEqual([]);
  await removeProject(page, p, true);
});

test("projects keep multiple chats; context menus and archive support restore and deletion", async ({
  page,
}) => {
  await login(page);
  const p = await createProject(page);
  await projectMenu(page, p);
  await page
    .getByRole("menuitem", { name: "Neuer Chat in diesem Projekt" })
    .click();
  await expect(page.locator("[data-thread-row]")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("#application")).toBeVisible();
  await expect(page.locator("[data-thread-row]")).toHaveCount(2);
  const first = await page
    .locator("[data-thread-row]")
    .first()
    .getAttribute("data-thread-row");
  await page.locator(`[data-thread-row="${first}"]`).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Archivieren", exact: true })
    .click();
  await page.locator("#open-archive").click();
  await expect(page.locator(".archive-card")).toHaveCount(1);
  await page.locator(".archive-card input").check();
  await page.locator("#archive-restore-selected").click();
  await expect(page.locator(".archive-card")).toHaveCount(0);
  await page.locator("#open-archive").click();
  await expect(page.locator("[data-thread-row]")).toHaveCount(2);
  for (const id of await page
    .locator("[data-thread-row]")
    .evaluateAll((rows) => rows.map((r) => r.dataset.threadRow)))
    await api(page, `/api/chats/${id}/archive`, {});
  await page.locator("#open-archive").click();
  await expect(page.locator(".archive-card")).toHaveCount(2);
  await page.locator("#archive-select-all").click();
  await page.locator("#archive-delete-selected").click();
  await page.locator("#confirm-submit").click();
  await expect(page.locator(".archive-card")).toHaveCount(0);
  await page.locator("#open-archive").click();
  await removeProject(page, p, false);
  const meta = await api(page, "/api/rpc", {
    method: "fs/getMetadata",
    params: { path: p.path },
  });
  expect(meta.result.isDirectory).toBe(true);
  // Only the disposable fixture directory is removed; the keep-files UI path was verified above.
  await api(page, "/api/rpc", {
    method: "command/exec",
    params: {
      command: [
        "python3",
        "-c",
        "import shutil,sys; shutil.rmtree(sys.argv[1])",
        p.path,
      ],
      cwd: "/tmp",
    },
  });
});

test("Shift+Enter submits once and keeps the same project chat open, including after reload", async ({
  page,
}) => {
  await login(page);
  const p = await createProject(page);
  let navigations = 0,
    submits = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/rpc") &&
      r.postDataJSON()?.method === "turn/start"
    )
      submits++;
  });
  await page.locator("#effort").selectOption("low");
  await page
    .locator("#prompt")
    .fill(
      "Antworte ausschließlich mit CONSOLE_STREAM_OK. Verwende keine Werkzeuge.",
    );
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.assistant .message-body")).toContainText(
    "CONSOLE_STREAM_OK",
    { timeout: 90000 },
  );
  await expect(page.locator("#active-state")).not.toBeVisible({
    timeout: 90000,
  });
  const id = await page.locator(".thread.active").getAttribute("data-thread");
  expect(submits).toBe(1);
  expect(navigations).toBe(0);
  await expect(page.locator("#prompt")).toBeFocused();
  await expect(page.locator("#project-title")).toHaveText(p.name);
  await page.locator("#prompt").press("Enter");
  expect(await page.locator("#prompt").inputValue()).toBe("\n");
  expect(submits).toBe(1);
  await page.reload();
  await expect(page.locator(".thread.active")).toHaveAttribute(
    "data-thread",
    id,
  );
  await expect(page.locator(".message.assistant .message-body")).toContainText(
    "CONSOLE_STREAM_OK",
  );
  await removeProject(page, p, true);
});

test("gallery displays generated images and screenshots; quotas show reset counts", async ({
  page,
}) => {
  await login(page);
  const p = await createProject(page);
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=";
  for (const name of ["generated/art.png", "screenshots/home.png"]) {
    const dir = p.path + "/" + name.split("/")[0];
    await api(page, "/api/rpc", {
      method: "fs/createDirectory",
      params: { path: dir, recursive: true },
    });
    await api(page, "/api/rpc", {
      method: "fs/writeFile",
      params: { path: p.path + "/" + name, dataBase64: taggedPng(name).toString("base64") },
    });
  }
  await projectMenu(page, p);
  await page.getByRole("menuitem", { name: "Bilder & Screenshots" }).click();
  await expect(page.locator(".gallery-card")).toHaveCount(2);
  await page.locator('[data-gallery-filter="screenshots"]').click();
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await page.locator(".gallery-card").click();
  await expect(page.locator("#image-dialog")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("#image-preview").evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  await page.locator("#image-dialog .dialog-close").click();
  await page.locator("#open-usage").click();
  await expect(page.locator("#reset-count")).toBeVisible();
  if (!process.env.TEST_BASE_URL) {
    await expect(page.locator("#reset-count")).toHaveText("2");
    page.once("dialog", (d) => d.accept());
    await page.locator("#usage-reset").click();
    await expect(page.locator("#reset-count")).toHaveText("1");
  }
  await page.locator("#info-dialog .dialog-close").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile-gallery.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/gallery.png" });
  await removeProject(page, p, true);
});

test("long command summaries and output previews expand without losing content", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic long output fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  await page.locator("#prompt").fill("LONG_OUTPUT_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  const activity = page
    .locator("details.activity")
    .filter({ has: page.locator("summary").filter({ hasText: "python3" }) });
  await expect(activity).toBeVisible();
  expect((await activity.locator("summary").textContent()).length).toBeLessThan(
    180,
  );
  await activity.locator("summary").click();
  await expect(activity.locator("pre")).not.toContainText("END_OUTPUT");
  await activity.getByRole("button", { name: /Ganz anzeigen/ }).click();
  await expect(activity.locator("pre")).toContainText("END_OUTPUT");
  await activity.getByRole("button", { name: "Weniger anzeigen" }).click();
  await expect(activity.locator("pre")).not.toContainText("END_OUTPUT");
  await removeProject(page, p, true);
});

test("generated images render inline and are indexed under their project", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic image fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  await page.locator("#prompt").fill("IMAGE_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".chat-image")).toBeVisible();
  await expect
    .poll(() => page.locator(".chat-image").evaluate((i) => i.naturalWidth))
    .toBe(1);
  await page.locator(".chat-image").click();
  await expect(page.locator("#image-dialog")).toBeVisible();
  await page.locator("#image-dialog .dialog-close").click();
  await page.locator('[data-view-tab="gallery"]').click();
  await page.locator('[data-gallery-filter="generated"]').click();
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await expect(page.locator(".gallery-card strong")).toHaveText(
    "generated.png",
  );
  await removeProject(page, p, true);
});

async function historyProject(page) {
  await login(page);
  const project = await createProject(page);
  await page.locator("#prompt").fill("HISTORY_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.assistant").last()).toContainText(
    "CONSOLE_STREAM_OK",
  );
  await page.reload();
  await expect(page.locator("#chat [data-item]")).toHaveCount(20);
  const threadId = await page.evaluate(() =>
    localStorage.getItem("codex.thread"),
  );
  return { project, threadId };
}

test("long chats open with 20 entries and scroll older pages without jumps, duplicates or lost items", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic history fixture only.",
  );
  const { project, threadId } = await historyProject(page);
  await expect(page.locator("#chat")).not.toContainText("history-message-000");
  await expect(page.locator("#chat")).toContainText("history-message-059");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(
    `**/api/chats/${threadId}/history?cursor=*`,
    async (route) => {
      requests++;
      if (requests === 2)
        return route.fulfill({
          status: 503,
          json: { error: "Testweise unterbrochen" },
        });
      const response = await route.fetch();
      if (requests === 1) await gate;
      await route.fulfill({ response });
    },
  );
  const chat = page.locator("#chat");
  expect(await chat.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  await chat.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator("[data-older]")).toContainText("werden geladen");
  const anchor = await chat.evaluate((element) => {
    const node = [...element.querySelectorAll("[data-item]")].find(
      (item) =>
        item.getBoundingClientRect().bottom >
        element.getBoundingClientRect().top + 1,
    );
    return { id: node.dataset.item, top: node.getBoundingClientRect().top };
  });
  await chat.evaluate((element) => {
    for (let i = 0; i < 8; i++)
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
  });
  expect(requests).toBe(1);
  release();
  await expect(page.locator("#chat [data-item]")).toHaveCount(40);
  const top = await page
    .locator(`[data-item="${anchor.id}"]`)
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(top - anchor.top)).toBeLessThan(2);
  await chat.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator("[data-history-retry]")).toBeVisible();
  await expect(page.locator("#chat [data-item]")).toHaveCount(40);
  await page.locator("[data-history-retry]").click();
  await expect(page.locator("#chat [data-item]")).toHaveCount(60);
  await chat.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator("#chat [data-item]")).toHaveCount(62);
  await expect(page.locator("[data-older]")).toHaveCount(0);
  await expect(page.locator("#chat")).toContainText("history-message-000");
  const ids = await page
    .locator("#chat [data-item]")
    .evaluateAll((items) => items.map((item) => item.dataset.item));
  expect(new Set(ids).size).toBe(62);
  await removeProject(page, project, true);
});

test("a delayed older page cannot replace a newly opened project chat", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic history fixture only.",
  );
  const { project: a, threadId } = await historyProject(page);
  const b = await createProject(page);
  await page.locator(`[data-project-row="${a.id}"] [data-project]`).click();
  await page.locator(`#thread-list [data-thread="${threadId}"]`).click();
  await expect(page.locator("#chat [data-item]")).toHaveCount(20);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/chats/${threadId}/history?cursor=*`,
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page.locator("#chat").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator("[data-older]")).toContainText("werden geladen");
  await page.locator(`[data-project-row="${b.id}"] [data-project]`).click();
  await page.locator("#thread-list [data-thread]").first().click();
  await expect(page.locator("#project-title")).toHaveText(b.name);
  const response = page.waitForResponse((r) =>
    r.url().includes(`/api/chats/${threadId}/history?cursor=`),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator("#chat [data-item]")).toHaveCount(0);
  await expect(page.locator("#chat .welcome")).toContainText(b.name);
  await removeProject(page, a, true);
  await removeProject(page, b, true);
});

test("history appears before a slow chat resume and sending waits for the connection", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic history fixture only.",
  );
  const { project, threadId } = await historyProject(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let resuming = false,
    sends = 0;
  await page.route("**/api/rpc", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "thread/resume" && body.params.threadId === threadId) {
      resuming = true;
      await gate;
    }
    if (body.method === "turn/start") sends++;
    await route.continue();
  });
  await page.reload();
  await expect(page.locator("#chat [data-item]")).toHaveCount(20);
  expect(resuming).toBe(true);
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#prompt").fill("Nachricht trotz langsamer Verbindung");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator("#send")).toBeDisabled();
  expect(sends).toBe(0);
  release();
  await expect(
    page
      .locator(".message.user")
      .filter({ hasText: "Nachricht trotz langsamer Verbindung" }),
  ).toHaveCount(1);
  expect(sends).toBe(1);
  await removeProject(page, project, true);
});

test("message text survives chat switches and reloads; pinning, export and project defaults work", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Isolated workbench fixture only.",
  );
  await login(page);
  const p = await createProject(page);
  const first = await page
    .locator("#thread-list [data-thread]")
    .first()
    .getAttribute("data-thread");
  await page.locator("#prompt").fill("Ungesendeter\nmehrzeiliger Entwurf");
  await page.locator("#new-chat").click();
  await expect(page.locator("#thread-list [data-thread-row]")).toHaveCount(2);
  await expect(page.locator("#thread-list .thread.active")).not.toHaveAttribute(
    "data-thread",
    first,
  );
  const second = await page
    .locator("#thread-list .thread.active")
    .getAttribute("data-thread");
  expect(second).not.toBe(first);
  await page.locator(`#thread-list [data-thread="${first}"]`).click();
  await expect(page.locator("#prompt")).toHaveValue(
    "Ungesendeter\nmehrzeiliger Entwurf",
  );
  await page.reload();
  await expect(page.locator("#prompt")).toHaveValue(
    "Ungesendeter\nmehrzeiliger Entwurf",
  );
  await page
    .locator(`#thread-list [data-thread-row="${first}"]`)
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Chat anpinnen", exact: true })
    .click();
  await expect(
    page.locator(`#thread-list [data-thread-row="${first}"]`),
  ).toHaveClass(/pinned-chat/);
  await projectMenu(page, p);
  await page.getByRole("menuitem", { name: "Projektvorgaben …" }).click();
  await page.locator("#project-default-model").selectOption("test-model");
  await page.locator("#project-default-effort").selectOption("low");
  await page
    .locator("#project-instructions")
    .fill("Antworte immer auf Deutsch.");
  await page.locator("#project-settings-form button[type=submit]").click();
  await expect(page.locator("#project-settings-dialog")).not.toBeVisible();
  await page.locator("#new-chat").click();
  await expect(page.locator("#effort")).toHaveValue("low");
  await page.locator("#prompt").fill("Exportinhalt");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.assistant")).toContainText(
    "CONSOLE_STREAM_OK",
  );
  const native = await page
    .locator("#thread-list .thread.active")
    .getAttribute("data-thread");
  await page
    .locator(`#thread-list [data-thread-row="${native}"]`)
    .click({ button: "right" });
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Als Markdown exportieren" })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await removeProject(page, p, true);
});

test("image clipboard and file uploads reach chat input; explorer creates, moves and deletes files", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Isolated upload fixture only.",
  );
  await login(page);
  // A project is visible before its initial chat is ready. Attach during that
  // interval, then return the upload after chat creation to exercise the race.
  let releaseChat, releaseUpload;
  const chatReady = new Promise((resolve) => { releaseChat = resolve; });
  const uploadReady = new Promise((resolve) => { releaseUpload = resolve; });
  const chatRoute = /\/api\/projects\/[^/]+\/chats$/;
  const uploadRoute = /\/api\/projects\/[^/]+\/uploads\?/;
  await page.route(chatRoute, async (route) => {
    const response = await route.fetch();
    await chatReady;
    await route.fulfill({ response });
  });
  await page.route(uploadRoute, async (route) => {
    const response = await route.fetch();
    await uploadReady;
    await route.fulfill({ response });
  });
  const p = await createProject(page);
  await expect(page.locator("#prompt")).toBeDisabled();
  await page.locator("#attachment-picker").setInputFiles({
    name: "notizen.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Lokale Notizen"),
  });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  releaseChat();
  await expect(page.locator("#prompt")).toBeEnabled();
  releaseUpload();
  await expect(page.locator(".attachment-chip")).toHaveCount(1);
  await page.unroute(chatRoute);
  await page.unroute(uploadRoute);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=";
  await page.locator("#prompt").evaluate((element, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        "clipboard.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(page.locator(".attachment-chip")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workbench-uploads-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.locator(".attachment-chip")).toHaveCount(2);
  let sent;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/rpc") &&
      request.postDataJSON()?.method === "turn/start"
    )
      sent = request.postDataJSON().params.input;
  });
  await page.locator("#prompt").fill("Bitte beide Anhänge ansehen.");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator(".message.assistant")).toContainText(
    "CONSOLE_STREAM_OK",
  );
  expect(
    sent.some(
      (input) =>
        input.type === "localImage" && input.path.endsWith("/clipboard.png"),
    ),
  ).toBe(true);
  expect(sent.some((input) => input.text?.includes("notizen.txt"))).toBe(true);
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
  await expect(page.locator(".message.user")).not.toContainText("[Bild]");
  await page.locator('.activity-bar [data-activity="files"]').click();
  page.once("dialog", (dialog) => dialog.accept("neuer-ordner"));
  await page.locator("#new-folder").click();
  await expect(page.locator('[data-file$="/neuer-ordner"]')).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("datei.txt"));
  await page.locator("#new-file").click();
  const file = page.locator('[data-file$="/datei.txt"]');
  await expect(file).toBeVisible();
  await file.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept("verschoben.txt"));
  await page.getByRole("menuitem", { name: "Verschieben …" }).click();
  const moved = page.locator('[data-file$="/verschoben.txt"]');
  await expect(moved).toBeVisible();
  await moved.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept("verschoben.txt"));
  await page
    .getByRole("menuitem", { name: "Endgültig löschen …", exact: true })
    .click();
  await expect(moved).toHaveCount(0);
  await removeProject(page, p, true);
});

test("full-text search opens an older exact message without loading the whole chat", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_BASE_URL),
    "Synthetic search fixture only.",
  );
  const { project } = await historyProject(page);
  await page.locator("#open-global-search").click();
  await page.locator("#global-search-project").selectOption(project.id);
  await page.locator("#global-search-input").fill("history-message-000");
  const hit = page
    .locator("[data-search-result]")
    .filter({ hasText: "history-message-000" });
  await expect(hit).toBeVisible({ timeout: 30000 });
  await hit.click();
  await expect(page.locator("#global-search-dialog")).not.toBeVisible();
  await expect(page.locator(".search-target")).toContainText(
    "history-message-000",
  );
  expect(await page.locator("#chat > [data-item]").count()).toBeLessThanOrEqual(
    20,
  );
  await page.locator("[data-history-latest]").click();
  await expect(page.locator("#chat")).not.toContainText("history-message-000");
  await removeProject(page, project, true);
});

test("task dashboard, context, panel widths and informational release checks work", async ({
  page,
  context,
}) => {
  test.skip(Boolean(process.env.TEST_BASE_URL), "Synthetic task fixture only.");
  await login(page);
  const p = await createProject(page);
  await page.locator("#version-button").click();
  await expect(page.locator("#work-settings-dialog h2")).toHaveText("Info");
  await expect(page.locator("#enable-notifications, #enable-sound, #reset-panel-sizes")).toHaveCount(0);
  await page.locator("#check-version").click();
  await expect(page.locator("#version-details")).toContainText("9.0.0");
  await expect(page.locator("#version-details")).toContainText("Neue Version verfügbar");
  await expect(page.locator("#version-details")).toContainText("5. November 2026");
  await page.locator("#work-settings-dialog [data-feature-close]").click();
  await page.locator("#prompt").fill("WAIT_TEST");
  await page.locator("#prompt").press("Shift+Enter");
  await expect(page.locator("#thread-list .thread.active")).not.toHaveAttribute(
    "data-thread",
    /^draft-/,
  );
  const taskId = await page
    .locator("#thread-list .thread.active")
    .getAttribute("data-thread");
  await page.locator("#open-tasks").click();
  await expect(page.locator(".task-dashboard")).toBeVisible();
  await expect(page.locator(".task-status.working")).toBeVisible();
  await page.locator("[data-task-refresh]").click();
  await expect(
    page.locator(`[data-task="${taskId}"] .task-status`),
  ).toContainText("Fertig");
  await page.locator(`[data-task-open="${taskId}"]`).click();
  await expect(page.locator("#context-indicator")).toContainText("15%");
  await page.locator("#context-indicator").click();
  await expect(page.locator("#context-content")).toContainText("15.000");
  await page.locator("#context-dialog [data-feature-close]").click();
  const handle = page.locator(".sidebar-resizer");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const width = await page
    .locator("#sidebar")
    .evaluate((element) => element.getBoundingClientRect().width);
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("#sidebar")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(width);
  await expect(page.locator("#version-button")).toContainText(
    "Update verfügbar",
  );
  await page.screenshot({ path: "test-results/workbench-options-context.png" });
  await removeProject(page, p, true);
});
