import { fakeBridge } from "./fake-bridge";

/** Nagebootste Hue Remote API (api.meethue.com) als fetch-functie. Alleen voor tests. */
export function fakeHueCloud() {
  const bridge = fakeBridge();
  const state = { access: "acc-1", refresh: "ref-1", appKey: "remote-app-key", linked: false, calls: [] as string[], expireNext: false };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.hostname !== "api.meethue.com") throw new TypeError("onverwachte host");
    const h = new Headers(init?.headers);
    state.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
    if (u.pathname === "/v2/oauth2/token") {
      if (h.get("authorization") !== `Basic ${Buffer.from("cid:csecret").toString("base64")}`) return json(401, { error: "invalid_client" });
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code" && p.get("code") === "goede-code") return json(200, { access_token: state.access, refresh_token: state.refresh, expires_in: 604800 });
      if (p.get("grant_type") === "refresh_token" && p.get("refresh_token") === state.refresh) {
        state.access = "acc-2";
        state.refresh = "ref-2";
        return json(200, { access_token: state.access, refresh_token: state.refresh, expires_in: "604800" });
      }
      return json(400, { error: "invalid_grant" });
    }
    if (h.get("authorization") !== `Bearer ${state.access}` || state.expireNext) {
      state.expireNext = false;
      return json(401, { fault: "invalid token" });
    }
    if (u.pathname === "/route/api/0/config" && init?.method === "PUT") return (state.linked = true), json(200, [{ success: { "/config/linkbutton": true } }]);
    if (u.pathname === "/route/api" && init?.method === "POST") return state.linked ? json(200, [{ success: { username: state.appKey } }]) : json(200, [{ error: { type: 101, description: "link button not pressed" } }]);
    if (u.pathname.startsWith("/route/clip/v2/")) {
      if (h.get("hue-application-key") !== state.appKey) return json(403, { errors: [{ description: "unauthorized user" }] });
      const r = await bridge.http.request(init?.method as "GET", u.pathname.slice("/route".length), init?.body ? JSON.parse(String(init.body)) : undefined);
      return json(r.status, r.body);
    }
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, state, bridge };
}
