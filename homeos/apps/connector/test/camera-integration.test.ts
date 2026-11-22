import { execFileSync } from "node:child_process";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestConnector } from "./helpers";
import { fakeOnvifCamera } from "../../../packages/integrations/test/fake-onvif";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Leest de eerste bytes van een multipart-stream en breekt dan af (zoals een browser die wegklikt). */
function readStream(base: string, p: string, token: string, bytes = 4000): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(base + p, { headers: { authorization: `Bearer ${token}` } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        chunks.push(c);
        size += c.length;
        if (size >= bytes) {
          req.destroy();
          resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body: Buffer.concat(chunks) });
        }
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body: Buffer.concat(chunks) }));
    });
    req.on("error", (e) => (e.message.includes("aborted") || (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e)));
  });
}

describe("Tapo-camera's in de connector", () => {
  it.skipIf(!hasFfmpeg)("voegt toe met camera-account, toont beeld en verwijdert; wachtwoord nooit leesbaar", async () => {
    const cam = fakeOnvifCamera();
    t = await startTestConnector({ demo: false }, undefined, undefined, undefined, {
      fetchImpl: cam.fetchImpl,
      ffmpegPath: "ffmpeg",
      inputFor: () => ({ args: ["-re", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10"] }),
    });
    const post = (body: unknown) => t!.call("/v1/integrations/tapo", { method: "POST", body: JSON.stringify(body) });
    expect((await post({ host: "8.8.8.8", username: "homeos", password: "x" })).status).toBe(400);
    const wrong = await post({ host: "192.168.68.40", username: "homeos", password: "fout" });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.message).toContain("camera-account");

    const ok = await post({ host: "192.168.68.40", username: "homeos", password: "camera-wachtwoord", name: "Tuin" });
    expect(ok.status).toBe(200);
    const okBody = await ok.text();
    expect(okBody).not.toContain("camera-wachtwoord");

    const list = await (await t.call("/v1/cameras")).json();
    expect(list.cameras[0]).toMatchObject({ name: "Tuin", model: "C500" });
    const deviceId: string = list.cameras[0].deviceId;
    const snap = await t.call("/v1/snapshot").then((r) => r.json());
    expect(snap.devices.find((d: { id: string }) => d.id === deviceId)).toMatchObject({ kind: "camera", status: "ONLINE" });

    const files = await Promise.all(["secrets.enc", "integrations.json", "registry.json"].map((f) => readFile(path.join(t!.dataDir, f), "utf8").catch(() => "")));
    expect(files.join("")).not.toContain("camera-wachtwoord");

    const img = await t.call(`/v1/cameras/${encodeURIComponent(deviceId)}/snapshot`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    const bytes = Buffer.from(await img.arrayBuffer());
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const live = await readStream(t.base, `/v1/cameras/${encodeURIComponent(deviceId)}/stream`, t.token);
    expect(live.status).toBe(200);
    expect(live.type).toContain("multipart/x-mixed-replace");
    expect(live.body.toString("latin1")).toContain("Content-Type: image/jpeg");

    expect((await t.call(`/v1/cameras/${encodeURIComponent("demo-lights:spots")}/snapshot`)).status).toBe(404);
    // Jarvis/automatiseringen mogen de camera niet bewegen.
    const ptz = await t.call(`/v1/devices/${encodeURIComponent(deviceId)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "ptz_move", direction: "left" }, source: "jarvis" }) });
    expect(ptz.status).toBe(403);
    const userPtz = await t.call(`/v1/devices/${encodeURIComponent(deviceId)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "ptz_move", direction: "left" }, source: "user" }) });
    expect(userPtz.status).toBe(200);

    expect((await t.call(`/v1/integrations/tapo/${list.cameras[0].cameraId}`, { method: "DELETE" })).status).toBe(200);
    expect((await t.call(`/v1/cameras/${encodeURIComponent(deviceId)}/snapshot`)).status).toBe(404);
  }, 30_000);
});
