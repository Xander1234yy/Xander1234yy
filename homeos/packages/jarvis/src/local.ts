import { checkCommand, type Device, type DeviceCommand, type Room, type Snapshot } from "@homeos/shared";
import { COLORS, distance, fmtNum, has, hasWord, normalize, wordsToNumbers } from "./text";
import type { JarvisAction, JarvisContext, JarvisMemory, JarvisProvider, JarvisReply } from "./types";

/**
 * Lokale Jarvis: begrijpt Nederlandse vragen en opdrachten zonder AI-dienst of internet.
 * Doet alleen voorstellen; de gebruiker bevestigt en de connector controleert opnieuw (bron "jarvis").
 */
export class LocalJarvis implements JarvisProvider {
  readonly id = "local";
  readonly name = "Lokale Jarvis";
  readonly requiresNetwork = false;
  async respond(message: string, ctx: JarvisContext): Promise<JarvisReply> {
    return respondLocal(message, ctx);
  }
}

const PROVIDER = "local";
const STOP = new Set(["de", "het", "een", "in", "op", "van", "voor", "aan", "uit", "zet", "doe", "maak", "mijn", "onze", "alle", "lamp", "lampen", "licht", "naar", "graden", "procent", "wat", "is", "staat", "en", "die", "ze"]);
const COMMAND_VERBS = ["zet", "doe", "schakel", "dim", "activeer", "start", "maak", "pauzeer", "voer", "verwarm", "koel", "voeg", "draai"];
const PRONOUNS = ["ze", "die", "deze", "het", "allemaal", "alles"];
const MODE_NL: Record<string, string> = { heating: "verwarmen", cooling: "koelen", auto: "automatisch", dry: "drogen", fanOnly: "ventileren" };
const DEMO_NOTE = " (DEMO-gegevens)";

type Partial = { text: string; actions: JarvisAction[]; intent: string; memory?: JarvisMemory };
const say = (intent: string, text: string, actions: JarvisAction[] = [], memory?: JarvisMemory): Partial => ({ intent, text, actions, ...(memory ? { memory } : {}) });

const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
const kw = (n: number | null | undefined, d = 1) => (n == null ? "onbekend" : `${fmtNum(n, d)} kWh`);
const watt = (n: number | null | undefined) => (n == null ? "onbekend" : `${Math.round(n).toLocaleString("nl-NL")} W`);

function roomName(s: Snapshot, id: string | null) {
  return s.rooms.find((r) => r.id === id)?.name ?? "";
}

function findRoom(s: Snapshot, msg: string): Room | undefined {
  return s.rooms.find((r) => {
    const n = normalize(r.name);
    return msg.includes(n) || words(r.name).some((w) => hasWord(msg, w) || hasWord(msg, `${w}s`));
  });
}

/** Zoekt apparaten op naam (met tikfouten), kamer en soort. */
export function matchDevices(s: Snapshot, msg: string, filter: (d: Device) => boolean = () => true): Device[] {
  const room = findRoom(s, msg);
  const tokens = msg.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  let best: Device[] = [];
  let bestScore = 0;
  for (const d of s.devices.filter(filter)) {
    let score = 0;
    for (const w of words(d.name)) {
      if (tokens.includes(w) || msg.includes(w)) score += 2;
      else if (w.length >= 5 && tokens.some((t) => t.length >= 4 && distance(t, w) <= 1)) score += 1.5;
    }
    if (room && d.roomId === room.id) score += 0.5;
    if (score > bestScore) {
      best = [d];
      bestScore = score;
    } else if (score === bestScore && score > 0) best.push(d);
  }
  return bestScore >= 1.5 ? best : [];
}

function suggestNames(s: Snapshot, msg: string): string[] {
  const tokens = msg.split(" ").filter((w) => w.length > 3);
  return s.devices
    .map((d) => ({ d, score: Math.min(...words(d.name).flatMap((w) => tokens.map((t) => distance(t, w))), 99) }))
    .filter((x) => x.score <= 3)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((x) => x.d.name);
}

const isCommand = (msg: string) => has(msg, ...COMMAND_VERBS) || /(^|\s)(aan|uit)$/.test(msg) || /\d{1,3}\s?(%|procent)/.test(msg);

