import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

const IDLE_W: Record<string, number> = { koffie: 0.8, wasmachine: 1.2, "tv-meubel": 4.5 };
const ACTIVE_W: Record<string, [number, number]> = { koffie: [900, 1300], wasmachine: [180, 2100], "tv-meubel": [60, 110] };

/** DEMO slimme stekkers met energiemeting. */
export class DemoPlugAdapter extends DemoAdapterBase {
  readonly id = "demo-plugs";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo slimme stekkers";
  protected override tickMs = 4_000;

  protected seed(): DemoDevice[] {
    const caps = ["onoff", "power_metering"] as const;
    return [
      demoDevice({ externalId: "koffie", name: "Koffiemachine", model: "Demo stekker met meting", kind: "plug", capabilities: [...caps], suggestedRoomId: "keuken" }, { on: true, powerW: 0.8, energyTodayKwh: 0.21 }),
      demoDevice({ externalId: "wasmachine", name: "Wasmachine", model: "Demo stekker met meting", kind: "plug", capabilities: [...caps], suggestedRoomId: "badkamer" }, { on: true, powerW: 640, energyTodayKwh: 0.94 }),
      demoDevice({ externalId: "tv-meubel", name: "TV-meubel", model: "Demo stekker met meting", kind: "plug", capabilities: [...caps], suggestedRoomId: "woonkamer" }, { on: true, powerW: 86, energyTodayKwh: 0.38 }),
    ];
  }

  protected apply(d: DemoDevice, c: DeviceCommand): void {
    if (c.type === "set_power") {
      d.state.on = c.on;
      d.state.powerW = c.on ? (IDLE_W[d.info.externalId] ?? 1) : 0;
    }
  }

  protected override tick(): void {
    for (const d of this.devices.values()) {
      if (d.status !== "ONLINE" || !d.state.on) continue;
      const id = d.info.externalId;
      const [lo, hi] = ACTIVE_W[id] ?? [1, 2];
      const idle = IDLE_W[id] ?? 1;
      const busy = id === "tv-meubel" ? true : Math.random() < (id === "wasmachine" ? 0.7 : 0.08);
      d.state.powerW = Math.round((busy ? lo + Math.random() * (hi - lo) : idle) * 10) / 10;
      d.state.energyTodayKwh = Math.round(((d.state.energyTodayKwh ?? 0) + (d.state.powerW * this.tickMs) / 3_600_000_000) * 1000) / 1000;
      this.push(d);
    }
  }
}
