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

  test("Alles uit vraagt eerst bevestiging met de lijst apparaten", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByTestId("all-off");
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText(/Alles uit \(\d+\)/);
    let message = "";
    page.once("dialog", (d) => {
      message = d.message();
      void d.dismiss(); // annuleren: er mag niets gebeuren (andere tests delen de DEMO-toestand)
    });
    await btn.click();
    await expect.poll(() => message).toContain("Alles uitzetten?");
    expect(message).not.toContain("Camera");
    await expect(btn).toBeEnabled();
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

  test("Jarvis onthoudt waar het over ging en bewaart het gesprek in de browser", async ({ page }) => {
    await page.goto("/jarvis");
    const input = page.getByLabel("Bericht aan Jarvis");
    await input.fill("zet de spots op veertig procent");
    await input.press("Enter");
    await expect(page.getByTestId("jarvis-messages")).toContainText("Spots op 40%");
    await page.getByRole("button", { name: "Annuleren" }).click();
    await input.fill("zet ze uit");
    await input.press("Enter");
    await expect(page.getByTestId("jarvis-messages")).toContainText(/Spots uit|staat al uit/);
    await page.reload();
    await expect(page.getByTestId("jarvis-messages")).toContainText("zet ze uit");
    await expect(page.getByRole("button", { name: "Bevestigen" })).toHaveCount(0);
    await page.getByRole("button", { name: "Nieuw gesprek" }).click();
    await expect(page.getByTestId("jarvis-messages")).not.toContainText("zet ze uit");
  });

  test("bedient de DEMO-tv: volume, dempen en ingang; Jarvis stelt tv-opdrachten voor", async ({ page }) => {
    await page.goto("/entertainment");
    const volume = page.getByText(/^\d{1,3}$/).first();
    await expect(volume).toBeVisible();
    const before = Number(await volume.textContent());
    await page.getByRole("button", { name: "Harder" }).first().click();
    await expect(volume).toHaveText(String(Math.min(100, before + 1)));
    const mute = page.getByRole("button", { name: /Dempen|Geluid aan/ }).first();
    const pressed = await mute.getAttribute("aria-pressed");
    await mute.click();
    await expect(page.getByRole("button", { name: /Dempen|Geluid aan/ }).first()).not.toHaveAttribute("aria-pressed", pressed ?? "");
    const select = page.getByLabel(/Ingang of app op/).first();
    await select.selectOption({ label: "Spelcomputer (DEMO)" });
    await expect(select).toHaveValue("input:HDMI_2");

    // Afstandsbediening: zender omhoog via de knop en via het toetsenbord.
    const remote = page.getByTestId("tv-remote").first();
    await remote.getByRole("button", { name: "Volgende zender" }).click();
    await expect(page.getByText(/Zender \d+ \(DEMO\)/).first()).toBeVisible();
    const zender = Number((await page.getByText(/Zender \d+ \(DEMO\)/).first().textContent())!.match(/\d+/)![0]);
    await remote.focus();
    await page.keyboard.press("PageUp");
    await expect(page.getByText(`Zender ${zender + 1} (DEMO)`).first()).toBeVisible();

    await page.goto("/jarvis");
    const input = page.getByLabel("Bericht aan Jarvis");
    await input.fill("zet de tv zachter");
    await input.press("Enter");
    await expect(page.getByTestId("jarvis-messages")).toContainText("Woonkamer TV: volume");
    await page.getByRole("button", { name: "Annuleren" }).click();
  });

  test("LG-tv-kaart in Instellingen weigert een openbaar adres", async ({ page }) => {
    await page.goto("/instellingen");
    const card = page.getByTestId("tv-card");
    await expect(card).toContainText("Nog geen tv gekoppeld");
    await card.getByLabel("IP-adres van de tv").fill("8.8.8.8");
    await card.getByRole("button", { name: "Koppelen" }).click();
    await expect(page.getByText(/lokale IP-adres van de tv/).first()).toBeVisible();
  });

  test("Apple Woning: knop aanmaken en op het dashboard als shortcuts://-link tonen", async ({ page }) => {
    await page.goto("/instellingen");
    const card = page.getByTestId("shortcuts-settings-card");
    await expect(card).toBeVisible();
    // Alle schermformaten gebruiken dezelfde DEMO-connector: zelfde knoppen opslaan is idempotent.
    while ((await card.getByLabel(/^Knopnaam/).count()) > 0) await card.getByRole("button", { name: /verwijderen$/ }).first().click();
    await card.getByRole("button", { name: "Knop toevoegen" }).click();
    await card.getByLabel("Knopnaam 1").fill("TV aan");
    await card.getByLabel("Opdracht 1").fill("TV aan & Ziggo");
    await card.getByRole("button", { name: "Opslaan" }).click();
    await expect(page.getByText("Knoppen opgeslagen")).toBeVisible();
    await page.goto("/");
    const link = page.getByTestId("shortcuts-card").getByRole("link", { name: "TV aan" });
    await expect(link).toHaveAttribute("href", "shortcuts://run-shortcut?name=TV%20aan%20%26%20Ziggo");
  });

  test("Zonneplan-kaart is duidelijk als niet-officieel gemarkeerd", async ({ page }) => {
    await page.goto("/instellingen");
    const card = page.getByTestId("zonneplan-card");
    await expect(card).toContainText("Niet-officiële koppeling");
    await expect(card.getByRole("button", { name: "Code aanvragen" })).toBeDisabled();
    await card.getByLabel("E-mailadres Zonneplan").fill("ik@example.test");
    await expect(card.getByRole("button", { name: "Code aanvragen" })).toBeEnabled();
  });

  test("Tapo-camerakaart in Instellingen weigert een openbaar adres", async ({ page }) => {
    await page.goto("/instellingen");
    const card = page.getByTestId("tapo-card");
    await expect(card).toContainText("Nog geen camera toegevoegd");
    await card.getByLabel("IP-adres van de camera").fill("8.8.8.8");
    await card.getByLabel("Gebruikersnaam camera-account").fill("homeos");
    await card.getByLabel("Wachtwoord camera-account").fill("test-wachtwoord");
    await card.getByRole("button", { name: "Camera toevoegen" }).click();
    await expect(page.getByText(/lokale IP-adres van de camera/).first()).toBeVisible();
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
