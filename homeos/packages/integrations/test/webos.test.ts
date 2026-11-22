import { afterEach, describe, expect, it } from "vitest";
import { checkCommand, type Device } from "@homeos/shared";
import type { AdapterContext, AdapterEvent } from "../src/adapter";
import { WebOsAdapter, broadcastTargets, buildSources, magicPacket, pairTv, parseMac, parseSsdpResponse, registrationMessage } from "../src/webos/index";
import { FakeWebOsTv } from "./fake-webos";

const anyHost = () => true;
let tv: FakeWebOsTv | null = null;
afterEach(async () => {
  await tv?.stop();
  tv = null;
});

function ctx(events: AdapterEvent[] = [], key: string | null = "fake-client-key-123"): AdapterContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: (e) => events.push(e),
    secrets: { get: async () => key, set: async () => undefined, delete: async () => undefined },
  };
}

describe("webOS-protocol", () => {
  it("registratie: ondertekend LG-manifest, zonder handtekening als terugval, client-key alleen als die er is", () => {
    const signed = registrationMessage(null);
    expect(signed.payload.pairingType).toBe("PROMPT");
    expect(signed.payload).not.toHaveProperty("client-key");
    expect((signed.payload.manifest as { signed: { vendorId: string } }).signed.vendorId).toBe("com.lge");
    const unsigned = registrationMessage("k", false);
    expect(unsigned.payload["client-key"]).toBe("k");
    expect(unsigned.payload.manifest).not.toHaveProperty("signatures");
    expect(unsigned.payload.manifest.permissions as string[]).toContain("CONTROL_POWER");
  });

  it("bronnen: ingangen + apps, zonder dubbele of vreemde id's", () => {
    const s = buildSources(
      [{ id: "HDMI_1", label: "HDMI 1", appId: "com.webos.app.hdmi1" }, { id: "../x", label: "x" }, { id: 5 }],
      [{ id: "netflix", title: "Netflix" }, { id: "com.webos.app.hdmi1", title: "HDMI 1" }, { id: "a b", title: "Kapot" }],
    );
    expect(s.map((x) => x.id)).toEqual(["input:HDMI_1", "app:netflix"]);
  });

  it("MAC, Wake-on-LAN-pakket en broadcastadres", () => {
    expect(parseMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(parseMac("niet-een-mac")).toBeNull();
    const p = magicPacket("aa:bb:cc:dd:ee:ff");
    expect(p.length).toBe(102);
    expect(p.subarray(0, 6).every((b) => b === 0xff)).toBe(true);
    expect(p.subarray(96).toString("hex")).toBe("aabbccddeeff");
    expect(() => magicPacket("xx")).toThrow();
    expect(broadcastTargets("192.168.68.20")).toEqual(["192.168.68.255", "255.255.255.255"]);
  });

  it("SSDP: alleen webOS-tv's op het lokale netwerk", () => {
    const ok = "HTTP/1.1 200 OK\r\nLOCATION: http://192.168.68.20:1858/\r\nST: urn:lge-com:service:webos-second-screen:1\r\nDLNADeviceName.lge.com: %5BLG%5D%20webOS%20TV\r\n\r\n";
    expect(parseSsdpResponse(ok, "192.168.68.20")).toEqual({ host: "192.168.68.20", name: "[LG] webOS TV" });
    expect(parseSsdpResponse(ok.replace("192.168.68.20:1858", "8.8.8.8:1858"), "8.8.8.8")).toBeNull();
    expect(parseSsdpResponse("HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n", "192.168.1.2")).toBeNull();
  });

  it("aanzetten via het netwerk mag alleen als de tv uit (offline) is en Wake-on-LAN kan", () => {
    const tvDev = { name: "TV", kind: "media", status: "OFFLINE", capabilities: ["media_power", "volume", "wake_on_lan"] } as Pick<Device, "capabilities" | "status" | "kind" | "name">;
    const opts = { source: "user" as const, emergencyStop: false };
    expect(checkCommand(tvDev, { type: "media_power", on: true }, opts).ok).toBe(true);
    expect(checkCommand(tvDev, { type: "set_volume", volume: 10 }, opts).ok).toBe(false);
    expect(checkCommand({ ...tvDev, capabilities: ["media_power"] }, { type: "media_power", on: true }, opts).ok).toBe(false);
    expect(checkCommand({ ...tvDev, status: "ERROR" }, { type: "media_power", on: true }, opts).ok).toBe(false);
  });
});

describe("LG-tv koppelen", () => {
  it("koppelt na bevestiging op de tv en leest model en MAC uit", async () => {
    tv = new FakeWebOsTv();
    await tv.start();
    const r = await pairTv("127.0.0.1", { hostCheck: anyHost, ports: { wssPort: tv.port } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clientKey).toBe("fake-client-key-123");
    expect(r.tv).toMatchObject({ model: "OLED48CX6LB", mac: "aa:bb:cc:dd:ee:ff", scheme: "wss" });
    expect(r.tv.fingerprint256).toMatch(/^[0-9A-F:]+$/);
  }, 30_000);

  it("weigert openbare adressen, meldt een geweigerde of genegeerde koppeling", async () => {
    expect((await pairTv("8.8.8.8")).ok).toBe(false);
    tv = new FakeWebOsTv();
    await tv.start();
    tv.promptAnswer = "reject";
    const rejected = await pairTv("127.0.0.1", { hostCheck: anyHost, ports: { wssPort: tv.port } });
    expect(rejected).toMatchObject({ ok: false, code: "REJECTED" });
    tv.promptAnswer = "ignore";
    const ignored = await pairTv("127.0.0.1", { hostCheck: anyHost, ports: { wssPort: tv.port }, promptTimeoutMs: 200 });
    expect(ignored).toMatchObject({ ok: false, code: "TIMEOUT" });
  }, 30_000);

  it("valt terug op het manifest zonder handtekening als de firmware dat eist", async () => {
    tv = new FakeWebOsTv();
    await tv.start();
    tv.rejectSigned = true;
    const r = await pairTv("127.0.0.1", { hostCheck: anyHost, ports: { wssPort: tv.port } });
    expect(r.ok).toBe(true);
  }, 30_000);
});

describe("LG-tv adapter", () => {
  async function setup(overrides: Partial<ConstructorParameters<typeof WebOsAdapter>[0]> = {}) {
    tv = new FakeWebOsTv();
    await tv.start();
    const paired = await pairTv("127.0.0.1", { hostCheck: anyHost, ports: { wssPort: tv.port } });
    if (!paired.ok) throw new Error(paired.message);
    const woken: string[] = [];
    const events: AdapterEvent[] = [];
    const a = new WebOsAdapter({ ...paired.tv, ...overrides }, { ports: { wssPort: tv.port }, wol: async (mac) => void woken.push(mac), reconnectMs: 50 });
    await a.connect(ctx(events));
    return { a, events, woken, fake: tv };
  }

  it("is online met volume, ingangen en apps; bediening wordt teruggelezen", async () => {
    const { a, fake } = await setup();
    const s = await a.getStatus("tv");
    expect(s.status).toBe("ONLINE");
    expect(s.state.media).toMatchObject({ power: "on", volume: 12, muted: false, source: "input:HDMI_1", app: "HDMI 1" });
    expect(s.state.media?.sources?.map((x) => x.id)).toEqual(["input:HDMI_1", "input:HDMI_2", "app:netflix", "app:youtube.leanback.v4"]);
    expect(a.getCapabilities("tv")).toContain("wake_on_lan");

    const vol = await a.executeCommand("tv", { type: "set_volume", volume: 20 });
    expect(vol.ok && vol.report.state.media?.volume).toBe(20);
    const mute = await a.executeCommand("tv", { type: "set_mute", muted: true });
    expect(mute.ok && mute.report.state.media?.muted).toBe(true);
    const input = await a.executeCommand("tv", { type: "select_source", sourceId: "input:HDMI_2" });
    expect(input.ok && input.report.state.media?.app).toBe("PlayStation");
    const app = await a.executeCommand("tv", { type: "select_source", sourceId: "app:netflix" });
    expect(app.ok && app.report.state.media?.app).toBe("Netflix");
    expect(fake.received.some((m) => m.uri === "tv/switchInput" && (m.payload as { inputId: string }).inputId === "HDMI_2")).toBe(true);
    expect((await a.executeCommand("tv", { type: "select_source", sourceId: "app:onbekend" })).ok).toBe(false);
    expect((await a.executeCommand("tv", { type: "media", action: "next" })).ok).toBe(false);

    // Afstandsbediening via de invoer-socket (op hetzelfde apparaat, ook als de tv een ander adres noemt).
    for (const b of ["DOWN", "ENTER", "BACK"] as const) expect((await a.executeCommand("tv", { type: "remote_button", button: b })).ok).toBe(true);
    expect(fake.buttons).toEqual(["DOWN", "ENTER", "BACK"]);
    const ch = await a.executeCommand("tv", { type: "remote_button", button: "CHANNELUP" });
    expect(ch.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect((await a.getStatus("tv")).state.media).toMatchObject({ app: "Live tv", title: "1 NPO 1" });
    expect(a.getCapabilities("tv")).toContain("remote_control");
    await a.disconnect();
  }, 30_000);

  it("uitzetten → offline; aanzetten stuurt Wake-on-LAN zonder te doen alsof hij al aan is", async () => {
    const { a, woken } = await setup();
    await a.executeCommand("tv", { type: "media_power", on: false });
    await new Promise((r) => setTimeout(r, 100));
    const off = await a.getStatus("tv");
    expect(off.status).toBe("OFFLINE");
    expect(off.state.media?.power).toBe("standby");
    const on = await a.executeCommand("tv", { type: "media_power", on: true });
    expect(woken).toEqual(["aa:bb:cc:dd:ee:ff"]);
    expect(on.ok && on.report.state.media?.power).toBe("standby");
    await a.disconnect();
  }, 30_000);

  it("zonder MAC-adres: aanzetten niet mogelijk en geen wake_on_lan", async () => {
    const { a } = await setup({ mac: null });
    expect(a.getCapabilities("tv")).not.toContain("wake_on_lan");
    await a.executeCommand("tv", { type: "media_power", on: false });
    await new Promise((r) => setTimeout(r, 100));
    expect((await a.executeCommand("tv", { type: "media_power", on: true })).ok).toBe(false);
    await a.disconnect();
  }, 30_000);

  it("ander certificaat: geen client-key verstuurd, foutstatus", async () => {
    const { a, fake } = await setup();
    await a.disconnect();
    const before = fake.received.filter((m) => m.type === "register").length;
    const events: AdapterEvent[] = [];
    const evil = new WebOsAdapter({ ...a.config, fingerprint256: "00:11:22" }, { ports: { wssPort: fake.port } });
    await evil.connect(ctx(events));
    expect(fake.received.filter((m) => m.type === "register").length).toBe(before);
    const s = await evil.getStatus("tv");
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("certificaat");
    await evil.disconnect();
  }, 30_000);

  it("geweigerde key: foutmelding om opnieuw te koppelen, geen nieuwe koppelvraag", async () => {
    const { a, fake } = await setup();
    await a.disconnect();
    fake.clientKey = "andere-key";
    const b = new WebOsAdapter(a.config, { ports: { wssPort: fake.port } });
    await b.connect(ctx([], "fake-client-key-123"));
    const s = await b.getStatus("tv");
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("opnieuw");
    await b.disconnect();
  }, 30_000);
});
