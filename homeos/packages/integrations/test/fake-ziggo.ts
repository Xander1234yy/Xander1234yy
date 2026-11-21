import type { MqttConnect, MqttSession } from "../src/ziggo/mqtt";

/** Nagebootste Ziggo-diensten (alleen voor tests, nooit het netwerk): configuratie, aanmelden, boxen, zenders, MQTT. */
export function fakeZiggo(opts: { user?: string; password?: string; startState?: string } = {}) {
  const user = opts.user ?? "xander@example.com";
  const password = opts.password ?? "geheim-wachtwoord";
  const BASE = "https://spark-prod-nl.gnp.cloud.ziggogo.tv";
  const state = {
    logins: 0,
    refreshes: 0,
    expireToken: false,
    accessToken: "acc-1",
    published: [] as { topic: string; payload: Record<string, unknown> }[],
    box: { state: opts.startState ?? "ONLINE_STANDBY", channelId: "NL_000001_019401" },
    connects: [] as { url: string; username: string; password: string }[],
  };

  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const h = new Headers(init.headers);
    if (url.href === "https://prod.spark.ziggogo.tv/nl/en/config-service/conf/web/backoffice.json") {
      return json({
        authorizationService: { URL: `${BASE}/auth-service` },
        personalizationService: { URL: `${BASE}/personalization-service` },
        linearService: { URL: `${BASE}/linear-service` },
        mqttBroker: { URL: "wss://obomsg.prod.nl.horizon.tv:443/mqtt" },
      });
    }
    if (url.pathname === "/auth-service/v1/authorization" && init.method === "POST") {
      const b = JSON.parse(String(init.body));
      if (b.username !== user || b.password !== password) return json({ error: "bad" }, 401);
      state.logins++;
      state.accessToken = `acc-${state.logins}`;
      return json({ householdId: "HH123", accessToken: state.accessToken, refreshToken: "ref-1", username: user });
    }
    if (url.pathname === "/auth-service/v1/authorization/refresh") {
      state.refreshes++;
      state.accessToken = `acc-r${state.refreshes}`;
      state.expireToken = false;
      return json({ accessToken: state.accessToken, refreshToken: "ref-2" });
    }
    const authed = h.get("x-oesp-token") === state.accessToken && !state.expireToken;
    if (url.pathname === "/personalization-service/v1/customer/HH123") {
      if (!authed) return json({}, 401);
      return json({ cityId: 65535, assignedDevices: [{ deviceId: "3C36E4-EOSSTB-003656789", platformType: "EOS2", settings: { deviceFriendlyName: "Ziggo woonkamer" } }] });
    }
    if (url.pathname === "/auth-service/v1/mqtt/token") {
      if (!authed) return json({}, 401);
      return json({ token: "mqtt-token-1" });
    }
    if (url.pathname === "/linear-service/v2/channels") {
      return json([
        { id: "NL_000001_019401", name: "NPO 1", logicalChannelNumber: 1 },
        { id: "NL_000002_019402", name: "NPO 2", logicalChannelNumber: 2 },
        { id: "NL_000004_019404", name: "RTL 4", logicalChannelNumber: 4 },
        { id: "<script>", name: "fout", logicalChannelNumber: 99 },
      ]);
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;

  /** Nep-MQTT: reageert zoals de box (status op .../status, uiStatus naar de client, Power wisselt aan/stand-by). */
  const mqttConnect: MqttConnect = async ({ url, username, password: pw, clientId }) => {
    state.connects.push({ url, username, password: pw });
    if (pw !== "mqtt-token-1") throw Object.assign(new Error("Ziggo weigert de aanmelding"), { code: "UNAUTHORIZED" });
    const subs = new Set<string>();
    const listeners: ((t: string, p: string) => void)[] = [];
    const deliver = (topic: string, payload: unknown) => {
      if (!subs.has(topic)) return;
      setTimeout(() => listeners.forEach((l) => l(topic, JSON.stringify(payload))), 5);
    };
    const box = "3C36E4-EOSSTB-003656789";
    const session: MqttSession = {
      async subscribe(topic) {
        subs.add(topic);
        // Box stuurt bij abonneren meteen zijn status (bewaard bericht).
        if (topic === `HH123/${box}/status`) deliver(topic, { source: box, state: state.box.state });
      },
      publish(topic, payload) {
        const p = (typeof payload === "string" ? JSON.parse(payload) : payload) as Record<string, unknown>;
        state.published.push({ topic, payload: p });
        if (topic !== `HH123/${box}`) return;
        if (p.type === "CPE.getUiStatus") deliver(`HH123/${clientId}`, { type: "CPE.uiStatus", source: box, status: { playerState: { sourceType: "linear", source: { channelId: state.box.channelId } } } });
        if (p.type === "CPE.pushToTV") state.box.channelId = (p.status as { source: { channelId: string } }).source.channelId;
        if (p.type === "CPE.KeyEvent" && (p.status as { w3cKey: string }).w3cKey === "Power") {
          state.box.state = state.box.state === "ONLINE_RUNNING" ? "ONLINE_STANDBY" : "ONLINE_RUNNING";
          deliver(`HH123/${box}/status`, { source: box, state: state.box.state });
        }
      },
      onMessage: (cb) => void listeners.push(cb),
      end: async () => undefined,
    };
    return session;
  };
  return { state, fetchImpl, mqttConnect, user, password, box: "3C36E4-EOSSTB-003656789" };
}
