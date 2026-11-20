import type { HueHttp, HueResponse } from "../src/hue/net";

/** In-memory nabootsing van een Hue Bridge (CLIP v2) voor tests. Er wordt nooit een echt apparaat aangesproken. */
export function fakeBridge() {
  const lights: Record<string, Record<string, unknown>> = {
    "l-1": {
      id: "l-1",
      type: "light",
      owner: { rid: "d-1", rtype: "device" },
      metadata: { name: "Plafond" },
      on: { on: false },
      dimming: { brightness: 50 },
      color_temperature: { mirek: 366, mirek_valid: true, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } },
      color: { xy: { x: 0.45, y: 0.41 } },
    },
    "l-2": {
      id: "l-2",
      type: "light",
      owner: { rid: "d-2", rtype: "device" },
      metadata: { name: "Tuinlamp" },
      on: { on: true },
    },
  };
  const devices = [
    { id: "d-1", type: "device", metadata: { name: "Plafond" }, product_data: { product_name: "Hue color lamp", model_id: "LCA001" }, services: [] },
    { id: "d-2", type: "device", metadata: { name: "Tuinlamp" }, product_data: { product_name: "Hue outdoor", model_id: "LWA001" }, services: [] },
  ];
  const rooms = [{ id: "r-1", type: "room", metadata: { name: "Woonkamer" }, children: [{ rid: "d-1", rtype: "device" }] }];
  const connectivity = [
    { id: "z-1", type: "zigbee_connectivity", owner: { rid: "d-1", rtype: "device" }, status: "connected" },
    { id: "z-2", type: "zigbee_connectivity", owner: { rid: "d-2", rtype: "device" }, status: "connectivity_issue" },
  ];
  const scenes = [{ id: "s-1", type: "scene", metadata: { name: "Ontspannen" }, group: { rid: "r-1", rtype: "room" } }];
  const puts: { path: string; body: unknown }[] = [];
  let failWith: number | null = null;

  const http: HueHttp = {
    async request<T>(method: string, path: string, body?: unknown): Promise<HueResponse<T>> {
      if (failWith) return { status: failWith, body: { errors: [{ description: "unauthorized user" }], data: [] } as T };
      const list = (data: unknown[]) => ({ status: 200, body: { errors: [], data } as T });
      if (method === "GET") {
        if (path === "/clip/v2/resource/light") return list(Object.values(lights));
        if (path.startsWith("/clip/v2/resource/light/")) return list([lights[decodeURIComponent(path.split("/").pop()!)]].filter(Boolean));
        if (path === "/clip/v2/resource/device") return list(devices);
        if (path === "/clip/v2/resource/room") return list(rooms);
        if (path === "/clip/v2/resource/zigbee_connectivity") return list(connectivity);
        if (path === "/clip/v2/resource/scene") return list(scenes);
      }
      if (method === "PUT") {
        puts.push({ path, body });
        const id = decodeURIComponent(path.split("/").pop()!);
        const l = lights[id];
        if (path.includes("/light/") && l) {
          const b = body as Record<string, Record<string, unknown>>;
          for (const k of Object.keys(b)) l[k] = { ...(l[k] as object), ...b[k] };
          return list([{ rid: id, rtype: "light" }]);
        }
        if (path.includes("/scene/")) {
          (lights["l-1"]!.on as { on: boolean }).on = true;
          return list([{ rid: id, rtype: "scene" }]);
        }
      }
      return { status: 404, body: { errors: [{ description: "not found" }], data: [] } as T };
    },
    async stream() {
      return new Promise<void>(() => undefined); // blijft open
    },
  };
  return { http, lights, connectivity, puts, fail: (s: number | null) => (failWith = s) };
}
