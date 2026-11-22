/**
 * LG webOS TV: "second screen"-protocol (SSAP) over een WebSocket op het lokale netwerk.
 * Dit is het protocol van LG's eigen open-source Connect SDK (Apache-2.0) en de LG TV Plus/ThinQ-afstandsbediening.
 * Het registratiemanifest hieronder is het manifest van LG's Connect SDK ("LG Remote App", vendor com.lge).
 * De tv vraagt bij de eerste registratie op het scherm om toestemming en geeft dan een client-key terug.
 */

export const WSS_PORT = 3001; // TLS (zelfondertekend certificaat; wij pinnen de vingerafdruk)
export const WS_PORT = 3000; // onversleuteld, alleen voor oudere tv's die geen 3001 hebben

const SIGNATURE =
  "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR" +
  "+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4" +
  "RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM" +
  "2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==";

const PERMISSIONS = [
  "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED", "CONTROL_AUDIO", "CONTROL_DISPLAY",
  "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_RECORDING", "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_TV", "CONTROL_POWER",
  "CONTROL_TV_SCREEN", "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_NETWORK_STATE", "READ_RUNNING_APPS",
  "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST", "READ_POWER_STATE", "READ_COUNTRY_INFO", "CONTROL_INPUT_TEXT",
  "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS", "READ_SETTINGS",
];
const SIGNED_PERMISSIONS = [
  "TEST_SECURE", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS", "READ_LGE_SDX", "READ_NOTIFICATIONS",
  "SEARCH", "WRITE_SETTINGS", "WRITE_NOTIFICATION_ALERT", "CONTROL_POWER", "READ_CURRENT_CHANNEL", "READ_RUNNING_APPS",
  "READ_UPDATE_INFO", "UPDATE_FROM_REMOTE_APP", "READ_LGE_TV_INPUT_EVENTS", "READ_TV_CURRENT_TIME",
];

/** Registratiebericht. `signed=false`: nieuwere firmware weigert soms het ondertekende manifest; dan zonder handtekening. */
export function registrationMessage(clientKey: string | null, signed = true) {
  const manifest: Record<string, unknown> = signed
    ? {
        manifestVersion: 1,
        appVersion: "1.1",
        signed: {
          created: "20140509",
          appId: "com.lge.test",
          vendorId: "com.lge",
          localizedAppNames: { "": "LG Remote App" },
          localizedVendorNames: { "": "LG Electronics" },
          permissions: SIGNED_PERMISSIONS,
          serial: "2f930e2d2cfe083771f68e4fe7bb07",
        },
        permissions: PERMISSIONS,
        signatures: [{ signatureVersion: 1, signature: SIGNATURE }],
      }
    : { manifestVersion: 1, appVersion: "1.1", permissions: [...new Set([...PERMISSIONS, ...SIGNED_PERMISSIONS])].sort() };
  return {
    type: "register",
    id: "register_0",
    payload: { forcePairing: false, pairingType: "PROMPT", manifest, ...(clientKey ? { "client-key": clientKey } : {}) },
  };
}

export const EP = {
  systemInfo: "system/getSystemInfo",
  powerState: "com.webos.service.tvpower/power/getPowerState",
  turnOff: "system/turnOff",
  turnOnScreen: "com.webos.service.tvpower/power/turnOnScreen",
  volume: "audio/getVolume",
  setVolume: "audio/setVolume",
  volumeUp: "audio/volumeUp",
  volumeDown: "audio/volumeDown",
  setMute: "audio/setMute",
  foregroundApp: "com.webos.applicationManager/getForegroundAppInfo",
  launchPoints: "com.webos.applicationManager/listLaunchPoints",
  inputs: "tv/getExternalInputList",
  switchInput: "tv/switchInput",
  launch: "system.launcher/launch",
  play: "media.controls/play",
  pause: "media.controls/pause",
  connectionInfo: "com.webos.service.connectionmanager/getinfo",
  toast: "system.notifications/createToast",
  inputSocket: "com.webos.service.networkinput/getPointerInputSocket",
  currentChannel: "tv/getCurrentChannel",
} as const;

export interface SsapMessage {
  type: "response" | "registered" | "error" | "hello" | string;
  id?: string | number;
  error?: string;
  payload?: Record<string, unknown>;
}

/** Stand-by-toestanden van getPowerState: de verbinding is er, maar de tv is "uit". */
export const STANDBY_STATES = new Set(["Power Off", "Suspend", "Active Standby"]);

export interface TvSource {
  id: string;
  label: string;
  type: "input" | "app";
  appId: string;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : null);
const SAFE_ID = /^[\w.:-]{1,190}$/;

/** Ingangen (HDMI) en apps samenvoegen tot één bronnenlijst. Onbekende of vreemde id's worden overgeslagen. */
export function buildSources(inputs: unknown, launchPoints: unknown): TvSource[] {
  const out: TvSource[] = [];
  for (const d of Array.isArray(inputs) ? inputs : []) {
    const id = str((d as Record<string, unknown>).id);
    const label = str((d as Record<string, unknown>).label, 120) ?? id;
    const appId = str((d as Record<string, unknown>).appId) ?? "";
    if (id && SAFE_ID.test(id) && label) out.push({ id: `input:${id}`, label, type: "input", appId });
  }
  const apps: TvSource[] = [];
  for (const a of Array.isArray(launchPoints) ? launchPoints : []) {
    const id = str((a as Record<string, unknown>).id);
    const label = str((a as Record<string, unknown>).title, 120);
    if (!id || !label || !SAFE_ID.test(id)) continue;
    // Ingangen staan al in de lijst; apps die alleen een ingang openen niet dubbel tonen.
    if (out.some((i) => i.appId === id)) continue;
    apps.push({ id: `app:${id}`, label, type: "app", appId: id });
  }
  apps.sort((x, y) => x.label.localeCompare(y.label, "nl"));
  return [...out, ...apps].slice(0, 80);
}

export function parseMac(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(s) ? s.replace(/-/g, ":") : null;
}

export function macFromConnectionInfo(p: Record<string, unknown> | undefined): string | null {
  if (!p) return null;
  const wired = p.wiredInfo as Record<string, unknown> | undefined;
  const wifi = p.wifiInfo as Record<string, unknown> | undefined;
  return parseMac(wired?.macAddress) ?? parseMac(wifi?.macAddress);
}
