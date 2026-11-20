import { expect, test } from "@playwright/test";

test.describe("installeerbare app (PWA)", () => {
  test("manifest met iconen, service worker en offline-pagina", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "eenmaal is genoeg");
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "HomeOS", display: "standalone", start_url: "/" });
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual(expect.arrayContaining(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]));
    for (const p of ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/offline.html"]) expect((await request.get(p)).status()).toBe(200);
    const sw = await request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toContain("no-store");
    expect(sw.headers()["content-type"]).toContain("javascript");

    await page.goto("/");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);

    // Offline: pagina's komen niet uit een cache met oude gegevens; de offline-pagina legt het uit.
    await page.reload(); // nu onder controle van de service worker
    await page.context().setOffline(true);
    await page.goto("/energie").catch(() => undefined);
    await expect(page.getByText("Geen verbinding met HomeOS")).toBeVisible();
    await page.context().setOffline(false);
  });
});

test.describe("toegang van buiten de laptop (lokale modus)", () => {
  test("vraagt een toegangscode; API zonder code geweigerd", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "eenmaal is genoeg");
    // Zoals via Tailscale: het verzoek komt via een proxy (X-Forwarded-For).
    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": "100.64.0.7" } });
    const page = await ctx.newPage();
    const api = await ctx.request.get("/api/connector/v1/snapshot");
    expect(api.status()).toBe(401);
    await page.goto("/energie");
    await expect(page).toHaveURL(/\/toegang\?next=%2Fenergie/);
    await page.getByLabel("Toegangscode").fill("fout-fout-fout");
    await page.getByRole("button", { name: "Openen" }).click();
    await expect(page.getByText("Onjuiste toegangscode")).toBeVisible();
    await page.getByLabel("Toegangscode").fill("e2e-toegangscode");
    await page.getByRole("button", { name: "Openen" }).click();
    await expect(page).toHaveURL(/\/energie$/);
    await expect(page.getByRole("heading", { name: "Energie" })).toBeVisible();
    const cookies = await ctx.cookies();
    const access = cookies.find((c) => c.name === "homeos_access");
    expect(access?.httpOnly).toBe(true);
    expect(access?.value).not.toContain("e2e-toegangscode");
    expect((await ctx.request.get("/api/connector/v1/snapshot")).status()).toBe(200);
    await ctx.close();
  });
});
