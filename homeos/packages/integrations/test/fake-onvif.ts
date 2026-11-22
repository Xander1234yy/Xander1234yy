import { createHash } from "node:crypto";

/**
 * Nagebootste ONVIF-camera (Tapo-achtig) als fetch-functie. Alleen voor tests; er gaat niets over het netwerk.
 * Controleert de WS-Security-digest echt, zodat een verkeerd wachtwoord wordt geweigerd.
 */
export function fakeOnvifCamera(o: { username?: string; password?: string; ptz?: boolean; otherHostXAddr?: boolean } = {}) {
  const username = o.username ?? "homeos";
  const password = o.password ?? "camera-wachtwoord";
  const state = { reachable: true, calls: [] as string[], urls: [] as string[], pendingEvents: [] as string[], ptzMoves: [] as string[] };
  const host = o.otherHostXAddr ? "10.9.9.9" : "192.168.68.40";
  const env = (body: string) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body>${body}</s:Body></s:Envelope>`;
  const fault = (status: number, text: string) => new Response(env(`<s:Fault><s:Reason><s:Text>${text}</s:Text></s:Reason></s:Fault>`), { status });

  const authOk = (xml: string) => {
    const user = /<Username>([^<]*)<\/Username>/.exec(xml)?.[1];
    const digest = /<Password[^>]*>([^<]*)<\/Password>/.exec(xml)?.[1];
    const nonce = /<Nonce[^>]*>([^<]*)<\/Nonce>/.exec(xml)?.[1];
    const created = /<Created[^>]*>([^<]*)<\/Created>/.exec(xml)?.[1];
    if (!user || !digest || !nonce || !created) return false;
    const expected = createHash("sha1").update(Buffer.concat([Buffer.from(nonce, "base64"), Buffer.from(created + password)])).digest("base64");
    return user === username && digest === expected;
  };

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (!state.reachable) throw new TypeError("fetch failed");
    const xml = String(init?.body ?? "");
    const op = /<s:Body><(\w+)/.exec(xml)?.[1] ?? "?";
    state.calls.push(op);
    state.urls.push(String(url));
    if (op === "GetSystemDateAndTime") {
      const d = new Date();
      return new Response(env(`<tds:GetSystemDateAndTimeResponse xmlns:tds="x"><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>${d.getUTCHours()}</tt:Hour><tt:Minute>${d.getUTCMinutes()}</tt:Minute><tt:Second>${d.getUTCSeconds()}</tt:Second></tt:Time><tt:Date><tt:Year>${d.getUTCFullYear()}</tt:Year><tt:Month>${d.getUTCMonth() + 1}</tt:Month><tt:Day>${d.getUTCDate()}</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>`));
    }
    if (!authOk(xml)) return fault(400, "Sender not Authorized");
    switch (op) {
      case "GetDeviceInformation":
        return new Response(env(`<tds:GetDeviceInformationResponse xmlns:tds="x"><tds:Manufacturer>tp-link</tds:Manufacturer><tds:Model>C500</tds:Model><tds:FirmwareVersion>1.1.4</tds:FirmwareVersion><tds:SerialNumber>abc123</tds:SerialNumber><tds:HardwareId>2.0</tds:HardwareId></tds:GetDeviceInformationResponse>`));
      case "GetCapabilities":
        return new Response(env(`<tds:GetCapabilitiesResponse xmlns:tds="x"><tds:Capabilities><tt:Events><tt:XAddr>http://${host}:2020/onvif/service</tt:XAddr></tt:Events><tt:Media><tt:XAddr>http://${host}:2020/onvif/service</tt:XAddr></tt:Media>${o.ptz === false ? "" : `<tt:PTZ><tt:XAddr>http://${host}:2020/onvif/service</tt:XAddr></tt:PTZ>`}</tds:Capabilities></tds:GetCapabilitiesResponse>`));
      case "GetProfiles":
        return new Response(env(`<trt:GetProfilesResponse xmlns:trt="x"><trt:Profiles token="profile_1" fixed="true"><tt:Name>mainStream</tt:Name></trt:Profiles><trt:Profiles token="profile_2"/></trt:GetProfilesResponse>`));
      case "ContinuousMove":
        state.ptzMoves.push(/x="([^"]+)" y="([^"]+)"/.exec(xml)!.slice(1).join(","));
        return new Response(env(`<tptz:ContinuousMoveResponse xmlns:tptz="x"/>`));
      case "Stop":
        state.ptzMoves.push("stop");
        return new Response(env(`<tptz:StopResponse xmlns:tptz="x"/>`));
      case "CreatePullPointSubscription":
        return new Response(env(`<tev:CreatePullPointSubscriptionResponse xmlns:tev="x"><tev:SubscriptionReference><wsa5:Address xmlns:wsa5="y">http://${host}:2020/event-1</wsa5:Address></tev:SubscriptionReference></tev:CreatePullPointSubscriptionResponse>`));
      case "PullMessages": {
        const msgs = state.pendingEvents.splice(0).join("");
        if (!msgs) await new Promise((r) => setTimeout(r, 20));
        return new Response(env(`<tev:PullMessagesResponse xmlns:tev="x">${msgs}</tev:PullMessagesResponse>`));
      }
      default:
        return new Response(env(`<ok/>`));
    }
  }) as typeof fetch;

  const motion = (topic = "tns1:RuleEngine/CellMotionDetector/Motion", name = "IsMotion", value = "true") =>
    `<wsnt:NotificationMessage xmlns:wsnt="z"><wsnt:Topic Dialect="d">${topic}</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-11-21T10:00:00Z"><tt:Source><tt:SimpleItem Name="VideoSourceConfigurationToken" Value="vsconf"/></tt:Source><tt:Data><tt:SimpleItem Name="${name}" Value="${value}"/></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>`;

  return { fetchImpl, state, motion, username, password };
}
