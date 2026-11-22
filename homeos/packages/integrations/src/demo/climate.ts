import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

/** DEMO-airco met hetzelfde gedrag als een cloud-airco (modus, setpoint, temperaturen). */
export class DemoClimateAdapter extends DemoAdapterBase {
  readonly id = "demo-climate";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo-airco";
  protected override tickMs = 30_000;

  protected seed(): DemoDevice[] {
    return [
      demoDevice(
        { externalId: "woonkamer-airco", name: "Airco woonkamer", model: "Demo split-unit", kind: "climate", capabilities: ["onoff", "climate"], suggestedRoomId: "woonkamer" },
        {
          on: true,
          climate: { mode: "heating", modes: ["auto", "cooling", "heating", "dry", "fanOnly"], targetTempC: 21, minTempC: 10, maxTempC: 30, stepC: 0.5, roomTempC: 19.5, outdoorTempC: 7 },
        },
      ),
    ];
  }

  protected apply(d: DemoDevice, c: DeviceCommand): void {
    const cl = d.state.climate!;
    if (c.type === "set_power") d.state.on = c.on;
    if (c.type === "set_hvac_mode") {
      cl.mode = c.mode;
      const hasSetpoint = c.mode === "cooling" || c.mode === "heating" || c.mode === "auto";
      cl.targetTempC = hasSetpoint ? (c.mode === "cooling" ? 24 : 21) : null;
    }
    if (c.type === "set_target_temperature" && cl.targetTempC != null) cl.targetTempC = Math.min(cl.maxTempC ?? 30, Math.max(cl.minTempC ?? 10, c.temperatureC));
  }

  protected override tick(): void {
    for (const d of this.devices.values()) {
      const cl = d.state.climate;
      if (!cl || cl.roomTempC == null) continue;
      const goal = d.state.on && cl.targetTempC != null ? cl.targetTempC : (cl.outdoorTempC ?? 15) + 8;
      cl.roomTempC = Math.round((cl.roomTempC + Math.sign(goal - cl.roomTempC) * Math.min(0.5, Math.abs(goal - cl.roomTempC))) * 10) / 10;
      this.push(d);
    }
  }
}
