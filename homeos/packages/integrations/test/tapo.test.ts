import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterContext, AdapterEvent } from "../src/adapter";
import { JpegSplitter, MjpegStream, OnvifClient, TapoCameraAdapter, parseEvents, redact } from "../src/tapo/index";
import { fakeOnvifCamera } from "./fake-onvif";

const cfg = { cameraId: "0123456789abcdef", host: "192.168.68.40", name: "Tuin C500", model: "C500" };
function ctx(events: AdapterEvent[], creds: Record<string, string | null> = { username: "homeos", password: "camera-wachtwoord" }): AdapterContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: (e) => events.push(e),
    secrets: { get: async (k) => creds[k] ?? null, set: async () => undefined, delete: async () => undefined },
  };
}
const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};
let adapter: TapoCameraAdapter | null = null;
afterEach(async () => {
  await adapter?.disconnect();
  adapter = null;
});

describe("ONVIF", () => {
  it("parseert beweging en personen, negeert andere gebeurtenissen", () => {
    const cam = fakeOnvifCamera();
    const xml = cam.motion() + cam.motion("tns1:RuleEngine/PeopleDetector/People", "IsPeople") + cam.motion(undefined, "IsMotion", "false") + cam.motion("tns1:Device/Trigger/Relay", "LogicalState");
    expect(parseEvents(xml)).toEqual([
      { topic: "tns1:RuleEngine/CellMotionDetector/Motion", kind: "motion", active: true },
      { topic: "tns1:RuleEngine/PeopleDetector/People", kind: "person", active: true },
      { topic: "tns1:RuleEngine/CellMotionDetector/Motion", kind: "motion", active: false },
    ]);
  });

  it("logt in met een wachtwoord-digest (wachtwoord niet leesbaar) en weigert een verkeerd wachtwoord", async () => {
    const cam = fakeOnvifCamera();
    const sent: string[] = [];
    const spy = (async (u: string | URL, i?: RequestInit) => (sent.push(String(i?.body)), cam.fetchImpl(u, i))) as typeof fetch;
    const ok = new OnvifClient({ host: cfg.host, username: "homeos", password: "camera-wachtwoord", fetchImpl: spy });
    expect(await ok.deviceInformation()).toMatchObject({ manufacturer: "tp-link", model: "C500" });
    expect(sent.join("")).not.toContain("camera-wachtwoord");
    const bad = new OnvifClient({ host: cfg.host, username: "homeos", password: "fout", fetchImpl: cam.fetchImpl });
    await expect(bad.deviceInformation()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("volgt geen adressen naar een andere host", async () => {
    const cam = fakeOnvifCamera({ otherHostXAddr: true });
    const c = new OnvifClient({ host: cfg.host, username: "homeos", password: "camera-wachtwoord", fetchImpl: cam.fetchImpl });
    const caps = await c.capabilities();
    expect(caps.media).toBe("http://192.168.68.40:2020/onvif/service");
    await c.profile();
    expect(cam.state.urls.every((u) => u.startsWith("http://192.168.68.40:2020/"))).toBe(true);
  });
});

describe("Tapo-camera-adapter", () => {
  it("online, met draaien/kantelen en bewegingsmeldingen (met afkoeltijd)", async () => {
    const cam = fakeOnvifCamera();
    const events: AdapterEvent[] = [];
    adapter = new TapoCameraAdapter(cfg, { fetchImpl: cam.fetchImpl, eventsRetryMs: 20, pullTimeoutSec: 1 });
    await adapter.connect(ctx(events));
    expect((await adapter.getStatus("camera")).status).toBe("ONLINE");
    expect(adapter.getCapabilities("camera")).toEqual(["camera_stream", "motion", "ptz"]);
    const [dev] = await adapter.discover();
    expect(dev).toMatchObject({ kind: "camera", brand: "TP-Link Tapo" });

    cam.state.pendingEvents.push(cam.motion(), cam.motion());
    await until(() => events.some((e) => e.type === "device_event"));
    cam.state.pendingEvents.push(cam.motion("tns1:RuleEngine/PeopleDetector/People", "IsPeople"));
    await until(() => cam.state.pendingEvents.length === 0);
    await new Promise((r) => setTimeout(r, 50));
    const motions = events.filter((e) => e.type === "device_event");
    expect(motions).toHaveLength(1); // afkoeltijd: niet iedere melding opnieuw
    expect(motions[0]).toMatchObject({ event: { type: "motion", message: "Beweging bij Tuin C500" } });
    expect((await adapter.getStatus("camera")).state.lastMotionAt).toBeTruthy();

    const r = await adapter.executeCommand("camera", { type: "ptz_move", direction: "left" });
    expect(r.ok).toBe(true);
    expect(cam.state.ptzMoves).toEqual(["-0.5,0", "stop"]);
    expect((await adapter.executeCommand("camera", { type: "set_power", on: true })).ok).toBe(false);
  });

  it("RTSP-adres bevat de inloggegevens alleen binnen de connector, met codering", async () => {
    const cam = fakeOnvifCamera({ password: "p@ss:w/rd" });
    adapter = new TapoCameraAdapter(cfg, { fetchImpl: cam.fetchImpl });
    await adapter.connect(ctx([], { username: "homeos", password: "p@ss:w/rd" }));
    expect(adapter.rtspUrl("low")).toBe("rtsp://homeos:p%40ss%3Aw%2Frd@192.168.68.40:554/stream2");
    expect(adapter.rtspUrl("high")).toContain("/stream1");
    const health = await adapter.healthCheck();
    expect(JSON.stringify(health)).not.toContain("p@ss");
  });

  it("verkeerd wachtwoord → foutstatus met uitleg; onbereikbaar → offline; zonder account niet geconfigureerd", async () => {
    const cam = fakeOnvifCamera();
    adapter = new TapoCameraAdapter(cfg, { fetchImpl: cam.fetchImpl, eventsRetryMs: 20 });
    await adapter.connect(ctx([], { username: "homeos", password: "fout" }));
    const s = await adapter.getStatus("camera");
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("camera-account");
    await adapter.disconnect();

    cam.state.reachable = false;
    adapter = new TapoCameraAdapter(cfg, { fetchImpl: cam.fetchImpl, eventsRetryMs: 20 });
    await adapter.connect(ctx([]));
    expect((await adapter.getStatus("camera")).status).toBe("OFFLINE");
    await adapter.disconnect();

    adapter = new TapoCameraAdapter(cfg, { fetchImpl: cam.fetchImpl });
    await adapter.connect(ctx([], {}));
    expect((await adapter.healthCheck()).status).toBe("not_configured");
  });
});

describe("MJPEG", () => {
  it("haalt JPEG-beelden uit een bytestroom, ook over chunk-grenzen", () => {
    const frames: Buffer[] = [];
    const s = new JpegSplitter();
    const a = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const b = Buffer.from([0xff, 0xd8, 9, 0xff, 0xd9]);
    const all = Buffer.concat([Buffer.from([7, 7]), a, b]);
    s.push(all.subarray(0, 6), (f) => frames.push(f));
    s.push(all.subarray(6), (f) => frames.push(f));
    expect(frames).toEqual([a, b]);
  });

  it("verwijdert inloggegevens uit ffmpeg-meldingen", () => {
    expect(redact("rtsp://homeos:geheim@192.168.68.40:554/stream2: 401 Unauthorized")).toBe("rtsp://***@192.168.68.40:554/stream2: 401 Unauthorized");
  });

  const hasFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasFfmpeg)("maakt live beelden en een momentopname met ffmpeg (testbeeld, geen camera)", async () => {
    const stream = new MjpegStream({ ffmpegPath: "ffmpeg", input: async () => ({ args: ["-re", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10"] }), idleStopMs: 50 });
    const frames: Buffer[] = [];
    const unsub = stream.subscribe((f) => f.length && frames.push(f));
    await until(() => frames.length >= 2, 10_000);
    expect(frames[0]![0]).toBe(0xff);
    expect(frames[0]![1]).toBe(0xd8);
    unsub();
    await until(() => !stream.running, 5000);
    const snap = await new MjpegStream({ ffmpegPath: "ffmpeg", input: async () => ({ args: ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=1"] }) }).snapshot();
    expect(snap.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  }, 20_000);

  it("meldt duidelijk als ffmpeg ontbreekt", async () => {
    const stream = new MjpegStream({ ffmpegPath: "/bestaat/niet/ffmpeg", input: async () => ({ args: ["-i", "x"] }) });
    await expect(stream.snapshot()).rejects.toThrow(/brew install ffmpeg/);
  });
});
