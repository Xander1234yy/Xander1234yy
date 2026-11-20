import { expect, test } from "@playwright/test";

test.describe("HomeOS dashboard (DEMO)", () => {
  test("toont dashboard, demo-markering en verbindingsstatus", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-card")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByTestId("connection-pill")).toBeVisible();
    for (const id of ["energy-card", "devices-overview", "lights-card", "media-card", "doorbell-card", "jarvis-card", "quick-actions", "climate-card"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("energy-card")).toContainText("Opwek nu");
  });

  test("bedient een DEMO-lamp via de connector", async ({ page }) => {
    await page.goto("/apparaten");
    const card = page.locator('[data-device-id="demo-lights:badkamer-spiegel"]');
    await expect(card).toBeVisible();
    const sw = card.getByRole("switch");
    await expect(sw).toBeEnabled();
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await expect(sw).not.toHaveAttribute("aria-checked", before ?? "", { timeout: 5_000 });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", before ?? "false", { timeout: 5_000 });
  });

  test("offline DEMO-apparaat heeft uitgeschakelde bediening", async ({ page }) => {
    await page.goto("/apparaten");
    const card = page.locator('[data-device-id="demo-lights:tuin-wandlamp"]');
    await expect(card.locator('[data-status="OFFLINE"]')).toBeVisible();
    await expect(card.getByRole("switch")).toBeDisabled();
  });

  test("Jarvis beantwoordt een vraag en vraagt bevestiging voor opdrachten", async ({ page }) => {
    await page.goto("/jarvis");
    const input = page.getByLabel("Bericht aan Jarvis");
    await input.fill("Welke lampen staan nog aan?");
    await input.press("Enter");
    await expect(page.getByTestId("jarvis-messages")).toContainText(/Er (staan|staat) .*aan|geen lampen/i);
    await expect(page.getByText("Jarvis denkt na…")).toHaveCount(0);
    await input.fill("zet de spiegellamp aan");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "Bevestigen" })).toBeVisible();
    await page.getByRole("button", { name: "Annuleren" }).click();
    await expect(page.getByTestId("jarvis-messages")).toContainText("Geannuleerd");
  });

  test("bedient de DEMO-airco (temperatuur en modus)", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("climate-card");
    await expect(card).toContainText("Airco woonkamer");
    const before = (await card.getByText(/°C$/).first().textContent()) ?? "";
    await card.getByRole("button", { name: "Temperatuur hoger" }).click();
    await expect(card.getByText(/°C$/).first()).not.toHaveText(before);
    await card.getByRole("button", { name: "Koelen" }).click();
    await expect(card.getByRole("button", { name: "Koelen" })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Verwarmen" }).click();
  });

  test("maakt Avondmodus uit een sjabloon, voert hem uit en toont geschiedenis en melding", async ({ page }, testInfo) => {
    const name = `Avondmodus E2E ${testInfo.project.name}`;
    await page.goto("/automatiseringen");
    await page.getByTestId("template-evening").click();
    await expect(page.getByTestId("automation-editor")).toBeVisible();
    await page.getByLabel("Naam automatisering").fill(name);
    await page.getByRole("button", { name: "Opslaan" }).click();
    const card = page.getByTestId("automation-card").filter({ hasText: name });
    await expect(card).toContainText("Om 20:00");
    await card.getByRole("button", { name: "Nu uitvoeren" }).click();
    await expect(page.getByTestId("run-history")).toContainText(name);
    await expect(page.getByTestId("run-history")).toContainText("Gelukt");
    await page.getByRole("button", { name: /Meldingen/ }).click();
    await expect(page.getByTestId("notification").first()).toContainText("Avondoverzicht");
    await card.getByRole("switch").click();
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  test("alle pagina's laden zonder fouten", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const p of ["/", "/kamers", "/apparaten", "/energie", "/entertainment", "/beveiliging", "/jarvis", "/automatiseringen", "/familie", "/onderhoud", "/instellingen"]) {
      await page.goto(p);
      await expect(page.locator("main")).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("geen horizontale scroll op dit schermformaat", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-card")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("offline connector", () => {
  test("toont duidelijk dat de connector offline is en blokkeert bediening", async ({ page }) => {
    await page.route("**/api/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: 'event: connector\ndata: {"online":false,"reason":"unreachable"}\n\n' }));
    await page.route("**/api/connector/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"CONNECTOR_UNREACHABLE","message":"Connector is niet bereikbaar"}}' }));
    await page.route("**/api/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"connector":false}' }));
    await page.goto("/");
    await expect(page.getByTestId("connector-offline")).toBeVisible();
    await expect(page.getByTestId("emergency-stop")).toBeDisabled();
  });
});
