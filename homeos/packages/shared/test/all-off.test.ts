import { describe, expect, it } from "vitest";
import { allOffCommands } from "../src/commands";

const d = (id: string, kind: string, status: string, capabilities: string[], state: Record<string, unknown>) =>
  ({ id, kind, status, capabilities, state }) as Parameters<typeof allOffCommands>[0][number];

describe("Alles uit", () => {
  it("zet aan-staande en onbekende apparaten uit, slaat uit/offline/veiligheidskritisch over", () => {
    const r = allOffCommands([
      d("lamp-aan", "light", "ONLINE", ["onoff", "brightness"], { on: true }),
      d("lamp-uit", "light", "ONLINE", ["onoff"], { on: false }),
      d("google", "plug", "ONLINE", ["onoff"], {}),
      d("offline", "plug", "OFFLINE", ["onoff"], { on: true }),
      d("airco", "climate", "ONLINE", ["onoff", "climate"], { on: true }),
      d("tv", "media", "ONLINE", ["media_power"], { media: { power: "on", playback: "idle" } }),
      d("tv-stand-by", "media", "ONLINE", ["media_power"], { media: { power: "standby", playback: "idle" } }),
      d("camera", "camera", "ONLINE", ["onoff"], { on: true }),
      d("bridge", "bridge", "ONLINE", ["onoff"], { on: true }),
    ]);
    expect(r).toEqual([
      { deviceId: "lamp-aan", command: { type: "set_power", on: false } },
      { deviceId: "google", command: { type: "set_power", on: false } },
      { deviceId: "airco", command: { type: "set_power", on: false } },
      { deviceId: "tv", command: { type: "media_power", on: false } },
    ]);
  });
});
