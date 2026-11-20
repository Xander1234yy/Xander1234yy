import { describe, expect, it } from "vitest";
import type { Device, EnergySummary, Snapshot } from "@homeos/shared";
import { respondLocal, wordsToNumbers, getProvider, type JarvisContext } from "../src/index";

const now = new Date().toISOString();
const dev = (o: Partial<Device>): Device => ({
  id: "x", name: "X", brand: "HomeOS Demo", model: "m", kind: "light", roomId: null, integration: "demo", adapterId: "demo-lights",
  status: "ONLINE", lastSeen: now, stateUpdatedAt: now, capabilities: ["onoff", "brightness", "color", "color_temperature"], state: { on: false }, error: null, demo: true,
  ...o,
});

const snapshot = (emergencyStop = false): Snapshot => ({
  generatedAt: now,
  connector: { connectorId: "c", version: "0.1.0", startedAt: now, demoMode: true, emergencyStop, adapters: [] },
  rooms: [
    { id: "keuken", name: "Keuken", icon: "", order: 0 },
    { id: "woonkamer", name: "Woonkamer", icon: "", order: 1 },
    { id: "slaapkamer", name: "Slaapkamer", icon: "", order: 2 },
  ],
  scenes: [{ id: "demo-lights:avond", name: "Avond", roomId: null, adapterId: "demo-lights", demo: true }],
  devices: [
    dev({ id: "l1", name: "Spots", roomId: "keuken", state: { on: true, brightness: 50 } }),
    dev({ id: "l2", name: "Staande lamp", roomId: "woonkamer" }),
    dev({ id: "l4", name: "Plafondlamp", roomId: "woonkamer", state: { on: true, brightness: 80 } }),
    dev({ id: "l3", name: "Wandlamp tuin", status: "OFFLINE" }),
    dev({ id: "b1", name: "Deurbel voordeur", kind: "doorbell", capabilities: ["doorbell"] }),
    dev({
      id: "ac1", name: "Airco slaapkamer", kind: "climate", roomId: "slaapkamer", capabilities: ["onoff", "climate"],
      state: { on: true, climate: { mode: "heating", modes: ["heating", "cooling"], targetTempC: 20, minTempC: 16, maxTempC: 30, stepC: 0.5, roomTempC: 19.5, outdoorTempC: 6 } },
    }),
  ],
});

const ctx = (o: Partial<JarvisContext> = {}): JarvisContext => ({ snapshot: snapshot(), energy: null, connectorOnline: true, ...o });
const ask = (m: string, o: Partial<JarvisContext> = {}) => respondLocal(m, ctx(o));
const cmds = (r: ReturnType<typeof ask>) => r.actions.flatMap((a) => (a.kind === "command" ? [{ id: a.deviceId, ...a.command }] : []));

describe("tekst", () => {
  it("zet getallen in woorden om", () => {
    expect(wordsToNumbers("zet de airco op eenentwintig graden")).toBe("zet de airco op 21 graden");
    expect(wordsToNumbers("dertig procent")).toBe("30 procent");
  });
});

describe("lokale Jarvis: basis (geport)", () => {
  it("beantwoordt welke lampen aan staan", () => {
    const r = ask("Welke lampen staan nog aan?");
    expect(r.text).toContain("Spots");
    expect(r.text).toContain("Plafondlamp");
    expect(r.actions).toEqual([]);
    expect(r.provider).toBe("local");
  });
  it("doet een voorstel voor een opdracht", () => {
    expect(cmds(ask("Zet de staande lamp aan"))).toEqual([{ id: "l2", type: "set_power", on: true }]);
  });
  it("dimt met percentage", () => {
    expect(cmds(ask("dim de spots naar 30%"))).toEqual([{ id: "l1", type: "set_brightness", brightness: 30 }]);
  });
  it("weigert offline apparaten", () => {
    const r = ask("zet wandlamp tuin aan");
    expect(r.actions).toEqual([]);
    expect(r.intent).toBe("command_denied");
  });
  it("doet niets bij noodstop, offline connector of zonder rechten", () => {
    expect(respondLocal("zet de staande lamp aan", { ...ctx(), snapshot: snapshot(true) }).actions).toEqual([]);
    expect(ask("zet de staande lamp aan", { connectorOnline: false }).actions).toEqual([]);
    expect(ask("zet de staande lamp aan", { canControl: false }).intent).toBe("denied");
  });
  it("alle lampen uit: alleen lampen die aan staan", () => {
    expect(cmds(ask("alle lampen uit")).map((c) => c.id).sort()).toEqual(["l1", "l4"]);
  });
  it("scènes alleen als voorstel", () => {
    expect(ask("activeer scène avond").actions).toEqual([expect.objectContaining({ kind: "scene", sceneId: "demo-lights:avond" })]);
  });
  it("verzint geen energiegegevens", () => {
    expect(ask("wat is de opbrengst van de zonnepanelen?").text).toContain("geen energiebron");
  });
  it("bestuurt nooit veiligheidsapparaten", () => {
    expect(ask("zet de deurbel uit").actions).toEqual([]);
  });
});

