import { expect, test } from "@playwright/test";
import { CRON_SECRET } from "../../playwright.cloudruntime.config";

const run = Date.now().toString(36);
const user = { name: "Cloud Test", email: `cloud-${run}@example.test`, password: "test-wachtwoord-123" };

test.describe.serial("cloudmodus zonder laptop", () => {
  test("registreren, demo-apparaten bedienen; status blijft bewaard tussen aanvragen", async ({ page }) => {
    await page.goto("/registreren");
    await page.getByLabel("Je naam").fill(user.name);
    await page.getByLabel("E-mailadres", { exact: true }).fill(user.email);
    await page.getByLabel(/Wachtwoord/).fill(user.password);
    await page.getByRole("button", { name: "Account aanmaken" }).click();
    await page.getByLabel("Naam van je huishouden").fill(`Cloudhuis ${run}`);
    await page.getByRole("button", { name: "Huishouden aanmaken" }).click();
    await expect(page.getByTestId("welcome-card")).toBeVisible();

    await page.goto("/apparaten");
    const card = page.locator('[data-device-id="demo-lights:badkamer-spiegel"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const sw = card.getByRole("switch");
    await expect(sw).toBeEnabled();
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    const after = before === "true" ? "false" : "true";
    await expect(sw).toHaveAttribute("aria-checked", after);
    // Nieuwe aanvraag (nieuwe connector in de cloud): de status komt uit Supabase.
    await page.reload();
    await expect(page.locator('[data-device-id="demo-lights:badkamer-spiegel"]').getByRole("switch")).toHaveAttribute("aria-checked", after, { timeout: 20_000 });

    // Lokale integraties zijn verborgen; cloud-integraties wel zichtbaar.
    await page.goto("/instellingen");
    await expect(page.getByTestId("cloud-mode-note")).toBeVisible();
    await expect(page.getByTestId("tv-card")).toHaveCount(0);
    await expect(page.getByTestId("tapo-card")).toHaveCount(0);
    await expect(page.getByTestId("hue-card")).toHaveCount(0);
    await expect(page.getByTestId("zonneplan-card")).toBeVisible();
  });

  test("geplande taak: alleen met het geheim", async ({ request }) => {
    expect((await request.post("/api/cloud/tick")).status()).toBe(401);
    expect((await request.post("/api/cloud/tick", { headers: { authorization: "Bearer fout" } })).status()).toBe(401);
    const ok = await request.post("/api/cloud/tick", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.households).toBeGreaterThanOrEqual(1);
    expect(body.failed).toBe(0);
  });
});
