import { createServer, type Http2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  GoogleHomeAdapter,
  assistantLanguage,
  commandText,
  createHttp2AssistantTransport,
  decodeAssistResponse,
  decodeFields,
  encodeAssistRequest,
  frame,
  googleAuthorizeUrl,
  unframe,
  type AssistantTransport,
} from "../src/googlehome/index";
import type { AdapterContext } from "../src/adapter";

const logger = { info() {}, warn() {}, error() {} };

function ctxWith(secrets: Record<string, string>, cache: { v: unknown } = { v: null }): AdapterContext {
  return {
    logger,
    now: () => new Date(),
    emit() {},
    serverless: true,
    secrets: {
      get: async (k) => secrets[k] ?? null,
      set: async (k, v) => void (secrets[k] = v),
      delete: async (k) => void delete secrets[k],
    },
    cache: { load: async () => cache.v, save: async (v) => void (cache.v = v) },
  };
}

/** AssistResponse met dialog_state_out.supplemental_display_text. */
function response(text: string): Buffer {
  const t = Buffer.from(text, "utf8");
  const inner = Buffer.concat([Buffer.from([0x0a, t.length]), t]);
  return Buffer.concat([Buffer.from([0x2a, inner.length]), inner]);
}

describe("Google Assistant SDK: protobuf en gRPC-kaders", () => {
  it("codeert een tekstopdracht volgens embedded_assistant.proto (dialog_state_in=3, device_config=4)", () => {
    const msg = encodeAssistRequest("zet GRILLPLATS aan", "nl-NL");
    const [config] = decodeFields(msg);
    expect(config!.field).toBe(1);
    const fields = decodeFields(config!.value as Buffer);
    const byField = new Map(fields.map((f) => [f.field, f.value]));
    expect((byField.get(6) as Buffer).toString()).toBe("zet GRILLPLATS aan");
    const dialog = decodeFields(byField.get(3) as Buffer);
    expect((dialog.find((f) => f.field === 2)!.value as Buffer).toString()).toBe("nl-NL");
    expect(dialog.find((f) => f.field === 7)!.value).toBe(1);
    const audio = decodeFields(byField.get(2) as Buffer);
    expect(audio.find((f) => f.field === 1)!.value).toBe(2);
    expect(audio.find((f) => f.field === 2)!.value).toBe(24000);
    const device = decodeFields(byField.get(4) as Buffer);
    expect(device.map((f) => f.field)).toEqual([1, 3]);
    expect(device.map((f) => (f.value as Buffer).toString())).toEqual(["default", "default"]);
  });

  it("codeert lange en niet-ASCII tekst correct (varint-lengtes)", () => {
    const long = "zet " + "é".repeat(100) + " aan";
    const [config] = decodeFields(encodeAssistRequest(long, "nl-NL"));
    const text = decodeFields(config!.value as Buffer).find((f) => f.field === 6)!.value as Buffer;
    expect(text.toString("utf8")).toBe(long);
  });

  it("leest de antwoordtekst en splitst gRPC-kaders", () => {
    expect(decodeAssistResponse(response("Oké, GRILLPLATS staat aan")).text).toBe("Oké, GRILLPLATS staat aan");
    expect(decodeAssistResponse(Buffer.from([0x08, 0x01])).text).toBeNull();
    const both = Buffer.concat([frame(Buffer.from("a")), frame(Buffer.from("bc"))]);
    expect(unframe(both).map((b) => b.toString())).toEqual(["a", "bc"]);
    expect(() => decodeFields(Buffer.from([0x0a, 0x05, 0x01]))).toThrow();
  });

  it("bouwt de Google-inlog-URL met offline toegang en de juiste scope", () => {
    const u = new URL(googleAuthorizeUrl("cid.apps.googleusercontent.com", "https://x.vercel.app/api/integrations/googlehome/callback", "st"));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/assistant-sdk-prototype");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("formuleert opdrachten in het Nederlands", () => {
    expect(commandText("GRILLPLATS", true, "nl-NL")).toBe("zet GRILLPLATS aan");
    expect(commandText("GRILLPLATS", false, "nl-NL")).toBe("zet GRILLPLATS uit");
    expect(commandText("Lamp", true, "en-US")).toBe("turn on Lamp");
    expect(commandText("Lampe", false, "de-DE")).toBe("schalte Lampe aus");
  });

  it("valt terug op Engels voor talen die Google Assistent niet ondersteunt (zoals nl-NL)", () => {
    expect(assistantLanguage("nl-NL")).toBe("en-US");
    expect(assistantLanguage("de-DE")).toBe("de-DE");
  });
});

