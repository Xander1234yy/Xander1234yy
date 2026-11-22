import { createHash, createHmac } from "node:crypto";
import { Duplex } from "node:stream";
import type { TapoHttp } from "../src/tapocloud/client";
import type { RelaySocket } from "../src/tapocloud/relay";

/**
 * Nagebootste TP-Link-cloud (alleen voor tests, nooit het netwerk). Controleert de handtekening van iedere
 * account-aanvraag zoals de echte server (anders -10303), en gedraagt zich als de Tapo-app-diensten.
 */
export function fakeTapoCloud(opts: { mfa?: boolean } = {}) {
  const user = "xander@example.com";
  const password = "tapo-wachtwoord";
  const BASE = "https://n-euw1-wap.i.tplinkcloud.com";
  const IOT = "https://euw1-app-server.iot.i.tplinknbu.com";
  const CIPC = "https://euw1-cipc.i.tplinkcloud.com";
  const CAM = "802C3A5B9E1F4D6A8B7C0D1E2F3A4B5C6D7E8F90";
  const BELL = "802C3A5B9E1F4D6A8B7C0D1E2F3A4B5C6D7E8F91";
  const SK = "6ed7d97f3e73467f8a5bab90b577ba4c";
  const state = {
    mfaRequired: opts.mfa ?? false,
    mfaSent: 0,
    token: "tok-1",
    expire: false,
    refreshes: 0,
    privacy: "off" as "on" | "off",
    moves: [] as { x: string; y: string }[],
    notifications: [] as Record<string, unknown>[],
    badSignatures: 0,
    calls: [] as string[],
    relayRequests: [] as { auth: string; body: Record<string, unknown> }[],
    relayWrites: [] as string[],
    relayStatus: 200,
  };
  const ok = (result: unknown) => ({ status: 200, text: JSON.stringify({ error_code: 0, result }) });
  const err = (code: number, msg = "") => ({ status: 200, text: JSON.stringify({ error_code: code, msg }) });

  const http: TapoHttp = async (url, init) => {
    const u = new URL(url);
    state.calls.push(`${init.method} ${u.host}${u.pathname}`);
    if (u.pathname.startsWith("/api/v2/")) {
      // Handtekening controleren.
      const md5 = createHash("md5").update(init.body ?? "").digest("base64");
      const m = /Timestamp=(\d+), Nonce=([\w-]+), AccessKey=(\w+), Signature=(\w+)/.exec(init.headers["x-authorization"] ?? "");
      const expect = m && createHmac("sha1", SK).update(`${md5}\n${m[1]}\n${m[2]}\n${u.pathname}`).digest("hex");
      if (!m || m[4] !== expect || init.headers["content-md5"] !== md5) {
        state.badSignatures++;
        return err(-10303, "Signature params invalid");
      }
      const b = JSON.parse(init.body ?? "{}");
      const token = u.searchParams.get("token");
      const authed = token === state.token && !state.expire;
      switch (u.pathname) {
        case "/api/v2/account/getAccountStatusAndUrl":
          return ok({ appServerUrl: BASE, accountStatus: 0 });
        case "/api/v2/account/login":
          if (u.host !== new URL(BASE).host) return err(-20212);
          if (b.cloudUserName !== user || b.cloudPassword !== password) return err(-20601, "Incorrect email or password");
          if (!b.terminalMeta) return err(-20104);
          if (state.mfaRequired) return ok({ errorCode: "-20677", MFAProcessId: "proc-1", supportedMFATypes: [1, 2] });
          return ok({ token: state.token, refreshToken: "ref-1", appServerUrl: BASE });
        case "/api/v2/account/getPushVC4TerminalMFA":
          state.mfaSent++;
          return ok({});
        case "/api/v2/account/checkMFACodeAndLogin":
          if (b.code !== "123456" || b.MFAProcessId !== "proc-1") return err(-20004, "Wrong code");
          state.mfaRequired = false;
          return ok({ token: state.token, refreshToken: "ref-1" });
        case "/api/v2/account/refreshToken":
          state.refreshes++;
          state.token = `tok-r${state.refreshes}`;
          state.expire = false;
          return ok({ token: state.token, refreshToken: "ref-2" });
        case "/api/v2/common/getDeviceListByPage":
          if (!authed) return err(-20651, "Token expired");
          return ok({
            totalNum: 3,
            deviceList: [
              { deviceId: CAM, deviceType: "SMART.IPCAMERA", deviceModel: "C500", alias: Buffer.from("Tuin C500").toString("base64"), status: 0 },
              { deviceId: BELL, deviceType: "SMART.TAPODOORBELL", deviceModel: "D230", alias: "Voordeur" },
              { deviceId: "../evil", deviceType: "SMART.IPCAMERA", alias: "fout" },
            ],
          });
        case "/api/v2/common/getAppServiceUrl":
          if (!authed) return err(-20651);
          return ok({ serviceUrls: { "nbu.iot-app-server.app": IOT, "cipc.api.cloud": CIPC } });
        case "/api/v2/common/getAppNotificationByPage": {
          if (!authed) return err(-20651);
          const since = Number(b.indexTime);
          return ok({ notifications: state.notifications.filter((n) => Number(n.time) > since), hasNextPage: false, currentIndex: 0 });
        }
      }
      return err(-20104);
    }
    if (u.host === new URL(IOT).host && /\/v1\/things\/\w+\/services-sync$/.test(u.pathname)) {
      if (init.headers.authorization !== `ut|${state.token}` || state.expire) return { status: 401, text: JSON.stringify({ message: "unauthorized" }) };
      const req = JSON.parse(init.body ?? "{}").inputParams.requestData.params.requests[0];
      const reply = (result: unknown, error_code = 0) => ({ status: 200, text: JSON.stringify({ outputParams: { responseData: { result: { responses: [{ method: req.method, result, error_code }] } } } }) });
      if (req.method === "getLensMaskConfig") return reply({ lens_mask: { lens_mask_info: { enabled: state.privacy } } });
      if (req.method === "setLensMaskConfig") {
        state.privacy = req.params.lens_mask.lens_mask_info.enabled;
        return reply({});
      }
      if (req.method === "motorMove") {
        if (state.privacy === "on") return reply({}, -64324);
        state.moves.push({ x: req.params.motor.move.x_coord, y: req.params.motor.move.y_coord });
        return reply({});
      }
      return reply({}, -40101);
    }
    if (u.host === new URL(CIPC).host && u.pathname === "/v2/relay/request") {
      state.relayRequests.push({ auth: init.headers.authorization ?? "", body: JSON.parse(init.body ?? "{}") });
      if (init.headers.authorization !== state.token) return { status: 200, text: JSON.stringify({ errorCode: -20651, msg: "token expired" }) };
      return { status: 200, text: JSON.stringify({ errorCode: 0, result: { relayUrl: "https://euw1-relay-5.i.tplinkcloud.com:443/relayservice?deviceid=CAM&type=video&resolution=HD", relayToken: "relay-tok", elbCookie: "AWSELB=x" } }) };
    }
    return { status: 404, text: "{}" };
  };

  /** Nagebootst videorelais: controleert de kop, wacht op de previewaanvraag en stuurt TS-delen + een JSON-melding. */
  const relaySocket: RelaySocket = async (host, port) => {
    const ts = (n: number) => Buffer.concat([Buffer.from([0x47, 0x40, 0x44, 0x10]), Buffer.alloc(184, n)]); // één TS-pakket
    let got = "";
    let sentVideo = false;
    let headSent = false;
    const sock: Duplex = new Duplex({
      read() {},
      write(chunk: Buffer, _enc, cb) {
        got += chunk.toString("latin1");
        state.relayWrites.push(chunk.toString("latin1"));
        if (got.includes("\r\n\r\n") && !headSent) {
          headSent = true;
          const okHead = host.endsWith(".i.tplinkcloud.com") && port === 443 && got.includes("X-token: relay-tok") && got.includes("Cookie: AWSELB=x");
          sock.push(`HTTP/1.1 ${okHead ? state.relayStatus : 403} OK\r\nContent-Type: multipart/mixed;boundary=--device-stream-boundary--\r\n\r\n`);
        }
        if (!sentVideo && got.includes('"preview"')) {
          sentVideo = true;
          const part = (headers: string, body: Buffer) => Buffer.concat([Buffer.from(`----device-stream-boundary--\r\n${headers}Content-Length: ${body.length}\r\n\r\n`), body, Buffer.from("\r\n")]);
          sock.push(part("Content-Type: application/json\r\n", Buffer.from(JSON.stringify({ type: "notification", params: { session_id: "sess-9" } }))));
          for (let i = 1; i <= 26; i++) sock.push(part(`Content-Type: video/mp2t\r\nX-Session-Id: sess-9\r\nX-Data-Sequence: ${i}\r\n`, ts(i)));
          sock.push("----device-stream-boundary----\r\n");
        }
        cb();
      },
    });
    return sock;
  };
  return { state, http, relaySocket, user, password, CAM, BELL };
}
