import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:8791",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  ...(process.env.TEST_BASE_URL
    ? {}
    : {
        webServer: {
          command: "node test/support/browser-server.mjs",
          url: "http://127.0.0.1:8791/healthz",
          reuseExistingServer: false,
        },
      }),
});
