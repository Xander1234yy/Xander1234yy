import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

/** DEMO-deurbel: genereert af en toe een belmelding of beweging. Geen camerabeelden. */
export class DemoDoorbellAdapter extends DemoAdapterBase {
  readonly id = "demo-doorbell";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo-deurbel";
  protected override tickMs = 60_000;

  protected seed(): DemoDevice[] {
    const now = Date.now();
    return [
      demoDevice(
        { externalId: "voordeur", name: "Deurbel voordeur", model: "Demo videodeurbel", kind: "doorbell", capabilities: ["doorbell", "motion", "battery"], suggestedRoomId: "overig" },
        {
          batteryPct: 82,
          lastRingAt: new Date(now - 3 * 3600_000).toISOString(),
          lastMotionAt: new Date(now - 25 * 60_000).toISOString(),
        },
      ),
    ];
  }

  protected apply(_d: DemoDevice, _c: DeviceCommand): void {
    // Deurbel accepteert geen opdrachten.
  }

  /** Alleen voor demo en tests: forceer een gebeurtenis. */
  simulate(kind: "doorbell_ring" | "motion"): void {
    const d = this.devices.get("voordeur");
    if (!d || !this.ctx) return;
    const at = this.nowIso();
    if (kind === "doorbell_ring") d.state.lastRingAt = at;
    else d.state.lastMotionAt = at;
    this.push(d);
    this.ctx.emit({
      type: "device_event",
      externalId: "voordeur",
      event: { type: kind, at, message: kind === "doorbell_ring" ? "Er is aangebeld bij de voordeur" : "Beweging bij de voordeur" },
    });
  }

  protected override tick(): void {
    const r = Math.random();
    if (r < 0.04) this.simulate("doorbell_ring");
    else if (r < 0.15) this.simulate("motion");
  }
}
