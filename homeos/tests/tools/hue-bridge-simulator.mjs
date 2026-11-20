#!/usr/bin/env node
// Hue Bridge-SIMULATOR — alleen voor ontwikkeling en tests, nooit een echt apparaat.
// Implementeert het deel van de officiële Hue API dat HomeOS gebruikt (config, pairing, CLIP v2, eventstream),
// met een zelfondertekend certificaat waarvan de Common Name de bridge-ID is (zoals bij een echte bridge).
//
//   sudo node tests/tools/hue-bridge-simulator.mjs --host 172.17.0.1 [--port 443] [--press-after 1]
//   --press-after N : de "link-knop" geldt als ingedrukt vanaf de N-de koppelpoging (standaard 1 = tweede poging)
import https from "node:https";
import { randomBytes } from "node:crypto";
import selfsigned from "selfsigned";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const host = arg("host", "127.0.0.1");
const port = Number(arg("port", "443"));
const pressAfter = Number(arg("press-after", "1"));
const BRIDGE_ID = "001788fffe5a1b2c";
let attempts = 0;
const keys = new Set();
const streams = new Set();

const light = (id, device, name, extra = {}) => ({ id, type: "light", owner: { rid: device, rtype: "device" }, metadata: { name, archetype: "sultan_bulb" }, on: { on: false }, ...extra });
const lights = {
  "sim-l1": light("sim-l1", "sim-d1", "Eettafel (SIM)", {
    dimming: { brightness: 60 },
    color: { xy: { x: 0.4573, y: 0.41 }, gamut_type: "C" },
    color_temperature: { mirek: null, mirek_valid: false, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } },
  }),
  "sim-l2": light("sim-l2", "sim-d2", "Bureaulamp (SIM)", { dimming: { brightness: 100 }, color_temperature: { mirek: 250, mirek_valid: true, mirek_schema: { mirek_minimum: 153, mirek_maximum: 454 } } }),
};
const devices = [
  { id: "sim-d1", type: "device", metadata: { name: "Eettafel (SIM)" }, product_data: { model_id: "SIM-COLOR", manufacturer_name: "Simulator", product_name: "Simulator kleurenlamp" }, services: [] },
  { id: "sim-d2", type: "device", metadata: { name: "Bureaulamp (SIM)" }, product_data: { model_id: "SIM-WHITE", manufacturer_name: "Simulator", product_name: "Simulator wit-spectrum" }, services: [] },
];
const rooms = [{ id: "sim-r1", type: "room", metadata: { name: "Keuken" }, children: [{ rid: "sim-d1", rtype: "device" }] }];
const conn = devices.map((d) => ({ id: `z-${d.id}`, type: "zigbee_connectivity", owner: { rid: d.id, rtype: "device" }, status: "connected" }));
const scenes = [{ id: "sim-s1", type: "scene", metadata: { name: "Diner" }, group: { rid: "sim-r1", rtype: "room" } }];

const pems = await selfsigned.generate([{ name: "commonName", value: BRIDGE_ID }], { keySize: 2048 });

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b ? JSON.parse(b) : {}));
  });
}
function broadcast(data) {
  const msg = `id: ${Date.now()}:0\ndata: ${JSON.stringify([{ creationtime: new Date().toISOString(), id: randomBytes(8).toString("hex"), type: "update", data }])}\n\n`;
  for (const s of streams) s.write(msg);
}

https
  .createServer({ key: pems.private, cert: pems.cert }, async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/api/0/config") return json(res, 200, { name: "Simulator Bridge", bridgeid: BRIDGE_ID.toUpperCase(), modelid: "BSB002", apiversion: "1.70.0" });
    if (req.method === "POST" && url === "/api") {
      const body = await readBody(req);
      if (attempts++ < pressAfter) return json(res, 200, [{ error: { type: 101, address: "", description: "link button not pressed" } }]);
      const key = randomBytes(20).toString("hex");
      keys.add(key);
      console.log(`[simulator] gekoppeld met ${body.devicetype}`);
      return json(res, 200, [{ success: { username: key, clientkey: randomBytes(16).toString("hex").toUpperCase() } }]);
    }
    if (!keys.has(String(req.headers["hue-application-key"]))) return json(res, 403, { errors: [{ description: "unauthorized user" }], data: [] });
    if (url === "/eventstream/clip/v2") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": hi\n\n");
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    const m = /^\/clip\/v2\/resource\/(\w+)(?:\/([\w-]+))?$/.exec(url);
    if (!m) return json(res, 404, { errors: [{ description: "not found" }], data: [] });
    const [, type, id] = m;
    const all = { light: Object.values(lights), device: devices, room: rooms, zigbee_connectivity: conn, scene: scenes, bridge: [{ id: "b", type: "bridge", bridge_id: BRIDGE_ID }] }[type];
    if (!all) return json(res, 404, { errors: [{ description: "unknown resource" }], data: [] });
    if (req.method === "GET") return json(res, 200, { errors: [], data: id ? all.filter((x) => x.id === id) : all });
    if (req.method === "PUT" && type === "light" && lights[id]) {
      const body = await readBody(req);
      for (const [k, v] of Object.entries(body)) lights[id][k] = { ...lights[id][k], ...v };
      if (body.color_temperature) lights[id].color_temperature.mirek_valid = true;
      console.log(`[simulator] ${lights[id].metadata.name}: ${JSON.stringify(body)}`);
      broadcast([{ id, type: "light", ...body }]);
      return json(res, 200, { errors: [], data: [{ rid: id, rtype: "light" }] });
    }
    if (req.method === "PUT" && type === "scene" && id === "sim-s1") {
      Object.assign(lights["sim-l1"], { on: { on: true }, dimming: { brightness: 35 } });
      broadcast([{ id: "sim-l1", type: "light", on: { on: true }, dimming: { brightness: 35 } }]);
      return json(res, 200, { errors: [], data: [{ rid: id, rtype: "scene" }] });
    }
    return json(res, 405, { errors: [{ description: "method not allowed" }], data: [] });
  })
  .listen(port, host, () => console.log(`[simulator] Hue Bridge-simulator (geen echt apparaat) op https://${host}:${port}, bridge-ID ${BRIDGE_ID}`));