describe("lokale Jarvis: slimmer begrip", () => {
  it("kamers", () => {
    expect(cmds(ask("zet de lampen in de woonkamer uit"))).toEqual([{ id: "l4", type: "set_power", on: false }]);
    expect(ask("welke lampen staan aan in de keuken?").text).toMatch(/1 lamp.*Spots/);
  });
  it("kleuren", () => {
    expect(cmds(ask("maak de plafondlamp blauw"))[0]).toMatchObject({ id: "l4", type: "set_color" });
  });
  it("feller en donkerder", () => {
    expect(cmds(ask("spots feller"))).toEqual([{ id: "l1", type: "set_brightness", brightness: 75 }]);
    expect(cmds(ask("maak de woonkamer donkerder"))).toEqual(expect.arrayContaining([{ id: "l4", type: "set_brightness", brightness: 55 }]));
  });
  it("getallen in woorden", () => {
    expect(cmds(ask("zet de airco op eenentwintig graden"))).toEqual([{ id: "ac1", type: "set_target_temperature", temperatureC: 21 }]);
    expect(cmds(ask("spots op veertig procent"))).toEqual([{ id: "l1", type: "set_brightness", brightness: 40 }]);
  });
  it("tikfouten in apparaatnamen", () => {
    expect(cmds(ask("zet de plafondlmap aan"))).toEqual([{ id: "l4", type: "set_power", on: true }]);
  });
  it("airco warmer en status", () => {
    expect(cmds(ask("airco warmer"))).toEqual([{ id: "ac1", type: "set_target_temperature", temperatureC: 21 }]);
    expect(ask("hoe warm is het in de slaapkamer?").text).toContain("19,5 °C");
  });
});

describe("lokale Jarvis: meerdere opdrachten en geheugen", () => {
  it("meerdere opdrachten in één zin", () => {
    const r = ask("zet de spots uit en de staande lamp aan");
    expect(cmds(r)).toEqual([{ id: "l1", type: "set_power", on: false }, { id: "l2", type: "set_power", on: true }]);
    expect(r.intent).toBe("multi");
  });
  it("vervolgvraag: zet ze uit", () => {
    const first = ask("welke lampen staan aan?");
    expect(first.memory?.deviceIds.sort()).toEqual(["l1", "l4"]);
    const second = ask("zet ze uit", { memory: first.memory });
    expect(cmds(second).map((c) => c.id).sort()).toEqual(["l1", "l4"]);
  });
});

describe("lokale Jarvis: energie, automatiseringen, familie, tijd", () => {
  const energy = { currentProductionW: 1200, currentConsumptionW: null, gridImportW: null, gridExportW: null, today: { productionKwh: 4.2, consumptionKwh: null }, month: { productionKwh: 80, consumptionKwh: null }, year: { productionKwh: 2500, consumptionKwh: null } } as unknown as EnergySummary;
  it("verbruik zonder meter: eerlijk", () => {
    expect(ask("wat is het verbruik?", { energy }).text).toContain("geen slimme meter");
  });
  it("weekoverzicht", () => {
    const energyWeek = { range: "week", points: [{ t: "2026-11-16T00:00:00Z", productionKwh: 3 }, { t: "2026-11-17T00:00:00Z", productionKwh: 5 }] } as never;
    const r = ask("weekoverzicht energie", { energy, energyWeek });
    expect(r.text).toContain("8 kWh");
    expect(r.intent).toBe("energy_week");
  });
  const automations = [{ id: "a1", name: "Avondmodus", enabled: true }];
  it("automatiseringen opsommen, uitvoeren en pauzeren als voorstel", () => {
    expect(ask("welke automatiseringen zijn er?", { automations }).text).toContain("Avondmodus");
    expect(ask("voer avondmodus uit", { automations }).actions).toEqual([expect.objectContaining({ kind: "automation_run", automationId: "a1" })]);
    expect(ask("pauzeer avondmodus", { automations }).actions).toEqual([expect.objectContaining({ kind: "automation_toggle", enabled: false })]);
    expect(ask("pauzeer avondmodus", { automations, canManageAutomations: false }).intent).toBe("denied");
    expect(ask("voer avondmodus uit", { automations, canControl: false }).intent).toBe("denied");
  });
  const family = { shopping: [{ name: "Melk", quantity: "2" }], openTasks: 3, upcoming: [{ title: "Tandarts", starts_at: "2026-11-21T09:00:00Z", all_day: false }], canWrite: true };
  const today = new Date("2026-11-20T12:00:00Z");
  it("familie", () => {
    expect(ask("wat moeten we nog kopen?").text).toContain("HomeOS-account");
    expect(ask("Wat moeten we nog kopen?", { family }).text).toContain("Melk (2)");
    expect(ask("zet appels op de boodschappenlijst", { family }).actions).toEqual([expect.objectContaining({ kind: "shopping_add", name: "appels" })]);
    expect(ask("zet appels op de boodschappenlijst", { family: { ...family, canWrite: false } }).actions).toEqual([]);
    expect(ask("wat staat er morgen in de agenda?", { family, now: today }).text).toContain("Tandarts");
    expect(ask("wat staat er vandaag in de agenda?", { family, now: today }).text).toContain("niets");
    expect(ask("voeg taak vuilnis buiten zetten toe", { family }).actions).toEqual([expect.objectContaining({ kind: "task_add", title: "vuilnis buiten zetten" })]);
  });
  it("tijd en datum", () => {
    expect(ask("hoe laat is het?", { now: today }).intent).toBe("time");
    expect(ask("welke datum is het vandaag?", { now: today }).text).toContain("2026");
  });
  it("provider", async () => {
    const p = getProvider(undefined);
    expect(p.requiresNetwork).toBe(false);
    expect((await p.respond("help", ctx())).intent).toBe("help");
  });
});

