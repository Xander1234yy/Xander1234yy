/** Nagebootste Zonneplan-app-API als fetch-functie. Alleen voor tests; niets gaat over het netwerk. */
export function fakeZonneplan() {
  const conn = "11111111-2222-4333-8444-555555555555";
  const state = {
    otp: "123456",
    access: "access-1",
    refresh: "refresh-1",
    issued: 0,
    calls: [] as string[],
    bodies: [] as string[],
    delivery: 711,
    production: 0,
    expireNext: false,
    rateLimited: false,
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = u.pathname.slice(1);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    state.calls.push(`${init?.method ?? "GET"} ${path}`);
    state.bodies.push(String(init?.body ?? ""));
    if (u.hostname !== "app-api.zonneplan.nl") throw new TypeError("onverwachte host");
    if (path === "oauth/authorize-challenge" && body.email) return json(403, { otp_required: true, auth_session: "sess-1" });
    if (path === "oauth/authorize-challenge" && body.auth_session) return body.otp === state.otp ? json(200, { authorization_code: "code-1" }) : json(422, { message: "invalid otp" });
    if (path === "oauth/token") {
      if (body.grant_type === "authorization_code" && body.code === "code-1" && body.code_verifier) return json(200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600 });
      if (body.grant_type === "refresh_token" && body.refresh_token === state.refresh) {
        state.issued++;
        state.access = `access-${state.issued + 1}`;
        state.refresh = `refresh-${state.issued + 1}`;
        return json(200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600 });
      }
      return json(401, { message: "invalid grant" });
    }
    const auth = new Headers(init?.headers).get("authorization");
    if (state.expireNext) {
      state.expireNext = false;
      return json(401, { message: "expired" });
    }
    if (auth !== `Bearer ${state.access}`) return json(401, { message: "unauthenticated" });
    if (state.rateLimited) return json(429, {}, { "retry-after": "120" });
    if (path === "user-accounts/me") {
      return json(200, {
        data: {
          address_groups: [
            {
              uuid: "g",
              connections: [
                { uuid: conn, contracts: [
                  { uuid: "p1-uuid", type: "p1_installation", label: "Connect energiemeter", meta: { electricity_last_measured_at: "2026-11-21T10:00:00.000000Z", electricity_last_measured_delivery_value: state.delivery, electricity_last_measured_production_value: state.production, dsmr_version: "50" } },
                  { uuid: "e", type: "electricity", label: "Stroom", meta: {} },
                ] },
              ],
            },
          ],
        },
      });
    }
    if (path === `connections/${conn}/electricity-delivered`) {
      return json(200, {
        data: {
          measurement_groups: [
            { type: "live", date: "2026-11-20T23:00:00.000000Z", totals: { d: 5775, p: 2576 } },
            { type: "hours", date: "2026-11-20T23:00:00.000000Z", totals: { d: 5775, p: 2576 }, measurements: [
              { date: "2026-11-21T09:00:00.000000Z", values: { d: 300, p: 100 } },
              { date: "2026-11-21T10:00:00.000000Z", values: { d: 200, p: 400 } },
            ] },
            { type: "days", date: "2026-10-31T23:00:00.000000Z", totals: { d: 120000, p: 40000 }, measurements: [] },
            { type: "months", date: "2025-12-31T23:00:00.000000Z", totals: { d: 934741, p: 220582 }, measurements: [] },
          ],
        },
      });
    }
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, state, conn };
}
