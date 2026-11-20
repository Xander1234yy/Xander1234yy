import { expect, test, type Page } from "@playwright/test";

// Unieke accounts per run, zodat de test herhaalbaar is op dezelfde database.
const run = Date.now().toString(36);
const owner = { name: "Eigenaar Test", email: `eigenaar-${run}@example.test`, password: "test-wachtwoord-123" };
const guest = { name: "Gast Test", email: `gast-${run}@example.test`, password: "test-wachtwoord-456" };
const outsider = { name: "Buiten Test", email: `buiten-${run}@example.test`, password: "test-wachtwoord-789" };

async function signUp(page: Page, u: typeof owner) {
  await page.goto("/registreren");
  await page.getByLabel("Je naam").fill(u.name);
  await page.getByLabel("E-mailadres", { exact: true }).fill(u.email);
  await page.getByLabel(/Wachtwoord/).fill(u.password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await expect(page).toHaveURL(/\/welkom$/);
}

async function signIn(page: Page, u: typeof owner, expectSuccess = true) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres", { exact: true }).fill(u.email);
  await page.getByLabel("Wachtwoord").fill(u.password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  if (expectSuccess) await expect(page.getByTestId("welcome-card")).toBeVisible();
}

async function signOutVia(page: Page) {
  await page.getByTestId("profile-button").click();
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe.serial("accounts, huishoudens en rollen", () => {
  test("niet-ingelogde bezoekers worden naar inloggen gestuurd", async ({ page, request }) => {
    await page.goto("/apparaten");
    await expect(page).toHaveURL(/\/login\?next=%2Fapparaten/);
    const api = await request.get("/api/connector/v1/snapshot");
    expect(api.status()).toBe(401);
  });

  test("verkeerd wachtwoord geeft een algemene fout", async ({ page }) => {
    await signIn(page, { ...owner, password: "fout-wachtwoord" }, false);
    await expect(page.getByText("Onjuist e-mailadres of wachtwoord.")).toBeVisible();
  });

  test("registreren, huishouden aanmaken en connector koppelen", async ({ page }) => {
    await signUp(page, owner);
    await page.getByLabel("Naam van je huishouden").fill(`Testhuis ${run}`);
    await page.getByRole("button", { name: "Huishouden aanmaken" }).click();
    await expect(page.getByTestId("welcome-card")).toBeVisible();
    // Nog geen connector gekoppeld → duidelijke melding, geen apparaten
    await expect(page.getByTestId("connector-offline")).toContainText("niet gekoppeld");
    await page.goto("/instellingen");
    await page.getByTestId("link-connector").click();
    await expect(page.getByTestId("connector-link")).toContainText("Bereikbaar");
    await page.goto("/apparaten");
    await expect(page.locator('[data-device-id="demo-lights:keuken-spots"]')).toBeVisible();
    // Sessiecookies zijn httpOnly: niet leesbaar vanuit JavaScript
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toMatch(/sb-.*auth-token/);
  });

  test("eigenaar bedient een DEMO-lamp en beheert familiegegevens", async ({ page }) => {
    await signIn(page, owner);
    await page.goto("/apparaten");
    const sw = page.locator('[data-device-id="demo-lights:badkamer-spiegel"]').getByRole("switch");
    await expect(sw).toBeEnabled();
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await expect(sw).not.toHaveAttribute("aria-checked", before ?? "");

    await page.goto("/familie");
    await page.getByRole("tab", { name: /Boodschappen/ }).click();
    await page.getByLabel("Product").fill("Appels");
    await page.getByLabel("Aantal").fill("1 kg");
    await page.getByRole("button", { name: "Toevoegen", exact: true }).click();
    await expect(page.getByText("Appels")).toBeVisible();

    await page.goto("/jarvis");
    const input = page.getByLabel("Bericht aan Jarvis");
    await input.fill("Wat moeten we nog kopen?");
    await input.press("Enter");
    await expect(page.getByTestId("jarvis-messages")).toContainText("Appels (1 kg)");
    await input.fill("zet peren op de boodschappenlijst");
    await input.press("Enter");
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page.getByTestId("jarvis-messages")).toContainText("Uitgevoerd");
    await input.fill("voeg taak ramen wassen toe");
    await input.press("Enter");
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page.getByTestId("jarvis-messages").getByText("Uitgevoerd")).toHaveCount(2);
    // Gesprek staat in Supabase: na herladen terug, en oude voorstellen zijn niet meer te bevestigen.
    await page.reload();
    await expect(page.getByTestId("jarvis-messages")).toContainText("Appels (1 kg)");
    await expect(page.getByRole("button", { name: "Bevestigen" })).toHaveCount(0);
    await page.goto("/familie");
    await page.getByRole("tab", { name: /Taken/ }).click();
    await expect(page.getByText("ramen wassen")).toBeVisible();
    await page.getByRole("tab", { name: /Boodschappen/ }).click();
    await expect(page.getByText("peren")).toBeVisible();

    await page.goto("/onderhoud");
    await page.getByRole("button", { name: "Item toevoegen" }).click();
    await page.getByLabel("Naam").fill("Cv-ketel");
    await page.getByLabel("Volgend onderhoud").fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Opslaan" }).click();
    await expect(page.getByText("Onderhoud verlopen", { exact: true })).toBeVisible();

    await page.goto("/kamers");
    await page.getByLabel("Nieuwe kamer").fill("Zolder");
    await page.getByRole("button", { name: "Toevoegen", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Zolder" })).toBeVisible();
    await signOutVia(page);
  });

  test("gast kan kijken maar niet bedienen of wijzigen", async ({ page }) => {
    await signUp(page, guest);
    await page.getByRole("button", { name: "Uitloggen" }).click();
    await signIn(page, owner);
    await page.goto("/instellingen");
    await page.getByLabel("E-mailadres", { exact: true }).fill(guest.email);
    await page.getByLabel("Rol", { exact: true }).selectOption("guest");
    await page.getByRole("button", { name: "Toevoegen", exact: true }).click();
    await expect(page.getByTestId("members-card")).toContainText(guest.email);
    await signOutVia(page);

    await signIn(page, guest);
    await page.goto("/apparaten");
    const sw = page.locator('[data-device-id="demo-lights:keuken-spots"]').getByRole("switch");
    await expect(sw).toBeVisible();
    await expect(sw).toBeDisabled();
    // Ook direct via de API geweigerd (CSRF-header meegeven zoals een browser zou doen)
    const res = await page.request.post("/api/connector/v1/devices/demo-lights%3Akeuken-spots/commands", {
      headers: { origin: "http://127.0.0.1:3200", "content-type": "application/json" },
      data: { command: { type: "set_power", on: true } },
    });
    expect(res.status()).toBe(403);
    await page.goto("/familie");
    await page.getByRole("tab", { name: /Boodschappen/ }).click();
    await expect(page.getByText("Appels")).toBeVisible();
    await expect(page.getByLabel("Product")).toHaveCount(0);
  });

  test("buitenstaander ziet niets van een ander huishouden", async ({ page }) => {
    await signUp(page, outsider);
    await page.getByLabel("Naam van je huishouden").fill(`Ander huis ${run}`);
    await page.getByRole("button", { name: "Huishouden aanmaken" }).click();
    await expect(page.getByTestId("welcome-card")).toBeVisible();
    // De connector hoort bij het andere huishouden → niet bruikbaar
    const res = await page.request.get("/api/connector/v1/snapshot");
    expect(res.status()).toBe(409);
    await page.goto("/familie");
    await page.getByRole("tab", { name: /Boodschappen/ }).click();
    await expect(page.getByText("Appels")).toHaveCount(0);
    await page.goto("/instellingen");
    await page.getByTestId("link-connector").click();
    await expect(page.getByText("al gekoppeld aan een ander huishouden")).toBeVisible();
  });
});