describe("lokale Jarvis: tv", () => {
  const withTv = (o: Partial<Device> = {}) => {
    const s = snapshot();
    s.devices.push(
      dev({
        id: "tv1", name: "LG OLED48CX6LB", kind: "media", roomId: "woonkamer", integration: "lg_webos", demo: false,
        capabilities: ["media_power", "media_playback", "volume", "source_select", "wake_on_lan", "remote_control"],
        state: { on: true, media: { power: "on", playback: "unknown", volume: 12, muted: false, app: "HDMI 1", source: "input:HDMI_1", sources: [
          { id: "input:HDMI_1", label: "HDMI 1", type: "input" }, { id: "input:HDMI_2", label: "PlayStation", type: "input" },
          { id: "app:netflix", label: "Netflix", type: "app" }, { id: "app:youtube.leanback.v4", label: "YouTube", type: "app" },
        ] } },
        ...o,
      }),
    );
    return { ...ctx(), snapshot: s };
  };
  const tvCmd = (m: string, c = withTv()) => respondLocal(m, c).actions.flatMap((a) => (a.kind === "command" ? [a.command] : []));

  it("volume, dempen, bronnen en aan/uit als voorstel", () => {
    expect(tvCmd("zet de tv zachter")).toEqual([{ type: "set_volume", volume: 7 }]);
    expect(tvCmd("tv harder")).toEqual([{ type: "set_volume", volume: 17 }]);
    expect(tvCmd("zet de tv op twintig")).toEqual([{ type: "set_volume", volume: 20 }]);
    expect(tvCmd("demp de tv")).toEqual([{ type: "set_mute", muted: true }]);
    expect(tvCmd("zet netflix op de tv")).toEqual([{ type: "select_source", sourceId: "app:netflix" }]);
    expect(tvCmd("tv naar hdmi 2")).toEqual([{ type: "select_source", sourceId: "input:HDMI_2" }]); // ook als die ingang hernoemd is
    expect(tvCmd("tv naar hdmi 3")).toEqual([]); // bestaat niet: niet gokken
    expect(tvCmd("zet de playstation aan")).toEqual([{ type: "select_source", sourceId: "input:HDMI_2" }]);
    expect(tvCmd("open youtube")).toEqual([{ type: "select_source", sourceId: "app:youtube.leanback.v4" }]);
    expect(tvCmd("tv uit")).toEqual([{ type: "media_power", on: false }]);
    expect(tvCmd("volgende zender")).toEqual([{ type: "remote_button", button: "CHANNELUP" }]);
    expect(tvCmd("vorige zender")).toEqual([{ type: "remote_button", button: "CHANNELDOWN" }]);
    expect(tvCmd("zet zender 12 op")).toEqual([{ type: "remote_button", button: "1" }, { type: "remote_button", button: "2" }]);
  });
  it("status en vervolgvraag", () => {
    const c = withTv();
    const r = respondLocal("wat staat er op tv?", c);
    expect(r.text).toContain("HDMI 1");
    expect(r.text).toContain("volume 12");
    expect(respondLocal("zet hem uit", { ...c, memory: r.memory }).actions).toHaveLength(0); // "hem" is geen bekend voornaamwoord → geen gok
    expect(tvCmd("zet ze uit", { ...c, memory: r.memory })).toEqual([{ type: "media_power", on: false }]);
  });
  it("tv uit en offline: aanzetten via het netwerk mag, al-uit wordt gemeld", () => {
    const off = withTv({ status: "OFFLINE", state: { on: false, media: { power: "standby", playback: "idle" } } });
    expect(tvCmd("zet de tv aan", off)).toEqual([{ type: "media_power", on: true }]);
    expect(respondLocal("tv uit", off).intent).toBe("noop");
  });
});

describe("lokale Jarvis: camera's", () => {
  it("meldt beweging, maar bedient geen camera's", () => {
    const s = snapshot();
    s.devices.push(dev({ id: "cam1", name: "Tuin C500", kind: "camera", capabilities: ["camera_stream", "motion", "ptz"], state: { lastMotionAt: "2026-11-21T10:15:00Z" } }));
    const c = { ...ctx(), snapshot: s };
    expect(respondLocal("is er beweging geweest?", c).text).toContain("Tuin C500: laatste beweging");
    const r = respondLocal("draai de camera naar links", c);
    expect(r.actions).toEqual([]);
    expect(r.intent).toBe("denied");
  });
});
