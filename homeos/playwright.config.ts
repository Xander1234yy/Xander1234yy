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
      // Begin iedere run met een lege datamap, zodat gegevens van een vorige run (automatiseringen, logs) niet meetellen.
      command: `node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" "${dataDir}" && npx tsx apps/connector/src/index.ts`,
      url: "http://127.0.0.1:8788/health",
      env: { HOMEOS_CONNECTOR_PORT: "8788", HOMEOS_DATA_DIR: dataDir, HOMEOS_DEMO: "true", HOMEOS_RATE_LIMIT_PER_MIN: "3000" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npx next build && npx next start -H 127.0.0.1 -p 3100",
      cwd: "apps/web",
      url: "http://127.0.0.1:3100/api/health",
      env: {
        HOMEOS_CONNECTOR_URL: "http://127.0.0.1:8788",
        HOMEOS_ALLOW_LOCAL_MODE: "true",
        SUPABASE_URL: "",
        SUPABASE_PUBLISHABLE_KEY: "",
        HOMEOS_CONNECTOR_TOKEN_FILE: path.join(dataDir, "api-token"),
        NEXT_TELEMETRY_DISABLED: "1",
        HOMEOS_ACCESS_CODE: "e2e-toegangscode",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
