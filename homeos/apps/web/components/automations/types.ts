import type { Device, Scene } from "@homeos/shared";
import type { Action, AutomationInput, AutomationRun, Condition, Trigger } from "@homeos/automation";

export type { Action, AutomationInput, AutomationRun, Condition, Trigger };
export type Automation = AutomationInput & { id: string; createdAt: string; updatedAt: string; running?: boolean };

const DAY = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const PROP: Record<string, string> = { on: "aan/uit", powerW: "vermogen (W)", productionW: "opwek (W)", roomTempC: "kamertemperatuur (°C)", brightness: "helderheid (%)" };
const METRIC: Record<string, string> = { productionW: "zonne-opwek", consumptionW: "verbruik", gridImportW: "netafname", gridExportW: "teruglevering" };
const OP: Record<string, string> = { eq: "is", gt: "hoger dan", lt: "lager dan" };

export function describeTrigger(t: Trigger, devices: Device[]): string {
  const dev = (id: string) => (id === "*" ? "een willekeurig apparaat" : (devices.find((d) => d.id === id)?.name ?? "onbekend apparaat"));
  switch (t.type) {
    case "time":
      return `Om ${t.at}${t.days.length ? ` op ${t.days.map((d) => DAY[d]).join(", ")}` : " (elke dag)"}`;
    case "device_state":
      return `Als ${dev(t.deviceId)}: ${PROP[t.property]} ${OP[t.op]} ${String(t.value)}`;
    case "energy":
      return `Als ${METRIC[t.metric]} ${OP[t.op]} ${t.value} W`;
    case "device_offline":
      return `Als ${dev(t.deviceId)} ${t.forMinutes} min offline is`;
    case "manual":
      return "Alleen handmatig";
  }
}

export function describeAction(a: Action, devices: Device[], scenes: Scene[]): string {
  switch (a.type) {
    case "scene":
      return `Scène “${scenes.find((s) => s.id === a.sceneId)?.name ?? "onbekend"}”`;
    case "device_command": {
      const n = devices.find((d) => d.id === a.deviceId)?.name ?? "apparaat";
      const c = a.command;
      if (c.type === "set_power") return `${n} ${c.on ? "aan" : "uit"}`;
      if (c.type === "set_brightness") return `${n} op ${c.brightness}%`;
      if (c.type === "set_target_temperature") return `${n} op ${c.temperatureC} °C`;
      if (c.type === "set_hvac_mode") return `${n} modus ${c.mode}`;
      return `${n}: ${c.type}`;
    }
    case "notify":
      return `Melding “${a.title}”`;
    case "report":
      return a.kind === "evening" ? "Jarvis: avondoverzicht" : "Jarvis: energieoverzicht";
    case "delay":
      return `${a.minutes} min wachten`;
  }
}

export function describeCondition(c: Condition, devices: Device[]): string {
  const dev = (id: string) => devices.find((d) => d.id === id)?.name ?? "onbekend apparaat";
  switch (c.type) {
    case "time_between":
      return `tussen ${c.from} en ${c.to}`;
    case "weekday":
      return `op ${c.days.map((d) => DAY[d]).join(", ")}`;
    case "device_online":
      return `${dev(c.deviceId)} is online`;
    case "device_state":
      return `${dev(c.deviceId)}: ${PROP[c.property]} ${OP[c.op]} ${String(c.value)}`;
    case "energy":
      return `${METRIC[c.metric]} ${OP[c.op]} ${c.value} W`;
  }
}
