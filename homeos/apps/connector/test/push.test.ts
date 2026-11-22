import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PushSender } from "../src/push-service";
import { startTestConnector } from "./helpers";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });

describe("pushmeldingen", () => {
  it("abonneert alleen bekende pushdiensten, stuurt meldingen met de juiste pagina en ruimt verlopen abonnementen op", async () => {
    const sent: { endpoint: string; payload: Record<string, string>; urgency: string; subject: string }[] = [];
    const gone = new Set<string>();
    const sender: PushSender = async (s, payload, opts) => {
      if (gone.has(s.endpoint)) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), urgency: opts.urgency, subject: opts.vapid.subject });
      expect(opts.vapid.privateKey.length).toBeGreaterThan(20);
      return { statusCode: 201 };
    };
    t = await startTestConnector({}, undefined, undefined, undefined, undefined, sender);
    const info = await (await t.call("/v1/push")).json();
    expect(info.publicKey).toMatch(/^[\w-]{80,}$/);
    expect(info.subscriptions).toBe(0);

    const post = (p: string, body: unknown) => t!.call(`/v1/push/${p}`, { method: "POST", body: JSON.stringify(body) });
    expect((await post("subscriptions", { subscription: sub("https://evil.example/push/1"), label: "x" })).status).toBe(400);
    expect((await post("subscriptions", { subscription: sub("http://web.push.apple.com/abc"), label: "x" })).status).toBe(400);
    const iphone = "https://web.push.apple.com/QGuQyavXutnMH8PqdsA6Ixw";
    const chrome = "https://fcm.googleapis.com/fcm/send/abc123";
    expect((await post("subscriptions", { subscription: sub(iphone), label: "iPhone" })).status).toBe(200);
    expect((await post("subscriptions", { subscription: sub(chrome), label: "MacBook" })).status).toBe(200);

    const test = await (await post("test", { endpoint: iphone })).json();
    expect(test).toEqual({ delivered: 1, removed: 0 });
    expect(sent[0]).toMatchObject({ endpoint: iphone, payload: { title: "HomeOS", tag: "test" } });

    // Een HomeOS-melding (DEMO-deurbel) → push naar beide apparaten, met hoge urgentie en de beveiligingspagina.
    sent.length = 0;
    gone.add(chrome);
    t.c.automations.events.emit("notification", { id: "n1", at: new Date().toISOString(), category: "security", title: "Er wordt aangebeld", body: "Voordeur", read: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([expect.objectContaining({ endpoint: iphone, urgency: "high", payload: expect.objectContaining({ url: "/beveiliging", title: "Er wordt aangebeld" }) })]);
    expect((await (await t.call("/v1/push")).json()).subscriptions).toBe(1); // verlopen Chrome-abonnement opgeruimd

    // Melding over een deurbel/camera → aantikken opent het live beeld van dat apparaat.
    sent.length = 0;
    t.c.automations.events.emit("notification", { id: "n2", at: new Date().toISOString(), category: "security", title: "Er wordt aangebeld", body: "Voordeur", read: false, deviceId: "tapocloud:ABC123DEF456" });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent[0]!.payload).toMatchObject({ url: "/beveiliging?live=tapocloud%3AABC123DEF456", tag: "security:tapocloud:ABC123DEF456" });

    // Sleutels en abonnementen staan niet leesbaar op schijf.
    const files = await Promise.all(["secrets.enc", "integrations.json"].map((f) => readFile(path.join(t!.dataDir, f), "utf8").catch(() => "")));
    expect(files.join("")).not.toContain("web.push.apple.com");

    expect((await post("unsubscribe", { endpoint: iphone })).status).toBe(200);
    expect((await post("test", {})).status).toBe(404);
  });
});
