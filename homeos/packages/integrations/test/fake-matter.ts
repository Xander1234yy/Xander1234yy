import type { MatterBackend, MatterNodeInfo } from "../src/matter/adapter";

/** Nagebootste Matter-laag (geen netwerk). Gedraagt zich als een gedeelde GRILLPLATS-achtige stekker. */
export function fakeMatter(opts: { failCommission?: boolean } = {}) {
  const nodes: MatterNodeInfo[] = [];
  let onChange = () => undefined as void;
  const calls: string[] = [];
  const backend: MatterBackend = {
    async start(cb) {
      onChange = cb;
    },
    async stop() {},
    async commission(code) {
      calls.push(`commission:${code}`);
      if (opts.failCommission) throw new Error("time-out bij zoeken naar het apparaat");
      const nodeId = String(1000 + nodes.length);
      nodes.push({ nodeId, vendorName: "IKEA of Sweden", productName: "GRILLPLATS (SIM)", nodeLabel: "", online: true, endpoints: [{ endpoint: 1, kind: "plug", name: null, onOff: false, level: null, activePowerW: 12.345 }] });
      return nodeId;
    },
    nodes: () => nodes,
    async setOnOff(nodeId, endpoint, on) {
      calls.push(`onoff:${nodeId}/${endpoint}=${on}`);
      nodes.find((n) => n.nodeId === nodeId)!.endpoints.find((e) => e.endpoint === endpoint)!.onOff = on;
      onChange();
    },
    async setLevel() {},
    async remove(nodeId) {
      calls.push(`remove:${nodeId}`);
      nodes.splice(nodes.findIndex((n) => n.nodeId === nodeId), 1);
    },
  };
  return { backend, nodes, calls };
}