export function respondLocal(message: string, ctx: JarvisContext): JarvisReply {
  const msg = wordsToNumbers(normalize(message));
  // Meerdere opdrachten in één zin: "zet de spots aan en de airco op 21 graden".
  const parts = msg.split(/\s(?:en daarna|daarna|en dan|en)\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && parts.filter(isCommand).length >= 1 && parts.every((p) => isCommand(p) || p.split(" ").length <= 6)) {
    let memory = ctx.memory ?? null;
    const results: Partial[] = [];
    let carryVerb = "";
    for (const p of parts) {
      const verb = COMMAND_VERBS.find((v) => has(p, v));
      if (verb) carryVerb = verb;
      const clause = verb ? p : `${carryVerb} ${p}`.trim();
      const r = handle(clause, message, { ...ctx, memory });
      results.push(r);
      if (r.memory) memory = r.memory;
    }
    const actions = results.flatMap((r) => r.actions);
    if (actions.length || results.every((r) => r.intent !== "fallback")) {
      const text = results.map((r) => r.text.replace(/ Bevestig je dit\?$/, "")).join(" ") + (actions.length ? " Bevestig je dit?" : "");
      return { intent: "multi", text, actions, provider: PROVIDER, ...(memory ? { memory } : {}) };
    }
  }
  const r = handle(msg, message, ctx);
  return { intent: r.intent, text: r.text, actions: r.actions, provider: PROVIDER, ...(r.memory ? { memory: r.memory } : {}) };
}

