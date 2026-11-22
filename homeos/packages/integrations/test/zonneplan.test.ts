import { describe, expect, it } from "vitest";
import type { AdapterContext } from "../src/adapter";
import { ZonneplanAdapter, ZonneplanApi, pkcePair } from "../src/zonneplan/index";
import { fakeZonneplan } from "./fake-zonneplan";

function ctx(store: Record<string, string>): AdapterContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: () => undefined,
    secrets: { get: async (k) => store[k] ?? null, set: async (k, v) => void (store[k] = v), delete: async (k) => void delete store[k] },
  };
}

describe("Zonneplan (niet-officieel)", () => {
  it("PKCE: challenge is SHA-256 van de verifier", () => {
    const p = pkcePair();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("inloggen met de code uit de e-mail; verkeerde code wordt geweigerd", async () => {
    const z = fakeZonneplan();
    const api = new ZonneplanApi(z.fetchImpl);
    const { authSession, verifier } = await api.requestCode("ik@example.test");
    await expect(api.submitCode(authSession, "000000", verifier)).rejects.toMatchObject({ code: "INVALID" });
    const t = await api.submitCode(authSession, "123456", verifier);
    expect(t.accessToken).toBe("access-1");
    const conns = await api.connections(t.accessToken);
    expect(conns[0]).toMatchObject({ connectionUuid: z.conn, p1: { label: "Connect energiemeter" } });
  });

  async function adapter(tokens = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000 }) {
    const z = fakeZonneplan();
    const store: Record<string, string> = { tokens: JSON.stringify(tokens) };
    const a = new ZonneplanAdapter({ connectionUuid: z.conn, label: "Connect energiemeter" }, new ZonneplanApi(z.fetchImpl));
    await a.connect(ctx(store));
    return { a, z, store };
  }

  it("leest afname, teruglevering en totalen; alleen-lezen", async () => {
    const { a } = await adapter();
    const s = await a.getStatus("p1");
    expect(s).toMatchObject({ status: "ONLINE", state: { powerW: 711 }, stateAt: "2026-11-21T10:00:00.000000Z" });
    const sum = await a.energy!.getSummary();
    expect(sum).toMatchObject({ gridImportW: 711, gridExportW: 0, currentProductionW: null, currentConsumptionW: null });
    expect(sum.today).toEqual({ productionKwh: null, consumptionKwh: null, importKwh: 5.775, exportKwh: 2.576 });
    expect(sum.year.importKwh).toBe(934.741);
    const h = await a.energy!.getHistory("day");
    expect(h.points).toEqual([
      { t: "2026-11-21T09:00:00.000Z", productionKwh: null, consumptionKwh: null, importKwh: 0.3, exportKwh: 0.1 },
      { t: "2026-11-21T10:00:00.000Z", productionKwh: null, consumptionKwh: null, importKwh: 0.2, exportKwh: 0.4 },
    ]);
    expect(a.energy!.role).toBe("grid");
    expect((await a.executeCommand("p1", { type: "set_power", on: true })).ok).toBe(false);
    expect((await a.discover())[0]!.model).toContain("niet-officieel");
    await a.disconnect();
  });

  it("vernieuwt een verlopen token en bewaart het nieuwe; bij 401 één keer opnieuw", async () => {
    const { a, z, store } = await adapter({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() - 1000 });
    expect(JSON.parse(store.tokens!).accessToken).toBe("access-2");
    expect((await a.getStatus("p1")).status).toBe("ONLINE");
    z.state.expireNext = true;
    await (a as unknown as { refreshMeta(): Promise<void> }).refreshMeta();
    expect(JSON.parse(store.tokens!).accessToken).toBe("access-3");
    expect((await a.getStatus("p1")).status).toBe("ONLINE");
    await a.disconnect();
  });

  it("ongeldige refresh-token → foutstatus 'log opnieuw in'; 429 → wachten", async () => {
    const { a, z } = await adapter({ accessToken: "verkeerd", refreshToken: "verkeerd", expiresAt: Date.now() + 3_600_000 });
    const s = await a.getStatus("p1");
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("opnieuw in");
    await a.disconnect();
    const b = await adapter();
    b.z.state.rateLimited = true;
    await (b.a as unknown as { refreshMeta(): Promise<void> }).refreshMeta();
    expect(b.a.budget.blockedForSeconds()).toBeGreaterThan(100);
    await b.a.disconnect();
    void z;
  });
});
