import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// E2E-tests voor de cloudmodus (accounts, huishoudens, rollen) tegen een echte Supabase,
// bijvoorbeeld de lokale stack van `npx supabase start`. Vereist SUPABASE_URL en SUPABASE_PUBLISHABLE_KEY.
// Alleen DEMO-apparaten, eigen poorten en een eigen connector-datamap.
const dataDir = path.resolve(".homeos-data/e2e-cloud");
const executablePath = process.env.PW_CHROMIUM_PATH;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Zet SUPABASE_URL en SUPABASE_PUBLISHABLE_KEY (zie docs/supabase.md) om de cloud-E2E-tests te draaien.");
}

export default defineConfig({
  testDir: "tests/e2e-cloud",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "off",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `rm -rf ${dataDir} && npx tsx apps/connector/src/index.ts`,
      url: "http://127.0.0.1:8789/health",
      env: { HOMEOS_CONNECTOR_PORT: "8789", HOMEOS_DATA_DIR: dataDir, HOMEOS_DEMO: "true" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npx next build && npx next start -H 127.0.0.1 -p 3200",
      cwd: "apps/web",
      url: "http://127.0.0.1:3200/login",
      env: {
        HOMEOS_CONNECTOR_URL: "http://127.0.0.1:8789",
        HOMEOS_CONNECTOR_TOKEN_FILE: path.join(dataDir, "api-token"),
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        HOMEOS_SITE_URL: "http://127.0.0.1:3200",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
