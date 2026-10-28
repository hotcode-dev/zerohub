import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 10 * 1000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Always serial: the specs share two live server processes (make server-serve
  // on :8080, make server-serve-2 on :8081) and zz-migrate.spec.ts permanently
  // latches the :8080 server into migrate mode. Parallel local runs would race
  // that shared state (see the zz-migrate.spec.ts docblock), so the suite must run
  // with a single worker on CI and locally.
  workers: 1,
  reporter: "line",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "Google Chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
});
