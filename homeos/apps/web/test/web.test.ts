import { describe, expect, it } from "vitest";
import type { Device, Snapshot } from "@homeos/shared";
import { isAllowed, isSameOrigin } from "../lib/server/allowlist";
import { handleLocal } from "../lib/jarvis/local-intents";

describe("connector-allowlist", () => {
  it("staat alleen bekende endpoints toe", () => {
    expect(isAllowed("GET", "v1/snapshot")).toBe(true);
    expect(isAllowed("POST", "v1/devices/demo-lights%3Aspots/commands")).toBe(true);
    expect(isAllowed("DELETE", "v1/snapshot")).toBe(false);
    expect(isAllowed("GET", "v1/../../etc/passwd")).toBe(false);
    expect(isAllowed("GET", "admin")).toBe(false);
    expect(isAllowed("POST", "v1/devices/a/b/commands")).toBe(false);
  });

  it("controleert same-origin voor wijzigingen (CSRF)", () => {
    expect(isSameOrigin(new Headers({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOrigin(new Headers({ host: "127.0.0.1:3000" }))).toBe(false);
  });
});

const now = new Date().toISOString();
const dev = (o: Partial<Device>): Device => ({
  id: "x",
  name: "X",
  brand: "HomeOS Demo",
  model: "m",
  kind: "light",
  roomId: null,
  integration: "demo",
  adapterId: "demo-lights",
  status: "ONLINE",
  lastSeen: now,
  stateUpdatedAt: now,
  capabilities: ["onoff", "brightness"],
  state: { on: false },
  error: null,
  demo: true,
  ...o,
});

const snapshot = (emergencyStop = false): Snapshot => ({
  generatedAt: now,
  connector: { connectorId: "c", version: "0.1.0", startedAt: now, demoMode: true, emergencyStop, adapters: [] },
  rooms: [
    { id: "keuken", name: "Keuken", icon: "", order: 0 },
    { id: "woonkamer", name: "Woonkamer", icon: "", order: 1 },
  ],
  scenes: [{ id: "demo-lights:avond", name: "Avond", roomId: null, adapterId: "demo-lights", demo: true }],
  devices: [
    dev({ id: "l1", name: "Spots", roomId: "keuken", state: { on: true } }),
    dev({ id: "l2", name: "Staande lamp", roomId: "woonkamer" }),
    dev({ id: "l3", name: "Wandlamp tuin", status: "OFFLINE" }),
    dev({ id: "b1", name: "Deurbel voordeur", kind: "doorbell", capabilities: ["doorbell"] }),
  ],
});

const ctx = (s = snapshot()) => ({ snapshot: s, energy: null, connectorOnline: true });

describe("Jarvis lokale fallback", () => {
  it("beantwoordt welke lampen aan staan", () => {
    const r = handleLocal("Welke lampen staan nog aan?", ctx());
    expect(r.text).toContain("Spots");
    expect(r.actions).toEqual([]);
  });

  it("doet een voorstel (geen uitvoering) voor een opdracht", () => {
    const r = handleLocal("Zet de staande lamp aan", ctx());
    expect(r.actions).toEqual([expect.objectContaining({ kind: "command", deviceId: "l2", command: { type: "set_power", on: true } })]);
  });

  it("dimt met percentage", () => {
    const r = handleLocal("dim de spots naar 30%", ctx());
    expect(r.actions[0]).toMatchObject({ command: { type: "set_brightness", brightness: 30 } });
  });

  it("weigert offline apparaten en meldt dat", () => {
    const r = handleLocal("zet wandlamp tuin aan", ctx());
    expect(r.actions).toEqual([]);
    expect(r.intent).toBe("command_denied");
  });

  it("doet niets bij noodstop of offline connector", () => {
    expect(handleLocal("zet de staande lamp aan", ctx(snapshot(true))).actions).toEqual([]);
    expect(handleLocal("zet de staande lamp aan", { ...ctx(), connectorOnline: false }).actions).toEqual([]);
  });

  it("stelt alle lampen uit voor, alleen bereikbare lampen die aan staan", () => {
    const r = handleLocal("alle lampen uit", ctx());
    expect(r.actions.map((a) => a.kind === "command" && a.deviceId)).toEqual(["l1"]);
  });

  it("activeert scènes alleen als voorstel", () => {
    const r = handleLocal("activeer scène avond", ctx());
    expect(r.actions).toEqual([expect.objectContaining({ kind: "scene", sceneId: "demo-lights:avond" })]);
  });

  it("verzint geen energiegegevens", () => {
    expect(handleLocal("wat is de opbrengst van de zonnepanelen?", ctx()).text).toContain("geen energiebron");
  });
});

describe("Jarvis familie-intenties", () => {
  const family = { shopping: [{ name: "Melk", quantity: "2" }], openTasks: 3, upcoming: [{ title: "Tandarts", starts_at: "2026-11-21T09:00:00Z", all_day: false }], canWrite: true };

  it("zonder account: duidelijke melding, geen verzonnen gegevens", () => {
    expect(handleLocal("wat moeten we nog kopen?", ctx()).text).toContain("HomeOS-account");
  });
  it("leest de boodschappenlijst", () => {
    expect(handleLocal("Wat moeten we nog kopen?", { ...ctx(), family }).text).toContain("Melk (2)");
  });
  it("stelt een boodschap voor (geen directe wijziging)", () => {
    const r = handleLocal("zet appels op de boodschappenlijst", { ...ctx(), family });
    expect(r.actions).toEqual([expect.objectContaining({ kind: "shopping_add", name: "appels" })]);
  });
  it("gasten kunnen geen boodschappen toevoegen", () => {
    expect(handleLocal("zet appels op de boodschappenlijst", { ...ctx(), family: { ...family, canWrite: false } }).actions).toEqual([]);
  });
  it("toont de agenda", () => {
    expect(handleLocal("wat staat er in de agenda?", { ...ctx(), family }).text).toContain("Tandarts");
  });
});

describe("veilige redirects", () => {
  it("staat alleen interne paden toe", async () => {
    const { safeNext } = await import("../lib/safe-redirect");
    expect(safeNext("/familie")).toBe("/familie");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("Jarvis airco", () => {
  const climate = (on: boolean) =>
    dev({
      id: "ac",
      name: "Woonkamer airco",
      kind: "climate",
      capabilities: ["onoff", "climate"],
      state: { on, climate: { mode: "heating", modes: ["heating", "cooling"], targetTempC: 21, minTempC: 10, maxTempC: 30, stepC: 0.5, roomTempC: 19.5, outdoorTempC: 6 } },
    });
  const withAc = (on = true) => ({ ...ctx(), snapshot: { ...snapshot(), devices: [...snapshot().devices, climate(on)] } });

  it("beantwoordt temperatuurvragen", () => {
    expect(handleLocal("hoe warm is het binnen?", withAc()).text).toContain("19.5");
  });
  it("stelt een temperatuur voor met bevestiging", () => {
    const r = handleLocal("zet de airco op 22,5 graden", withAc());
    expect(r.actions[0]).toMatchObject({ deviceId: "ac", command: { type: "set_target_temperature", temperatureC: 22.5 } });
  });
  it("zet de airco uit als voorstel", () => {
    expect(handleLocal("airco uit", withAc()).actions[0]).toMatchObject({ command: { type: "set_power", on: false } });
  });
});

describe("Jarvis automatiseringen", () => {
  it("stelt een avondautomatisering voor die na bevestiging wordt aangemaakt", () => {
    const r = handleLocal("Stel een avondautomatisering voor", ctx());
    expect(r.actions).toEqual([expect.objectContaining({ kind: "create_automation", template: "evening" })]);
    expect(r.text).toContain("Avondmodus");
  });
  it("kent ook energie- en offline-sjablonen", () => {
    expect(handleLocal("maak een automatisering voor hoge zonne-opwek", ctx()).actions[0]).toMatchObject({ template: "energy" });
    expect(handleLocal("stel een automatisering voor als iets offline gaat", ctx()).actions[0]).toMatchObject({ template: "offline" });
  });
});
