import { defineConfig, devices } from "@playwright/test";

// E2E van de cloudmodus ZONDER laptop: geen connector-proces; de webapp start de connector per aanvraag met opslag in
// een echte (lokale) Supabase. Alleen DEMO-apparaten (HOMEOS_CLOUD_DEMO). Vereist SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
// en HOMEOS_WORKER_DB_URL (login-rol die lid is van homeos_worker, zie docs/cloud.md).
const executablePath = process.env.PW_CHROMIUM_PATH;
for (const k of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "HOMEOS_WORKER_DB_URL"]) {
  if (!process.env[k]) throw new Error(`Zet ${k} om de cloudmodus-E2E-tests te draaien.`);
}
export const CRON_SECRET = "e2e-cron-geheim-dat-lang-genoeg-is-0123456789";

export default defineConfig({
  testDir: "tests/e2e-cloudruntime",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:3300", trace: "off", ...(executablePath ? { launchOptions: { executablePath } } : {}) },
  projects: [{ name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } }],
  webServer: [
    {
      command: "npx next build && npx next start -H 127.0.0.1 -p 3300",
      cwd: "apps/web",
      url: "http://127.0.0.1:3300/login",
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY!,
        HOMEOS_SITE_URL: "http://127.0.0.1:3300",
        HOMEOS_CLOUD_RUNTIME: "true",
        HOMEOS_CLOUD_DEMO: "true",
        HOMEOS_WORKER_DB_URL: process.env.HOMEOS_WORKER_DB_URL!,
        HOMEOS_CONNECTOR_SECRET: "e2e-versleutelsleutel-die-minstens-32-tekens-heeft",
        HOMEOS_CRON_SECRET: CRON_SECRET,
        HOMEOS_CONNECTOR_URL: "http://127.0.0.1:1", // er is géén connector-proces
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
