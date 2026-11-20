import type { DeviceCommand } from "@homeos/shared";
import type { DeviceAdapter } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";

const SOURCES = [
  { id: "input:HDMI_1", label: "HDMI 1 (DEMO)", type: "input" as const },
  { id: "input:HDMI_2", label: "Spelcomputer (DEMO)", type: "input" as const },
  { id: "app:demo.video", label: "Demo Video", type: "app" as const },
  { id: "app:demo.music", label: "Demo Muziek", type: "app" as const },
];

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
  private channel = 1;
  /** Laatst ingedrukte knop (alleen voor tests). */
  lastButton: string | null = null;

  protected seed(): DemoDevice[] {
    return [
      demoDevice(
        { externalId: "woonkamer-tv", name: "Woonkamer TV", model: "Demo mediaspeler", kind: "media", capabilities: ["media_playback", "media_power", "volume", "source_select", "remote_control"], suggestedRoomId: "woonkamer" },
        { media: { power: "on", playback: "paused", ...QUEUE[0]!, volume: 15, muted: false, source: "app:demo.music", sources: SOURCES } },
      ),
    ];
  }

  protected apply(d: DemoDevice, c: DeviceCommand): void {
    const media = d.state.media ?? { power: "on" as const, playback: "idle" as const };
    if (c.type === "media_power") {
      d.state.media = c.on ? { ...media, power: "on" } : { ...media, power: "standby", playback: "idle" };
      return;
    }
    if (c.type === "set_volume") media.volume = c.volume;
    if (c.type === "volume_step") media.volume = Math.max(0, Math.min(100, (media.volume ?? 0) + (c.direction === "up" ? 1 : -1)));
    if (c.type === "set_mute") media.muted = c.muted;
    if (c.type === "select_source") {
      const src = SOURCES.find((s) => s.id === c.sourceId);
      if (src) {
        media.source = src.id;
        media.app = src.label;
        media.title = src.type === "input" ? undefined : media.title;
        media.artist = src.type === "input" ? undefined : media.artist;
      }
    }
    if (c.type === "remote_button") {
      this.lastButton = c.button;
      if (c.button === "CHANNELUP" || c.button === "CHANNELDOWN") {
        this.channel = Math.max(1, this.channel + (c.button === "CHANNELUP" ? 1 : -1));
        media.title = `Zender ${this.channel} (DEMO)`;
        media.artist = undefined;
      }
    }
    if (c.type === "set_volume" || c.type === "volume_step" || c.type === "set_mute" || c.type === "select_source" || c.type === "remote_button") {
      d.state.media = { ...media };
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
