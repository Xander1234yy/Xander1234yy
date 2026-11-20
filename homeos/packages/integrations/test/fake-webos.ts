import https from "node:https";
import selfsigned from "selfsigned";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Nagebootste LG webOS-tv voor tests (SSAP over wss met een zelfondertekend certificaat).
 * Alleen voor tests; praat nooit met een echte tv.
 */
export class FakeWebOsTv {
  server: https.Server | null = null;
  wss: WebSocketServer | null = null;
  port = 0;
  clientKey = "fake-client-key-123";
  /** Wat de "gebruiker" op de tv doet bij een koppelvraag. */
  promptAnswer: "accept" | "reject" | "ignore" = "accept";
  rejectSigned = false;
  power = "Active";
  /** Uit: nieuwe verbindingen worden geweigerd (een echte tv is dan onbereikbaar). */
  off = false;
  volume = 12;
  muted = false;
  foreground = "com.webos.app.hdmi1";
  received: { uri?: string; type: string; payload?: unknown }[] = [];
  private sockets = new Set<WebSocket>();
  private subs: { ws: WebSocket; id: string; uri: string }[] = [];

  async start() {
    const pems = await selfsigned.generate([{ name: "commonName", value: "LG webOS TV" }], { keySize: 2048 });
    this.server = https.createServer({ key: pems.private, cert: pems.cert });
    this.wss = new WebSocketServer({ server: this.server, verifyClient: () => !this.off });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.port = (this.server.address() as { port: number }).port;
  }

  async stop() {
    for (const s of this.sockets) s.terminate();
    await new Promise<void>((r) => this.wss?.close(() => r()) ?? r());
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r());
  }

  /** Tv gaat uit: verbindingen vallen weg. */
  powerOff() {
    this.off = true;
    for (const s of this.sockets) s.terminate();
    this.sockets.clear();
    this.subs = [];
  }

  private state(uri: string): Record<string, unknown> {
    switch (uri) {
      case "com.webos.service.tvpower/power/getPowerState":
        return { returnValue: true, state: this.power };
      case "audio/getVolume":
        return { returnValue: true, volumeStatus: { volume: this.volume, muteStatus: this.muted } };
      case "com.webos.applicationManager/getForegroundAppInfo":
        return { returnValue: true, appId: this.foreground };
      default:
        return { returnValue: true };
    }
  }

  private push(uri: string) {
    for (const s of this.subs.filter((x) => x.uri === uri)) s.ws.send(JSON.stringify({ type: "response", id: s.id, payload: this.state(uri) }));
  }

  private onConnection(ws: WebSocket) {
    this.sockets.add(ws);
    ws.on("close", () => this.sockets.delete(ws));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as { id: string; type: string; uri?: string; payload?: Record<string, unknown> };
      const uri = m.uri?.replace("ssap://", "");
      this.received.push({ type: m.type, uri, payload: m.payload });
      const reply = (o: unknown) => ws.send(JSON.stringify(o));
      if (m.type === "register") {
        const manifest = m.payload?.manifest as Record<string, unknown>;
        if (this.rejectSigned && manifest.signatures) return reply({ type: "error", id: m.id, error: "500 Application error" });
        if (m.payload?.["client-key"] === this.clientKey) return reply({ type: "registered", id: m.id, payload: { "client-key": this.clientKey } });
        reply({ type: "response", id: m.id, payload: { pairingType: "PROMPT", returnValue: true } });
        if (this.promptAnswer === "accept") setTimeout(() => reply({ type: "registered", id: m.id, payload: { "client-key": this.clientKey } }), 20);
        if (this.promptAnswer === "reject") setTimeout(() => reply({ type: "error", id: m.id, error: "403 User denied access" }), 20);
        return;
      }
      if (!uri) return;
      if (m.type === "subscribe") this.subs.push({ ws, id: m.id, uri });
      switch (uri) {
        case "system/getSystemInfo":
          return reply({ type: "response", id: m.id, payload: { returnValue: true, modelName: "OLED48CX6LB" } });
        case "com.webos.service.connectionmanager/getinfo":
          return reply({ type: "response", id: m.id, payload: { returnValue: true, wifiInfo: { macAddress: "AA:BB:CC:DD:EE:FF" }, wiredInfo: {} } });
        case "tv/getExternalInputList":
          return reply({ type: "response", id: m.id, payload: { returnValue: true, devices: [
            { id: "HDMI_1", label: "HDMI 1", appId: "com.webos.app.hdmi1" },
            { id: "HDMI_2", label: "PlayStation", appId: "com.webos.app.hdmi2" },
            { id: "../evil", label: "x", appId: "y" },
          ] } });
        case "com.webos.applicationManager/listLaunchPoints":
          return reply({ type: "response", id: m.id, payload: { returnValue: true, launchPoints: [
            { id: "netflix", title: "Netflix" },
            { id: "youtube.leanback.v4", title: "YouTube" },
            { id: "com.webos.app.hdmi1", title: "HDMI 1" },
          ] } });
        case "audio/setVolume":
          this.volume = Number(m.payload?.volume);
          reply({ type: "response", id: m.id, payload: { returnValue: true } });
          return this.push("audio/getVolume");
        case "audio/volumeUp":
          this.volume = Math.min(100, this.volume + 1);
          reply({ type: "response", id: m.id, payload: { returnValue: true } });
          return this.push("audio/getVolume");
        case "audio/setMute":
          this.muted = !!m.payload?.mute;
          reply({ type: "response", id: m.id, payload: { returnValue: true } });
          return this.push("audio/getVolume");
        case "tv/switchInput":
          this.foreground = `com.webos.app.${String(m.payload?.inputId).toLowerCase().replace("_", "")}`;
          reply({ type: "response", id: m.id, payload: { returnValue: true } });
          return this.push("com.webos.applicationManager/getForegroundAppInfo");
        case "system.launcher/launch":
          this.foreground = String(m.payload?.id);
          reply({ type: "response", id: m.id, payload: { returnValue: true } });
          return this.push("com.webos.applicationManager/getForegroundAppInfo");
        case "system/turnOff":
          this.power = "Suspend";
          this.push("com.webos.service.tvpower/power/getPowerState");
          return setTimeout(() => this.powerOff(), 20);
        default:
          return reply({ type: "response", id: m.id, payload: this.state(uri) });
      }
    });
  }
}
