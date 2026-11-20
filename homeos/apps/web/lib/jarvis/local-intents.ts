import {
  checkCommand,
  type Device,
  type DeviceCommand,
  type EnergySummary,
  type Snapshot,
} from "@homeos/shared";

/**
 * Lokale Jarvis-fallback: begrijpt eenvoudige Nederlandse vragen en opdrachten zonder AI-provider.
 * Jarvis voert zelf NOOIT iets uit: opdrachten worden als voorstel teruggegeven, de gebruiker bevestigt,
 * en de connector controleert de bevoegdheid opnieuw (bron "jarvis").
 */

export interface FamilyContext {
  shopping: { name: string; quantity: string }[];
  openTasks: number;
  upcoming: { title: string; starts_at: string; all_day: boolean }[];
  canWrite: boolean;
}

export interface JarvisContext {
  snapshot: Snapshot | null;
  energy: EnergySummary | null;
  connectorOnline: boolean;
  /** Alleen aanwezig met een HomeOS-account (Supabase). */
  family?: FamilyContext;
}

export type JarvisAction =
  | { kind: "command"; deviceId: string; deviceName: string; command: DeviceCommand; label: string }
  | { kind: "scene"; sceneId: string; sceneName: string; label: string }
  | { kind: "shopping_add"; name: string; label: string };

export interface JarvisReply {
  intent: string;
  text: string;
  actions: JarvisAction[];
  provider: "local";
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["de", "het", "een", "in", "op", "van", "lamp", "lampen", "licht", "aan", "uit", "zet", "doe"]);

