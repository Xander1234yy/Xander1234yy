import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

const QUEUE = [
  { app: "Demo Muziek", title: "Nachtelijke stad", artist: "Demo Artiest" },
  { app: "Demo Muziek", title: "Rustige haven", artist: "Demo Artiest" },
  { app: "Demo Video", title: "Natuurdocumentaire (DEMO)" },
];

/** DEMO mediaspeler die het gedrag van een Apple TV nabootst. Geen echte Apple-protocollen. */
export class DemoMediaAdapter extends DemoAdapterBase {
  readonly id = "demo-media";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo mediaspeler";
  private index = 0;

  protected seed(): DemoDevice[] {
    return [
      demoDevice(
        { externalId: "woonkamer-tv", name: "Woonkamer TV", model: "Demo mediaspeler", kind: "media", capabilities: ["media_playback", "media_power"], suggestedRoomId: "woonkamer" },
        { media: { power: "on", playback: "paused", ...QUEUE[0]! } },
      ),
    ];
  }

  protected apply(d: DemoDevice, c: DeviceCommand): void {
    const media = d.state.media ?? { power: "on" as const, playback: "idle" as const };
    if (c.type === "media_power") {
      d.state.media = c.on ? { ...media, power: "on" } : { power: "standby", playback: "idle" };
      return;
    }
    if (c.type !== "media") return;
    if (media.power !== "on") media.power = "on";
    if (c.action === "play") media.playback = "playing";
    if (c.action === "pause") media.playback = "paused";
    if (c.action === "next" || c.action === "previous") {
      this.index = (this.index + (c.action === "next" ? 1 : QUEUE.length - 1)) % QUEUE.length;
      const item = QUEUE[this.index]!;
      d.state.media = { power: "on", playback: "playing", app: item.app, title: item.title, artist: item.artist };
      return;
    }
    d.state.media = media;
  }
}
