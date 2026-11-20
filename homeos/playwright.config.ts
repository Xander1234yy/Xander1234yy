import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Volledig geïsoleerde E2E-omgeving: eigen poorten en eigen connector-datamap met DEMO-apparaten.
// Tests sturen nooit opdrachten naar echte apparaten.
const dataDir = path.resolve(".homeos-data/e2e");
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "ipad", use: { ...devices["iPad Pro 11"], browserName: "chromium" } },
  ],
  webServer: [
    {
      command: "npx tsx apps/connector/src/index.ts",
      url: "http://127.0.0.1:8788/health",
      env: { HOMEOS_CONNECTOR_PORT: "8788", HOMEOS_DATA_DIR: dataDir, HOMEOS_DEMO: "true" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npx next build && npx next start -H 127.0.0.1 -p 3100",
      cwd: "apps/web",
      url: "http://127.0.0.1:3100/api/health",
      env: {
        HOMEOS_CONNECTOR_URL: "http://127.0.0.1:8788",
        HOMEOS_CONNECTOR_TOKEN_FILE: path.join(dataDir, "api-token"),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
