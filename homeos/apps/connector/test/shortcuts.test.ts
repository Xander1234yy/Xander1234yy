import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";

const PREFIX = "db://55555555-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));
const config: ConnectorConfig = { host: "127.0.0.1", port: 0, dataDir: PREFIX, demo: false, masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890", pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false, serverless: true };

describe("Apple-opdrachten (knoppen)", () => {
  it("bewaart knoppen, valideert namen en weigert stuurtekens", async () => {
    registerStorage(PREFIX, memoryStorage());
    for (const step of [0, 1]) {
      const c = await createConnector(config, silent, []);
      const addr = await c.start();
      const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
      try {
        if (step === 0) {
          const put = (items: unknown) => call("/v1/integrations/shortcuts", { method: "PUT", body: JSON.stringify({ items }) });
          expect((await put([{ label: "TV aan", shortcut: "" }])).status).toBe(400);
          expect((await put([{ label: "TV\u0000aan", shortcut: "TV aan" }])).status).toBe(400);
          expect((await put([{ label: "x".repeat(41), shortcut: "TV aan" }])).status).toBe(400);
          const ok = await put([{ label: " TV  aan ", shortcut: "TV aan & HDMI 1" }, { label: "", shortcut: "" }, { label: "TV uit", shortcut: "TV uit" }]);
          expect(ok.status).toBe(200);
        } else {
          // Volgende aanvraag (serverless): knoppen zijn bewaard.
          const list = await (await call("/v1/integrations")).json();
          expect(list.shortcuts.map((s: { label: string; shortcut: string }) => [s.label, s.shortcut])).toEqual([
            ["TV aan", "TV aan & HDMI 1"],
            ["TV uit", "TV uit"],
          ]);
          expect(list.shortcuts[0].id).toMatch(/^[0-9a-f]{12}$/);
        }
      } finally {
        await c.flush();
        await c.stop();
      }
    }
  });
});
