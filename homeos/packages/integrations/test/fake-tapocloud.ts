import { createHash, createHmac } from "node:crypto";
import type { TapoHttp } from "../src/tapocloud/client";

/**
 * Nagebootste TP-Link-cloud (alleen voor tests, nooit het netwerk). Controleert de handtekening van iedere
 * account-aanvraag zoals de echte server (anders -10303), en gedraagt zich als de Tapo-app-diensten.
 */
export function fakeTapoCloud(opts: { mfa?: boolean } = {}) {
  const user = "xander@example.com";
  const password = "tapo-wachtwoord";
  const BASE = "https://n-euw1-wap.i.tplinkcloud.com";
  const IOT = "https://euw1-app-server.iot.i.tplinknbu.com";
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
          return ok({ serviceUrls: { "nbu.iot-app-server.app": IOT } });
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
    return { status: 404, text: "{}" };
  };
  return { state, http, user, password, CAM, BELL };
}
