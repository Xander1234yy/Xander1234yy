import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

interface DemoScene {
  id: string;
  name: string;
  roomId: string | null;
  states: Record<string, { on: boolean; brightness?: number; colorHex?: string; colorTempK?: number }>;
}

/** DEMO-verlichting met hetzelfde gedrag als een lampensysteem met scènes (zoals later Philips Hue). */
export class DemoLightsAdapter extends DemoAdapterBase {
  readonly id = "demo-lights";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo-verlichting";

  private readonly scenes: DemoScene[] = [
    {
      id: "avond",
      name: "Avond",
      roomId: null,
      states: {
        "woonkamer-plafond": { on: true, brightness: 45, colorHex: "#ffb36b" },
        "woonkamer-staand": { on: true, brightness: 60, colorTempK: 2700 },
        "keuken-spots": { on: true, brightness: 35 },
      },
    },
    {
      id: "helder",
      name: "Helder",
      roomId: null,
      states: {
        "woonkamer-plafond": { on: true, brightness: 100, colorHex: "#fff4e5" },
        "woonkamer-staand": { on: true, brightness: 100, colorTempK: 4500 },
        "keuken-spots": { on: true, brightness: 100 },
      },
    },
    {
      id: "film",
      name: "Film",
      roomId: "woonkamer",
      states: {
        "woonkamer-plafond": { on: true, brightness: 10, colorHex: "#3a5bff" },
        "woonkamer-staand": { on: false },
      },
    },
    {
      id: "nacht",
      name: "Nacht",
      roomId: null,
      states: {
        "woonkamer-plafond": { on: false },
        "woonkamer-staand": { on: false },
        "keuken-spots": { on: false },
        "badkamer-spiegel": { on: false },
        "slaapkamer-nachtlamp": { on: true, brightness: 8, colorHex: "#ff8a3d" },
      },
    },
  ];

  protected seed(): DemoDevice[] {
    const color = ["onoff", "brightness", "color"] as const;
    return [
      demoDevice(
        { externalId: "woonkamer-plafond", name: "Plafondlamp", model: "Demo kleurenlamp", kind: "light", capabilities: [...color], suggestedRoomId: "woonkamer" },
        { on: true, brightness: 70, colorHex: "#ffd8a8" },
      ),
      demoDevice(
        { externalId: "woonkamer-staand", name: "Staande lamp", model: "Demo wit-spectrum", kind: "light", capabilities: ["onoff", "brightness", "color_temperature"], suggestedRoomId: "woonkamer" },
        { on: true, brightness: 55, colorTempK: 2700 },
      ),
      demoDevice(
        { externalId: "keuken-spots", name: "Spots", model: "Demo dimbaar", kind: "light", capabilities: ["onoff", "brightness"], suggestedRoomId: "keuken" },
        { on: false, brightness: 80 },
      ),
      demoDevice(
        { externalId: "slaapkamer-nachtlamp", name: "Nachtlamp", model: "Demo kleurenlamp", kind: "light", capabilities: [...color], suggestedRoomId: "slaapkamer" },
        { on: false, brightness: 20, colorHex: "#ff8a3d" },
      ),
      demoDevice(
        { externalId: "badkamer-spiegel", name: "Spiegellamp", model: "Demo dimbaar", kind: "light", capabilities: ["onoff", "brightness"], suggestedRoomId: "badkamer" },
        { on: false, brightness: 100 },
      ),
      demoDevice(
        { externalId: "tuin-wandlamp", name: "Wandlamp tuin", model: "Demo buitenlamp", kind: "light", capabilities: ["onoff"], suggestedRoomId: "overig" },
        { on: false },
        "OFFLINE",
        "DEMO: apparaat bewust offline om de offline-weergave te tonen",
      ),
    ];
  }

  protected apply(d: DemoDevice, c: DeviceCommand): void {
    switch (c.type) {
      case "set_power":
        d.state.on = c.on;
        break;
      case "set_brightness":
        d.state.brightness = c.brightness;
        d.state.on = true;
        break;
      case "set_color":
        d.state.colorHex = c.colorHex.toLowerCase();
        d.state.on = true;
        break;
      case "set_color_temperature":
        d.state.colorTempK = c.colorTempK;
        d.state.on = true;
        break;
      default:
        break;
    }
  }

  async getScenes() {
    return this.scenes.map(({ id, name, roomId }) => ({ id, name, roomId }));
  }

  async activateScene(sceneId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const scene = this.scenes.find((s) => s.id === sceneId);
    if (!scene) return { ok: false, message: "Onbekende scène" };
    for (const [externalId, target] of Object.entries(scene.states)) {
      const d = this.devices.get(externalId);
      if (!d || d.status !== "ONLINE") continue;
      d.state.on = target.on;
      if (target.brightness !== undefined && d.info.capabilities.includes("brightness")) d.state.brightness = target.brightness;
      if (target.colorHex && d.info.capabilities.includes("color")) d.state.colorHex = target.colorHex;
      if (target.colorTempK && d.info.capabilities.includes("color_temperature")) d.state.colorTempK = target.colorTempK;
      this.push(d);
    }
    return { ok: true };
  }
}
