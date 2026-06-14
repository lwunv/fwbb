import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so tests can read ADMIN_USERNAME/PASSWORD (creds NOT hardcoded
// in the repo). NOTE: the webServer below OVERRIDES TURSO_DATABASE_URL to the
// local clone — the test runner itself never touches the DB.
loadEnv({ path: ".env.local" });

const PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Shared DB + a single server → run serially for determinism.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/admin/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    // @next/env does NOT override vars already present in process.env, so this
    // local-file DB sticks (server never connects to prod Turso during e2e).
    env: {
      TURSO_DATABASE_URL: "file:e2e/local.db",
      TURSO_AUTH_TOKEN: "",
    },
  },
});