function words(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const has = (msg: string, ...terms: string[]) => terms.some((t) => new RegExp(`(^|\\s)${t}`).test(msg));

function kw(n: number | null | undefined, digits = 1) {
  return n == null ? "onbekend" : `${n.toLocaleString("nl-NL", { maximumFractionDigits: digits, minimumFractionDigits: digits })} kWh`;
}
function watt(n: number | null | undefined) {
  return n == null ? "onbekend" : `${Math.round(n).toLocaleString("nl-NL")} W`;
}

function roomName(s: Snapshot, id: string | null) {
  return s.rooms.find((r) => r.id === id)?.name ?? "";
}

function findRoom(s: Snapshot, msg: string) {
  return s.rooms.find((r) => words(r.name).some((w) => msg.includes(w)) || msg.includes(normalize(r.name)));
}

function matchDevices(s: Snapshot, msg: string, filter: (d: Device) => boolean): Device[] {
  const room = findRoom(s, msg);
  let best: Device[] = [];
  let bestScore = 0;
  for (const d of s.devices.filter(filter)) {
    let score = words(d.name).filter((w) => msg.includes(w)).length * 2;
    if (room && d.roomId === room.id) score += 1;
    if (score > bestScore) {
      best = [d];
      bestScore = score;
    } else if (score === bestScore && score > 0) best.push(d);
  }
  return bestScore >= 2 || (bestScore === 1 && best.length === 1) ? best : [];
}

function reply(intent: string, text: string, actions: JarvisAction[] = []): JarvisReply {
  return { intent, text, actions, provider: "local" };
}

const DEMO_NOTE = " (DEMO-gegevens)";

export function handleLocal(message: string, ctx: JarvisContext): JarvisReply {
  const msg = normalize(message);
  const s = ctx.snapshot;
  if (!msg) return reply("empty", "Wat kan ik voor je doen?");

  if (has(msg, "help", "wat kun je", "wat kan je")) {
    return reply(
      "help",
      "Zonder AI-provider begrijp ik eenvoudige vragen: welke lampen aan staan, de zonne-opbrengst, het verbruik, welke apparaten offline zijn, en opdrachten zoals \"zet de spots in de keuken aan\", \"dim de plafondlamp naar 30%\", \"alle lampen uit\" of \"activeer scène avond\". Ik vraag altijd om bevestiging voordat er iets gebeurt.",
    );
  }

  if (has(msg, "boodschap", "kopen", "agenda", "afspraak", "taken", "taak")) {
    return familyIntent(message, msg, ctx.family);
  }

  if (has(msg, "automatiser", "routine") && has(msg, "stel", "voorstel", "maak", "bedenk")) {
    const scene = s?.scenes.find((x) => normalize(x.name) === "avond");
    return reply(
      "suggest_automation",
      `Voorstel "Avondmodus": elke dag om 19:30${scene ? ` scène "${scene.name}" activeren` : " de woonkamerverlichting dimmen"}, daarna een avondoverzicht tonen met openstaande herinneringen. De automatiseringsmotor komt in fase 5; dan kun je dit voorstel met één tik opslaan.`,
    );
  }

  if (!s) {
    return reply("no_data", "Ik heb nog geen gegevens van je huis. Controleer of de HomeOS Device Connector draait.");
  }
  const demo = s.connector.demoMode ? DEMO_NOTE : "";
  const offlineNote = ctx.connectorOnline ? "" : " Let op: de connector is offline, dit zijn de laatst bekende gegevens.";

  // ---------- energie ----------
  if (has(msg, "zon", "opbrengst", "opwek", "productie", "panelen")) {
    const e = ctx.energy;
    if (!e) return reply("solar", "Er is geen energiebron gekoppeld, dus ik kan de opbrengst niet uitlezen.");
    if (has(msg, "week", "overzicht")) {
      return reply("energy_week", `Deze maand tot nu toe: ${kw(e.month.productionKwh)} opgewekt, ${kw(e.month.consumptionKwh)} verbruikt en ${kw(e.month.exportKwh)} teruggeleverd${demo}. Bekijk de pagina Energie voor de weekgrafiek.${offlineNote}`);
    }
    return reply("solar", `De zonnepanelen leveren nu ${watt(e.currentProductionW)}. Vandaag is er ${kw(e.today.productionKwh)} opgewekt${demo}.${offlineNote}`);
  }
  if (has(msg, "verbruik", "energie", "stroom", "teruglever", "net")) {
    const e = ctx.energy;
    if (!e) return reply("energy", "Er is geen energiebron gekoppeld.");
    return reply(
      "energy",
      `Nu: ${watt(e.currentConsumptionW)} verbruik, ${e.gridExportW ? `${watt(e.gridExportW)} teruglevering` : `${watt(e.gridImportW)} afname van het net`}. Vandaag: ${kw(e.today.consumptionKwh)} verbruikt, ${kw(e.today.importKwh)} afgenomen en ${kw(e.today.exportKwh)} teruggeleverd${demo}.${offlineNote}`,
    );
  }

  // ---------- status ----------
  if (has(msg, "offline", "bereikbaar", "storing", "problem", "kapot")) {
    const bad = s.devices.filter((d) => d.status !== "ONLINE");
    if (!ctx.connectorOnline) return reply("offline", `De connector zelf is offline, dus ik weet de actuele status niet. Laatste synchronisatie: ${new Date(s.generatedAt).toLocaleString("nl-NL")}.`);
    if (!bad.length) return reply("offline", `Alle ${s.devices.length} apparaten zijn online${demo}.`);
    return reply("offline", `Niet online: ${bad.map((d) => `${d.name} (${d.status.toLowerCase()})`).join(", ")}${demo}.`);
  }

  const lights = s.devices.filter((d) => d.kind === "light");
  const isQuestion = has(msg, "welke", "staan", "staat", "hoeveel", "is er", "zijn er") && !has(msg, "zet", "doe");
  if (isQuestion && has(msg, "lamp", "licht", "verlichting")) {
    const on = lights.filter((d) => d.state.on && d.status === "ONLINE");
    if (!on.length) return reply("lights_on", `Er staan geen lampen aan${demo}.${offlineNote}`);
    return reply("lights_on", `Er ${on.length === 1 ? "staat 1 lamp" : `staan ${on.length} lampen`} aan: ${on.map((d) => `${d.name}${roomName(s, d.roomId) ? ` (${roomName(s, d.roomId)})` : ""}`).join(", ")}${demo}.${offlineNote}`);
  }

  // ---------- opdrachten (alleen voorstellen) ----------
  const wantsCommand = has(msg, "zet", "doe", "schakel", "dim", "activeer", "start", "alle", "maak");
  if (wantsCommand) {
    if (!ctx.connectorOnline) {
      return reply("command_blocked", "De connector is offline. Ik kan nu geen opdrachten laten uitvoeren en bewaar ze ook niet om later automatisch uit te voeren.");
    }
    const policy = { source: "jarvis" as const, emergencyStop: s.connector.emergencyStop };
    if (s.connector.emergencyStop) {
      return reply("command_blocked", "De noodstop is actief. Zolang die aan staat voer ik geen opdrachten uit. Je kunt apparaten wel zelf bedienen.");
    }

    // scène
    if (has(msg, "scene", "sfeer", "activeer")) {
      const scene = s.scenes.find((x) => msg.includes(normalize(x.name)));
      if (scene) return reply("scene", `Wil je scène "${scene.name}" activeren?`, [{ kind: "scene", sceneId: scene.id, sceneName: scene.name, label: `Scène ${scene.name} activeren` }]);
      if (s.scenes.length) return reply("scene", `Welke scène bedoel je? Beschikbaar: ${s.scenes.map((x) => x.name).join(", ")}.`);
    }

    const on = /(^|\s)aan($|\s)/.test(msg) ? true : /(^|\s)uit($|\s)/.test(msg) ? false : null;
    const pct = /(\d{1,3})\s?(%|procent)/.exec(msg);

    if (has(msg, "alle") && on !== null) {
      const room = findRoom(s, msg);
      const targets = lights.filter((d) => (!room || d.roomId === room.id) && d.state.on !== on && checkCommand(d, { type: "set_power", on }, policy).ok);
      if (!targets.length) return reply("all_lights", `Alle${room ? ` lampen in ${room.name}` : " lampen"} staan al ${on ? "aan" : "uit"} (of zijn niet bereikbaar).`);
      return reply(
        "all_lights",
        `Ik zet ${targets.length} ${targets.length === 1 ? "lamp" : "lampen"} ${on ? "aan" : "uit"}${room ? ` in ${room.name}` : ""}: ${targets.map((d) => d.name).join(", ")}. Bevestig je dit?`,
        targets.map((d) => ({ kind: "command" as const, deviceId: d.id, deviceName: d.name, command: { type: "set_power" as const, on }, label: `${d.name} ${on ? "aan" : "uit"}` })),
      );
    }

    const candidates = matchDevices(s, msg, (d) => d.capabilities.includes("onoff") || d.capabilities.includes("brightness"));
    if (candidates.length > 1) return reply("ambiguous", `Bedoel je ${candidates.map((d) => `${d.name} (${roomName(s, d.roomId) || "geen kamer"})`).join(" of ")}?`);
    const target = candidates[0];
    if (!target) return reply("unknown_device", "Ik weet niet welk apparaat je bedoelt. Noem de naam zoals die in HomeOS staat, bijvoorbeeld \"zet de staande lamp aan\".");

    let command: DeviceCommand | null = null;
    let label = "";
    if (pct) {
      const brightness = Math.min(100, Math.max(1, Number(pct[1])));
      command = { type: "set_brightness", brightness };
      label = `${target.name} op ${brightness}%`;
    } else if (on !== null) {
      command = { type: "set_power", on };
      label = `${target.name} ${on ? "aan" : "uit"}`;
    }
    if (!command) return reply("unclear_command", `Wat wil je met ${target.name} doen? Bijvoorbeeld aan, uit of een percentage.`);
    const check = checkCommand(target, command, policy);
    if (!check.ok) return reply("command_denied", `Dat kan ik niet doen: ${check.reason}`);
    return reply("command", `${label}. Bevestig je dit?`, [{ kind: "command", deviceId: target.id, deviceName: target.name, command, label }]);
  }

  return reply(
    "fallback",
    "Dat begrijp ik nog niet zonder AI-provider. Probeer bijvoorbeeld: \"Welke lampen staan nog aan?\", \"Wat is de huidige opbrengst van onze zonnepanelen?\" of \"Zet de spots in de keuken aan\".",
  );
}

function familyIntent(original: string, msg: string, f: FamilyContext | undefined): JarvisReply {
  if (!f) {
    return reply("family", "De agenda, taken en boodschappenlijst zijn beschikbaar met een HomeOS-account (Supabase). In de lokale modus kan ik ze niet raadplegen.");
  }
  // "zet melk op de boodschappenlijst", "voeg 2 pakken melk toe aan de boodschappen"
  const add = /(?:zet|voeg|doe)\s+(.+?)\s+(?:op|aan|bij|toe aan)\s+(?:de\s+)?boodschap/i.exec(original);
  if (add?.[1]) {
    const name = add[1].replace(/\s+toe$/i, "").trim().slice(0, 120);
    if (!f.canWrite) return reply("shopping_denied", "Je rol mag de boodschappenlijst niet wijzigen.");
    return reply("shopping_add", `Zal ik "${name}" op de boodschappenlijst zetten?`, [{ kind: "shopping_add", name, label: `${name} toevoegen aan boodschappen` }]);
  }
  if (has(msg, "boodschap", "kopen")) {
    if (!f.shopping.length) return reply("shopping_list", "De boodschappenlijst is leeg.");
    return reply("shopping_list", `Nog te kopen (${f.shopping.length}): ${f.shopping.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(", ")}.`);
  }
  if (has(msg, "agenda", "afspraak")) {
    if (!f.upcoming.length) return reply("agenda", "Er staan de komende zeven dagen geen afspraken in de agenda.");
    const fmt = (e: FamilyContext["upcoming"][number]) => {
      const d = new Date(e.starts_at);
      const day = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "short" });
      return `${e.title} (${day}${e.all_day ? "" : ` ${d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`})`;
    };
    return reply("agenda", `Komende afspraken: ${f.upcoming.map(fmt).join("; ")}.`);
  }
  return reply("tasks", f.openTasks ? `Er ${f.openTasks === 1 ? "staat 1 taak" : `staan ${f.openTasks} taken`} open. Bekijk ze op de pagina Familie.` : "Er staan geen open taken.");
}