describe("Google Assistant SDK: HTTP/2-transport (lokale nep-server)", () => {
  let server: Http2Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function fake(handler: (headers: Record<string, unknown>, body: Buffer) => { status: number; message?: string; reply?: Buffer }) {
    server = createServer();
    server.on("stream", (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const r = handler(headers as Record<string, unknown>, Buffer.concat(chunks));
        stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": String(r.status), ...(r.message ? { "grpc-message": encodeURIComponent(r.message) } : {}) }));
        stream.end(r.reply ? frame(r.reply) : undefined);
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("stuurt een gRPC-aanvraag met token en leest het antwoord", async () => {
    let seen: { path?: unknown; auth?: unknown; text?: string } = {};
    const origin = await fake((h, body) => {
      const [msg] = unframe(body);
      const [config] = decodeFields(msg!);
      seen = { path: h[":path"], auth: h.authorization, text: (decodeFields(config!.value as Buffer).find((f) => f.field === 6)!.value as Buffer).toString() };
      return { status: 0, reply: response("Oké") };
    });
    const r = await createHttp2AssistantTransport(origin, 5000)("tok-1", "zet GRILLPLATS aan", "nl-NL");
    expect(r.text).toBe("Oké");
    expect(seen).toEqual({ path: "/google.assistant.embedded.v1alpha2.EmbeddedAssistant/Assist", auth: "Bearer tok-1", text: "zet GRILLPLATS aan" });
  });

  it("vertaalt gRPC-fouten naar duidelijke meldingen", async () => {
    const origin = await fake(() => ({ status: 16, message: "bad token" }));
    await expect(createHttp2AssistantTransport(origin, 5000)("x", "zet a aan", "nl-NL")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("meldt een onbereikbare server als niet beschikbaar", async () => {
    await expect(createHttp2AssistantTransport("http://127.0.0.1:1", 2000)("x", "zet a aan", "nl-NL")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("GoogleHomeAdapter", () => {
  const config = { clientId: "cid.apps.googleusercontent.com", languageCode: "nl-NL", devices: [{ id: "0123456789abcdef", name: "GRILLPLATS" }] };

  it("is niet geconfigureerd zonder aanmelding", async () => {
    const a = new GoogleHomeAdapter(config, fetch, async () => ({ text: null }));
    await a.connect(ctxWith({}));
    expect((await a.healthCheck()).status).toBe("not_configured");
    expect((await a.getStatus("0123456789abcdef")).status).toBe("UNKNOWN");
    expect(await a.executeCommand("0123456789abcdef", { type: "set_power", on: true })).toMatchObject({ ok: false, code: "DEVICE_UNAVAILABLE" });
  });

  it("stuurt aan/uit als tekst, meldt nooit een gegokte toestand en vernieuwt verlopen tokens", async () => {
    const sent: { token: string; text: string }[] = [];
    const transport: AssistantTransport = async (token, text) => {
      sent.push({ token, text });
      return { text: "Oké" };
    };
    const refreshes: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      refreshes.push(String(init.body));
      return new Response(JSON.stringify({ access_token: "nieuw", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const secrets: Record<string, string> = { clientSecret: "geheim", tokens: JSON.stringify({ accessToken: "oud", refreshToken: "ref", expiresAt: 0 }) };
    const a = new GoogleHomeAdapter(config, fakeFetch, transport);
    await a.connect(ctxWith(secrets));
    expect(await a.discover()).toMatchObject([{ externalId: "0123456789abcdef", name: "GRILLPLATS", kind: "plug", capabilities: ["onoff"] }]);

    const r = await a.executeCommand("0123456789abcdef", { type: "set_power", on: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.status).toBe("ONLINE");
      expect(r.report.state.on).toBeUndefined();
    }
    expect(sent).toEqual([{ token: "nieuw", text: "turn on GRILLPLATS" }]);
    expect(refreshes[0]).toContain("grant_type=refresh_token");
    expect(JSON.parse(secrets.tokens!)).toMatchObject({ accessToken: "nieuw", refreshToken: "ref" });

    await a.executeCommand("0123456789abcdef", { type: "set_power", on: false });
    expect(sent[1]).toEqual({ token: "nieuw", text: "turn off GRILLPLATS" });
    expect(refreshes).toHaveLength(1);
    expect(await a.executeCommand("0123456789abcdef", { type: "set_brightness", brightness: 50 })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(await a.executeCommand("onbekend", { type: "set_power", on: true })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("geeft Google-fouten door en bewaart de daglimiet tussen aanvragen", async () => {
    const secrets: Record<string, string> = { clientSecret: "geheim", tokens: JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }) };
    const cache = { v: null as unknown };
    const failing: AssistantTransport = async () => {
      const { GoogleAssistantError } = await import("../src/googlehome/assistant");
      throw new GoogleAssistantError("Google weigert de aanmelding (opnieuw koppelen?)", "UNAUTHORIZED");
    };
    const a = new GoogleHomeAdapter(config, fetch, failing);
    await a.connect(ctxWith(secrets, cache));
    expect(await a.executeCommand("0123456789abcdef", { type: "set_power", on: true })).toMatchObject({ ok: false, code: "DEVICE_UNAVAILABLE" });
    expect((await a.healthCheck()).status).toBe("degraded");

    // Nieuwe aanvraag (serverless): budget en fout zijn bewaard.
    let calls = 0;
    const b = new GoogleHomeAdapter(config, fetch, async () => ((calls += 1), { text: null }));
    await b.connect(ctxWith(secrets, cache));
    expect((await b.healthCheck()).status).toBe("degraded");
    expect(b.budget.used()).toBe(1);
    for (let i = 0; i < 449; i++) await b.executeCommand("0123456789abcdef", { type: "set_power", on: true });
    expect(calls).toBe(449);
    expect(await b.executeCommand("0123456789abcdef", { type: "set_power", on: true })).toMatchObject({ ok: false, message: expect.stringContaining("Daglimiet") });
  });
});