function handle(msg: string, original: string, ctx: JarvisContext): Partial {
  const s = ctx.snapshot;
  const now = ctx.now ?? new Date();
  if (!msg) return say("empty", "Wat kan ik voor je doen?");

  if (has(msg, "help", "wat kun je", "wat kan je", "hoe werk")) {
    return say(
      "help",
      'Ik werk lokaal, zonder internet of AI-dienst. Vraag bijvoorbeeld: "welke lampen staan aan?", "zet de lampen in de keuken uit", "maak de plafondlamp blauw", "woonkamer feller", "zet de airco op 21 graden", "wat is de opbrengst vandaag?", "weekoverzicht energie", "wat staat er morgen op de agenda?", "zet melk op de boodschappenlijst" of "voer avondmodus uit". Ik vraag altijd om bevestiging voordat er iets gebeurt.',
    );
  }
  if (/^(hallo|hoi|hey|goedemorgen|goedemiddag|goedenavond|dag jarvis|hallo jarvis)\b/.test(msg)) {
    const h = now.getHours();
    const greet = h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond";
    if (!s) return say("greeting", `${greet}! Ik heb nog geen gegevens van de connector.`);
    const on = s.devices.filter((d) => d.kind === "light" && d.status === "ONLINE" && d.state.on).length;
    const off = s.devices.filter((d) => d.status !== "ONLINE").length;
    return say("greeting", `${greet}! Er ${on === 1 ? "staat 1 lamp" : `staan ${on} lampen`} aan${off ? ` en ${off} apparaat/apparaten zijn niet bereikbaar` : ""}. Waarmee kan ik helpen?`);
  }
  if (has(msg, "hoe laat")) return say("time", `Het is ${now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`);
  if (has(msg, "welke dag", "datum", "wat voor dag")) return say("date", `Het is ${now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);

  // ───── familie ─────
  if (has(msg, "boodschap", "kopen", "agenda", "afspraak", "taken", "taak", "todo")) return family(msg, original, ctx, now);

  // ───── automatiseringen ─────
  if ((msg.includes("automatiser") || has(msg, "routine")) && has(msg, "stel", "voorstel", "maak", "bedenk")) return suggestAutomation(msg, s);
  const auto = automationIntent(msg, ctx);
  if (auto) return auto;

  if (!s) return say("no_data", "Ik heb nog geen gegevens van je huis. Controleer of de HomeOS Device Connector draait.");
  const demo = s.connector.demoMode ? DEMO_NOTE : "";
  const stale = ctx.connectorOnline ? "" : " Let op: de connector is offline, dit zijn de laatst bekende gegevens.";

  // ───── energie ─────
  const energy = energyIntent(msg, ctx, demo, stale);
  if (energy) return energy;

  // ───── tv ─────
  const tv = tvIntent(msg, s, ctx, demo, stale);
  if (tv) return tv;

  // ───── klimaat ─────
  const climate = climateIntent(msg, s, ctx, demo, stale);
  if (climate) return climate;

  // ───── status ─────
  if (has(msg, "offline", "bereikbaar", "storing", "problem", "kapot")) {
    if (!ctx.connectorOnline) return say("offline", `De connector zelf is offline, dus ik weet de actuele status niet. Laatste gegevens: ${new Date(s.generatedAt).toLocaleString("nl-NL")}.`);
    const bad = s.devices.filter((d) => d.status !== "ONLINE");
    if (!bad.length) return say("offline", `Alle ${s.devices.length} apparaten zijn online${demo}.`);
    return say("offline", `Niet online: ${bad.map((d) => `${d.name} (${d.status.toLowerCase()})`).join(", ")}${demo}.`, [], { deviceIds: bad.map((d) => d.id), roomId: null });
  }

  const lights = s.devices.filter((d) => d.kind === "light");
  const question = (has(msg, "welke", "hoeveel", "zijn er", "is er", "staan", "staat") || original.trim().endsWith("?")) && !has(msg, ...COMMAND_VERBS);
  if (question && has(msg, "lamp", "licht", "verlichting")) {
    const room = findRoom(s, msg);
    const on = lights.filter((d) => d.state.on && d.status === "ONLINE" && (!room || d.roomId === room.id));
    const where = room ? ` in ${room.name}` : "";
    if (!on.length) return say("lights_on", `Er staan geen lampen aan${where}${demo}.${stale}`, [], { deviceIds: [], roomId: room?.id ?? null });
    return say(
      "lights_on",
      `Er ${on.length === 1 ? "staat 1 lamp" : `staan ${on.length} lampen`} aan${where}: ${on.map((d) => `${d.name}${!room && roomName(s, d.roomId) ? ` (${roomName(s, d.roomId)})` : ""}`).join(", ")}${demo}.${stale}`,
      [],
      { deviceIds: on.map((d) => d.id), roomId: room?.id ?? null },
    );
  }
  if (question && has(msg, "verbruik", "vermogen", "watt", "trekt")) {
    const [d] = matchDevices(s, msg, (x) => x.state.powerW != null);
    if (d) return say("device_power", `${d.name} verbruikt nu ${watt(d.state.powerW)}${d.state.energyTodayKwh != null ? `, vandaag ${kw(d.state.energyTodayKwh, 2)}` : ""}${demo}.${stale}`, [], { deviceIds: [d.id], roomId: d.roomId });
  }
  if (question) {
    const found = matchDevices(s, msg);
    if (found.length === 1) {
      const d = found[0]!;
      const status = d.status !== "ONLINE" ? `is ${d.status.toLowerCase()}` : d.state.on === undefined ? "is online" : d.state.on ? `staat aan${d.state.brightness ? ` (${d.state.brightness}%)` : ""}` : "staat uit";
      return say("device_status", `${d.name} ${status}${demo}.${stale}`, [], { deviceIds: [d.id], roomId: d.roomId });
    }
  }

  // ───── opdrachten ─────
  if (isCommand(msg) || has(msg, "feller", "lichter", "donkerder", "dimmen", "helderder", "warmer licht", "koeler licht")) return commands(msg, s, ctx);

  const names = suggestNames(s, msg);
  return say(
    "fallback",
    `Dat begrijp ik nog niet.${names.length ? ` Bedoel je misschien ${names.join(" of ")}?` : ""} Probeer bijvoorbeeld "welke lampen staan aan?" of "zet de spots in de keuken aan". Typ "help" voor meer voorbeelden.`,
  );
}

function family(msg: string, original: string, ctx: JarvisContext, now: Date): Partial {
  const f = ctx.family;
  if (!f) return say("family", "De agenda, taken en boodschappenlijst zijn beschikbaar met een HomeOS-account (Supabase). In de lokale modus kan ik ze niet raadplegen.");
  const add = /(?:zet|voeg|doe)\s+(.+?)\s+(?:op|aan|bij|toe aan)\s+(?:de\s+)?boodschap/i.exec(original);
  if (add?.[1]) {
    const name = add[1].replace(/\s+toe$/i, "").trim().slice(0, 120);
    if (!f.canWrite) return say("denied", "Je rol mag de boodschappenlijst niet wijzigen.");
    return say("shopping_add", `Zal ik "${name}" op de boodschappenlijst zetten?`, [{ kind: "shopping_add", name, label: `${name} toevoegen aan boodschappen` }]);
  }
  const task = /(?:voeg|maak|nieuwe)\s+(?:een\s+)?(?:taak|todo)\s*:?\s*(.+?)(?:\s+toe)?$/i.exec(original.trim()) ?? /(?:taak|todo)\s+toevoegen\s*:?\s*(.+)$/i.exec(original.trim());
  if (task?.[1] && has(msg, "voeg", "maak", "nieuwe", "toevoegen")) {
    const title = task[1].trim().replace(/[.?!]$/, "").slice(0, 200);
    if (!f.canWrite) return say("denied", "Je rol mag geen taken toevoegen.");
    return say("task_add", `Zal ik de taak "${title}" toevoegen?`, [{ kind: "task_add", title, label: `Taak: ${title}` }]);
  }
  if (has(msg, "boodschap", "kopen")) {
    if (!f.shopping.length) return say("shopping_list", "De boodschappenlijst is leeg.");
    return say("shopping_list", `Nog te kopen (${f.shopping.length}): ${f.shopping.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(", ")}.`);
  }
  if (has(msg, "agenda", "afspraak")) {
    const dayOffset = has(msg, "overmorgen") ? 2 : has(msg, "morgen") ? 1 : has(msg, "vandaag") ? 0 : null;
    let events = f.upcoming;
    let when = "de komende zeven dagen";
    if (dayOffset !== null) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset).toDateString();
      events = f.upcoming.filter((e) => new Date(e.starts_at).toDateString() === day);
      when = dayOffset === 0 ? "vandaag" : dayOffset === 1 ? "morgen" : "overmorgen";
    }
    if (!events.length) return say("agenda", `Er staat ${when} niets in de agenda.`);
    const fmt = (e: (typeof events)[number]) => {
      const d = new Date(e.starts_at);
      const day = dayOffset === null ? `${d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "short" })} ` : "";
      return `${e.title} (${day}${e.all_day ? "hele dag" : d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })})`.replace("( ", "(");
    };
    return say("agenda", `${when[0]!.toUpperCase()}${when.slice(1)}: ${events.map(fmt).join("; ")}.`);
  }
  return say("tasks", f.openTasks ? `Er ${f.openTasks === 1 ? "staat 1 taak" : `staan ${f.openTasks} taken`} open. Bekijk ze op de pagina Familie.` : "Er staan geen open taken.");
}

function suggestAutomation(msg: string, s: Snapshot | null): Partial {
  if (has(msg, "energie", "zon", "opwek")) {
    return say("suggest_automation", 'Voorstel "Energiemelding": als de zonne-opwek boven 3000 W komt, krijg je een melding met de actuele opbrengst (max. 3× per dag). Zal ik hem aanmaken?', [{ kind: "create_automation", template: "energy", label: "Automatisering Energiemelding aanmaken" }]);
  }
  if (has(msg, "offline")) {
    return say("suggest_automation", 'Voorstel "Apparaat offline": als een apparaat 30 minuten niet bereikbaar is, krijg je een melding met het tijdstip waarop het laatst gezien is. Zal ik hem aanmaken?', [{ kind: "create_automation", template: "offline", label: "Automatisering Apparaat offline aanmaken" }]);
  }
  const scene = s?.scenes.find((x) => /avond|ontspan/.test(normalize(x.name)));
  return say(
    "suggest_automation",
    `Voorstel "Avondmodus": elke dag om 20:00${scene ? ` scène "${scene.name}" activeren` : ""} en een avondoverzicht sturen (lampen, apparaten en energie van vandaag). Zal ik hem aanmaken? Je kunt het tijdstip daarna aanpassen bij Automatiseringen.`,
    [{ kind: "create_automation", template: "evening", label: "Automatisering Avondmodus aanmaken" }],
  );
}

function automationIntent(msg: string, ctx: JarvisContext): Partial | null {
  const list = ctx.automations ?? [];
  if (has(msg, "welke automatiser", "mijn automatiser", "automatiseringen")) {
    if (!list.length) return say("automations", "Er zijn nog geen automatiseringen. Zeg bijvoorbeeld \"stel een avondautomatisering voor\".");
    return say("automations", `Automatiseringen: ${list.map((a) => `${a.name}${a.enabled ? "" : " (gepauzeerd)"}`).join(", ")}.`);
  }
  const a = list.find((x) => msg.includes(normalize(x.name)));
  if (!a) return null;
  const toggleDenied = () => say("denied", "Alleen beheerders mogen automatiseringen pauzeren of activeren.");
  if (has(msg, "pauzeer", "stop", "uitschakel") || (has(msg, "zet") && hasWord(msg, "uit"))) {
    if (ctx.canManageAutomations === false) return toggleDenied();
    return say("automation_toggle", `Zal ik "${a.name}" pauzeren?`, [{ kind: "automation_toggle", automationId: a.id, enabled: false, label: `${a.name} pauzeren` }]);
  }
  if (has(msg, "hervat", "activeer", "inschakel") || (has(msg, "zet") && hasWord(msg, "aan"))) {
    if (ctx.canManageAutomations === false) return toggleDenied();
    return say("automation_toggle", `Zal ik "${a.name}" weer activeren?`, [{ kind: "automation_toggle", automationId: a.id, enabled: true, label: `${a.name} activeren` }]);
  }
  if (has(msg, "voer", "start", "draai", "uitvoeren", "nu")) {
    if (ctx.canControl === false) return say("denied", "Je rol mag automatiseringen niet uitvoeren.");
    return say("automation_run", `Zal ik "${a.name}" nu uitvoeren?`, [{ kind: "automation_run", automationId: a.id, label: `${a.name} nu uitvoeren` }]);
  }
  return say("automation_info", `"${a.name}" is ${a.enabled ? "actief" : "gepauzeerd"}. Zeg "voer ${a.name} uit" of "pauzeer ${a.name}".`);
}

function energyIntent(msg: string, ctx: JarvisContext, demo: string, stale: string): Partial | null {
  const e = ctx.energy;
  const aboutEnergy = has(msg, "zon", "opbrengst", "opwek", "productie", "panelen", "verbruik", "energie", "stroom", "teruglever", "kwh");
  if (!aboutEnergy || has(msg, "airco", "stekker") || matchDeviceMention(msg, ctx)) return null;
  if (!e) return say("energy", "Er is geen energiebron gekoppeld, dus ik kan dit niet uitlezen.");
  if (has(msg, "week", "overzicht", "afgelopen dagen")) {
    const week = ctx.energyWeek;
    if (week?.points.length) {
      const total = week.points.reduce((a, p) => a + (p.productionKwh ?? 0), 0);
      const best = week.points.reduce((a, p) => ((p.productionKwh ?? 0) > (a.productionKwh ?? 0) ? p : a));
      const days = week.points.map((p) => `${new Date(p.t).toLocaleDateString("nl-NL", { weekday: "short" })} ${kw(p.productionKwh)}`).join(", ");
      const cons = week.points.every((p) => p.consumptionKwh != null) ? ` Verbruik: ${kw(week.points.reduce((a, p) => a + (p.consumptionKwh ?? 0), 0))}.` : " Verbruik wordt niet gemeten (geen slimme meter).";
      return say("energy_week", `Weekoverzicht opwek: ${kw(total)} in totaal. Beste dag: ${new Date(best.t).toLocaleDateString("nl-NL", { weekday: "long" })} met ${kw(best.productionKwh)}. Per dag: ${days}.${cons}${demo}${stale}`);
    }
    return say("energy_week", `Deze maand tot nu toe: ${kw(e.month.productionKwh)} opgewekt${e.month.consumptionKwh != null ? `, ${kw(e.month.consumptionKwh)} verbruikt` : ""}${demo}. De weekgrafiek staat op de pagina Energie.${stale}`);
  }
  if (has(msg, "verbruik", "teruglever", "net ", "afname")) {
    if (e.currentConsumptionW == null && e.gridImportW == null) return say("energy", `Verbruik en net worden niet gemeten: er is geen slimme meter gekoppeld. De panelen leveren nu ${watt(e.currentProductionW)}${demo}.${stale}`);
    return say("energy", `Nu: ${watt(e.currentConsumptionW)} verbruik, ${e.gridExportW ? `${watt(e.gridExportW)} teruglevering` : `${watt(e.gridImportW)} afname van het net`}. Vandaag: ${kw(e.today.consumptionKwh)} verbruikt${demo}.${stale}`);
  }
  const month = has(msg, "maand") ? ` Deze maand: ${kw(e.month.productionKwh, 0)}.` : "";
  const year = has(msg, "jaar") ? ` Dit jaar: ${kw(e.year.productionKwh, 0)}.` : "";
  return say("solar", `De zonnepanelen leveren nu ${watt(e.currentProductionW)}. Vandaag is er ${kw(e.today.productionKwh)} opgewekt.${month}${year}${demo ? ` ${demo.trim()}` : ""}${stale}`);
}

function matchDeviceMention(msg: string, ctx: JarvisContext): boolean {
  return !!ctx.snapshot && matchDevices(ctx.snapshot, msg, (d) => d.kind !== "solar_inverter" && d.kind !== "energy_meter").length > 0 && has(msg, "verbruik");
}

function climateIntent(msg: string, s: Snapshot, ctx: JarvisContext, demo: string, stale: string): Partial | null {
  const units = s.devices.filter((d) => d.kind === "climate");
  if (!units.length || !has(msg, "airco", "temperatuur", "graden", "warm", "koud", "koel", "verwarm")) return null;
  if (has(msg, "licht")) return null; // "warmer licht" gaat over lampen
  const room = findRoom(s, msg);
  const target = units.length === 1 ? units[0]! : (units.find((u) => room && u.roomId === room.id) ?? matchDevices(s, msg, (d) => d.kind === "climate")[0] ?? null);
  const deg = /(\d{2}(?:\.5)?)\s*(graden|°)?/.exec(msg);
  const wantsChange = has(msg, "zet", "maak", "doe", "stel") || (deg !== null && has(msg, "graden")) || /(^|\s)(aan|uit)$/.test(msg) || has(msg, "warmer", "kouder", "koeler");
  if (!wantsChange) {
    const show = target && (room || units.length === 1) ? [target] : units;
    const lines = show.map((u) => {
      const c = u.state.climate;
      return `${u.name}: binnen ${c?.roomTempC != null ? `${fmtNum(c.roomTempC)} °C` : "onbekend"}${c?.outdoorTempC != null ? `, buiten ${fmtNum(c.outdoorTempC)} °C` : ""}, ${u.state.on === false ? "uit" : `${MODE_NL[c?.mode ?? ""] ?? c?.mode ?? "?"} naar ${c?.targetTempC != null ? `${fmtNum(c.targetTempC)} °C` : "?"}`}`;
    });
    return say("climate_status", `${lines.join(". ")}${demo}.${stale}`, [], target ? { deviceIds: [target.id], roomId: target.roomId } : undefined);
  }
  if (!ctx.connectorOnline) return say("command_blocked", "De connector is offline. Ik kan de airco nu niet bedienen.");
  if (!target) return say("ambiguous", `Welke airco bedoel je? ${units.map((u) => u.name).join(" of ")}.`);
  let command: DeviceCommand | null = null;
  let label = "";
  const current = target.state.climate?.targetTempC;
  if (deg && has(msg, "graden", "op")) {
    const t = Number(deg[1]);
    command = { type: "set_target_temperature", temperatureC: t };
    label = `${target.name} op ${fmtNum(t)} °C`;
  } else if (has(msg, "warmer", "kouder", "koeler") && current != null && !has(msg, "zet de airco op koel")) {
    const t = current + (has(msg, "warmer") ? 1 : -1);
    command = { type: "set_target_temperature", temperatureC: t };
    label = `${target.name} naar ${fmtNum(t)} °C`;
  } else if (/(^|\s)uit($|\s)/.test(msg)) {
    command = { type: "set_power", on: false };
    label = `${target.name} uit`;
  } else if (/(^|\s)aan($|\s)/.test(msg)) {
    command = { type: "set_power", on: true };
    label = `${target.name} aan`;
  } else if (has(msg, "koel")) {
    command = { type: "set_hvac_mode", mode: "cooling" };
    label = `${target.name} op koelen`;
  } else if (has(msg, "verwarm")) {
    command = { type: "set_hvac_mode", mode: "heating" };
    label = `${target.name} op verwarmen`;
  }
  if (!command) return say("unclear_command", `Wat wil je met ${target.name}? Bijvoorbeeld "zet de airco op 21 graden", "airco warmer" of "airco uit".`);
  return propose(s, ctx, [{ device: target, command, label }], { deviceIds: [target.id], roomId: target.roomId });
}

function tvIntent(msg: string, s: Snapshot, ctx: JarvisContext, demo: string, stale: string): Partial | null {
  const tvs = s.devices.filter((d) => d.kind === "media");
  if (!tvs.length) return null;
  const sourcesOf = (d: Device) => d.state.media?.sources ?? [];
  const GENERIC = new Set(["hdmi", "demo", "app", "apps", "ingang"]);
  const sourceMatch = (d: Device) => {
    const hdmi = /hdmi\s*(\d)/.exec(msg);
    if (hdmi) return sourcesOf(d).find((src) => src.id === `input:HDMI_${hdmi[1]}`);
    return sourcesOf(d).find((src) => {
      const label = normalize(src.label).replace(/\(demo\)/, "").trim();
      if (label.length >= 3 && msg.includes(label)) return true;
      // Losse woorden alleen bij namen zonder cijfers, en geen algemene woorden als "hdmi".
      return !/\d/.test(label) && words(src.label).some((w) => w.length >= 4 && !GENERIC.has(w) && hasWord(msg, w));
    });
  };
  const named = matchDevices(s, msg, (d) => d.kind === "media");
  const mentionsTv = hasWord(msg, "tv", "televisie", "tv's") || named.length > 0;
  const memTv = (ctx.memory?.deviceIds ?? []).map((id) => tvs.find((d) => d.id === id)).find(Boolean);
  const viaSource = !mentionsTv && has(msg, "open", "start", "zet", "doe") ? tvs.find((d) => sourceMatch(d)) : undefined;
  const pronounTv = !mentionsTv && memTv && PRONOUNS.some((p) => hasWord(msg, p)) ? memTv : undefined;
  const target = named[0] ?? (mentionsTv ? (tvs.length === 1 ? tvs[0] : (tvs.find((d) => d.roomId === findRoom(s, msg)?.id) ?? tvs[0])) : (viaSource ?? pronounTv));
  if (!target) return null;
  const media = target.state.media;
  const memory: JarvisMemory = { deviceIds: [target.id], roomId: target.roomId };
  const label = (t: string) => `${target.name}: ${t}`;

  const question = (has(msg, "wat", "welke", "staat", "is") && !has(msg, ...COMMAND_VERBS)) || msg.endsWith("?");
  if (question && !has(msg, "zet", "doe")) {
    if (target.status !== "ONLINE") return say("tv_status", `${target.name} staat uit of is niet bereikbaar${demo}.${stale}`, [], memory);
    if (media?.power !== "on") return say("tv_status", `${target.name} staat op stand-by${demo}.${stale}`, [], memory);
    const parts = [media.app ? `staat op ${media.app}` : "staat aan", media.volume !== undefined ? `volume ${media.volume}${media.muted ? " (gedempt)" : ""}` : null];
    return say("tv_status", `${target.name} ${parts.filter(Boolean).join(", ")}${demo}.${stale}`, [], memory);
  }

  const item = (command: DeviceCommand, l: string) => propose(s, ctx, [{ device: target, command, label: label(l) }], memory);
  const src = sourceMatch(target);
  if (src && !/(^|\s)uit$/.test(msg)) return item({ type: "select_source", sourceId: src.id }, `${src.label}`);
  const level = /(?:volume|geluid)?\s*(?:op|naar)\s*(\d{1,3})(?!\s*(%|procent|graden))/.exec(msg);
  if (level && has(msg, "volume", "geluid", "tv", "televisie")) {
    const v = Math.min(100, Number(level[1]));
    return item({ type: "set_volume", volume: v }, `volume ${v}`);
  }
  if (has(msg, "zachter", "harder", "volume omhoog", "volume omlaag", "luider", "stiller")) {
    const up = has(msg, "harder", "omhoog", "luider");
    if (media?.volume !== undefined) {
      const v = Math.max(0, Math.min(100, media.volume + (up ? 5 : -5)));
      return item({ type: "set_volume", volume: v }, `volume ${v}`);
    }
    return item({ type: "volume_step", direction: up ? "up" : "down" }, up ? "harder" : "zachter");
  }
  if (has(msg, "demp", "mute", "geluid uit", "stil")) return item({ type: "set_mute", muted: true }, "dempen");
  if (has(msg, "geluid aan", "unmute", "dempen uit")) return item({ type: "set_mute", muted: false }, "geluid aan");
  if (/(^|\s)uit($|\s)/.test(msg)) {
    if (target.status !== "ONLINE" || media?.power !== "on") return say("noop", `${target.name} staat al uit.`, [], memory);
    return item({ type: "media_power", on: false }, "uit");
  }
  if (/(^|\s)aan($|\s)/.test(msg)) {
    if (target.status === "ONLINE" && media?.power === "on") return say("noop", `${target.name} staat al aan.`, [], memory);
    return item({ type: "media_power", on: true }, "aan");
  }
  if (has(msg, "pauzeer", "pauze")) return item({ type: "media", action: "pause" }, "pauzeren");
  if (has(msg, "speel", "afspelen", "verder")) return item({ type: "media", action: "play" }, "afspelen");
  const names = sourcesOf(target).slice(0, 6).map((x) => x.label);
  return say(
    "unclear_command",
    `Wat wil je met ${target.name}? Bijvoorbeeld "tv zachter", "tv op 20", "demp de tv", "tv uit"${names.length ? ` of een bron: ${names.join(", ")}` : ""}.`,
    [],
    memory,
  );
}

function propose(s: Snapshot, ctx: JarvisContext, items: { device: Device; command: DeviceCommand; label: string }[], memory: JarvisMemory, intro?: string): Partial {
  if (!ctx.connectorOnline) return say("command_blocked", "De connector is offline. Ik kan nu geen opdrachten laten uitvoeren en bewaar ze ook niet om later automatisch uit te voeren.");
  if (s.connector.emergencyStop) return say("command_blocked", "De noodstop is actief. Zolang die aan staat voer ik geen opdrachten uit. Je kunt apparaten wel zelf bedienen.");
  if (ctx.canControl === false) return say("denied", "Je rol mag geen apparaten bedienen.");
  const policy = { source: "jarvis" as const, emergencyStop: s.connector.emergencyStop };
  const ok = items.filter((i) => checkCommand(i.device, i.command, policy).ok);
  const denied = items.filter((i) => !ok.includes(i));
  if (!ok.length) {
    const reason = denied[0] ? checkCommand(denied[0].device, denied[0].command, policy) : null;
    return say("command_denied", `Dat kan ik niet doen: ${reason && !reason.ok ? reason.reason : "niet ondersteund"}`);
  }
  const extra = denied.length ? ` (${denied.map((d) => d.device.name).join(", ")} overgeslagen: niet bereikbaar of niet ondersteund)` : "";
  const text = `${intro ?? ok.map((i) => i.label).join(", ")}${extra}. Bevestig je dit?`;
  return say(
    "command",
    text.charAt(0).toUpperCase() + text.slice(1),
    ok.map((i) => ({ kind: "command" as const, deviceId: i.device.id, deviceName: i.device.name, command: i.command, label: i.label })),
    memory,
  );
}

function commands(msg: string, s: Snapshot, ctx: JarvisContext): Partial {
  // scène
  if (has(msg, "scene", "sfeer", "activeer") || s.scenes.some((x) => msg.includes(normalize(x.name).split(" ")[0]!) && has(msg, "activeer", "zet", "start"))) {
    const scene = s.scenes.find((x) => msg.includes(normalize(x.name))) ?? s.scenes.find((x) => hasWord(msg, normalize(x.name).split(" ")[0]!));
    if (scene) {
      if (!ctx.connectorOnline) return say("command_blocked", "De connector is offline.");
      if (ctx.canControl === false) return say("denied", "Je rol mag geen scènes activeren.");
      if (s.connector.emergencyStop) return say("command_blocked", "De noodstop is actief.");
      return say("scene", `Wil je scène "${scene.name}" activeren?`, [{ kind: "scene", sceneId: scene.id, sceneName: scene.name, label: `Scène ${scene.name} activeren` }]);
    }
    if (has(msg, "scene", "sfeer") && s.scenes.length) return say("scene", `Welke scène bedoel je? Beschikbaar: ${s.scenes.map((x) => x.name).join(", ")}.`);
  }

  const on = /(^|\s)aan($|\s)/.test(msg) ? true : /(^|\s)uit($|\s)/.test(msg) ? false : null;
  const pct = /(\d{1,3})\s?(%|procent)/.exec(msg);
  const room = findRoom(s, msg);
  const lights = s.devices.filter((d) => d.kind === "light" && (!room || d.roomId === room.id));
  const memDevices = (ctx.memory?.deviceIds ?? []).map((id) => s.devices.find((d) => d.id === id)).filter((d): d is Device => !!d);

  // Doel bepalen: expliciet apparaat > "ze/die" uit het geheugen > alle lampen (in kamer).
  let targets: Device[] = matchDevices(s, msg, (d) => d.capabilities.includes("onoff") || d.capabilities.includes("brightness"));
  const pronoun = PRONOUNS.some((p) => hasWord(msg, p)) && !targets.length;
  const groupWord = has(msg, "lampen", "verlichting", "licht") || hasWord(msg, "alle");
  if (!targets.length && pronoun && memDevices.length) targets = memDevices;
  if (!targets.length && (groupWord || (room && (on !== null || pct || has(msg, "feller", "lichter", "donkerder", "dim"))))) targets = lights;
  if (targets.length > 1 && !groupWord && !pronoun && !room) {
    return say("ambiguous", `Bedoel je ${targets.map((d) => `${d.name}${roomName(s, d.roomId) ? ` (${roomName(s, d.roomId)})` : ""}`).join(" of ")}?`);
  }
  if (!targets.length) {
    const names = suggestNames(s, msg);
    return say("unknown_device", `Ik weet niet welk apparaat je bedoelt.${names.length ? ` Bedoel je ${names.join(" of ")}?` : ' Noem de naam zoals die in HomeOS staat, bijvoorbeeld "zet de staande lamp aan".'}`);
  }
  const memory: JarvisMemory = { deviceIds: targets.map((d) => d.id), roomId: room?.id ?? null };
  const where = room ? ` in ${room.name}` : "";

  // kleur
  const colorName = Object.keys(COLORS).find((c) => hasWord(msg, c));
  if (colorName && !has(msg, "warm licht", "warmer licht")) {
    const items = targets.map((d) => ({ device: d, command: { type: "set_color", colorHex: COLORS[colorName]! } as DeviceCommand, label: `${d.name} ${colorName}` }));
    return propose(s, ctx, items, memory);
  }
  // warm/koel wit
  if (has(msg, "warm licht", "warmer licht", "warmwit", "koel licht", "koeler licht", "daglicht")) {
    const k = has(msg, "warm") ? 2700 : has(msg, "daglicht") ? 5500 : 4500;
    const items = targets.map((d) => ({ device: d, command: { type: "set_color_temperature", colorTempK: k } as DeviceCommand, label: `${d.name} ${k <= 3000 ? "warm wit" : "koel wit"}` }));
    return propose(s, ctx, items, memory);
  }
  // percentage
  if (pct) {
    const b = Math.min(100, Math.max(1, Number(pct[1])));
    const items = targets.map((d) => ({ device: d, command: { type: "set_brightness", brightness: b } as DeviceCommand, label: `${d.name} op ${b}%` }));
    return propose(s, ctx, items, memory, targets.length > 2 ? `${targets.length} lampen${where} op ${b}%` : undefined);
  }
  // feller / donkerder
  if (has(msg, "feller", "lichter", "helderder", "donkerder", "dimmen", "dim ")) {
    const up = has(msg, "feller", "lichter", "helderder");
    const items = targets
      .filter((d) => d.capabilities.includes("brightness"))
      .map((d) => {
        const cur = d.state.on ? (d.state.brightness ?? 100) : 0;
        const b = Math.min(100, Math.max(1, cur + (up ? 25 : -25)));
        return { device: d, command: { type: "set_brightness", brightness: b } as DeviceCommand, label: `${d.name} naar ${b}%` };
      });
    if (!items.length) return say("unsupported", "Deze lamp(en) kunnen niet gedimd worden.");
    return propose(s, ctx, items, memory);
  }
  // aan/uit
  if (on !== null) {
    const relevant = targets.length > 1 ? targets.filter((d) => d.state.on !== on || d.status !== "ONLINE") : targets;
    if (!relevant.length) return say("noop", `${targets.length > 1 ? `Alle lampen${where} staan` : `${targets[0]!.name} staat`} al ${on ? "aan" : "uit"}.`, [], memory);
    const items = relevant.map((d) => ({ device: d, command: { type: "set_power", on } as DeviceCommand, label: `${d.name} ${on ? "aan" : "uit"}` }));
    return propose(s, ctx, items, memory, items.length > 2 ? `${items.length} lampen${where} ${on ? "aan" : "uit"}: ${items.map((i) => i.device.name).join(", ")}` : undefined);
  }
  return say("unclear_command", `Wat wil je met ${targets.length === 1 ? targets[0]!.name : `de lampen${where}`} doen? Bijvoorbeeld aan, uit, feller, 30% of een kleur.`, [], memory);
}
