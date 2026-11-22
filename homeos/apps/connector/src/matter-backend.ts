import { mkdir } from "node:fs/promises";
import type { Logger } from "@homeos/integrations";
import type { MatterBackend, MatterEndpointInfo, MatterNodeInfo } from "@homeos/integrations";

/**
 * Echte Matter-backend op basis van matter.js (open-source implementatie, github.com/matter-js/matter.js).
 * Wordt pas geladen (dynamic import) als de gebruiker Matter gebruikt, zodat de connector zonder IPv6/Matter
 * gewoon blijft werken. De fabric-sleutels staan in <datamap>/matter (map met rechten 0700).
 *
 * EXPERIMENTEEL: getest met de matter.js-API (typecontrole); end-to-end alleen te testen op een netwerk met IPv6
 * (bijv. je Mac). De HomeOS-ontwikkelomgeving heeft geen IPv6.
 */
const DEVICE_TYPES = {
  plug: new Set([0x010a, 0x010b]), // On/Off Plug-in Unit, Dimmable Plug-In Unit
  light: new Set([0x0100, 0x0101, 0x010c, 0x010d]), // On/Off, Dimmable, Color Temperature, Extended Color Light
};

export async function createMatterJsBackend(storageDir: string, logger: Logger): Promise<MatterBackend> {
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const main = await import("@matter/main");
  const { OnOffClient } = await import("@matter/main/behaviors/on-off");
  const { LevelControlClient } = await import("@matter/main/behaviors/level-control");
  const { ElectricalPowerMeasurementClient } = await import("@matter/main/behaviors/electrical-power-measurement");
  const { BridgedDeviceBasicInformationClient } = await import("@matter/main/behaviors/bridged-device-basic-information");
  const { GeneralCommissioning } = await import("@matter/main/clusters");
  const { ManualPairingCodeCodec, QrPairingCodeCodec, NodeId } = await import("@matter/main/types");
  const { CommissioningController } = await import("@project-chip/matter.js");

  const env = main.Environment.default;
  env.vars.set("storage.path", storageDir);
  // matter.js mag de connector-processen niet overnemen (signalen/foutafhandeling doet de connector zelf).
  env.vars.set("runtime.signals", false);
  env.vars.set("runtime.unhandlederrors", false);
  main.Logger.level = main.LogLevel.WARN;

  type PairedNode = Awaited<ReturnType<InstanceType<typeof CommissioningController>["getNode"]>>;
  type DeviceEndpoint = ReturnType<PairedNode["getDevices"]>[number];

  const controller = new CommissioningController({ environment: { environment: env, id: "homeos" }, autoConnect: false, adminFabricLabel: "HomeOS" });
  const nodes = new Map<string, PairedNode>();
  let changed: () => void = () => undefined;

  const watch = (node: PairedNode) => {
    nodes.set(String(node.nodeId), node);
    node.events.attributeChanged.on(() => changed());
    node.events.stateChanged.on(() => changed());
    node.events.structureChanged.on(() => changed());
    if (!node.isConnected) node.connect();
  };

  const flatten = (eps: DeviceEndpoint[]): DeviceEndpoint[] => eps.flatMap((e) => [e, ...flatten(e.getChildEndpoints() as DeviceEndpoint[])]);

  const describe = (node: PairedNode): MatterNodeInfo => {
    const info = node.basicInformation;
    const endpoints: MatterEndpointInfo[] = [];
    for (const ep of flatten(node.getDevices())) {
      const type = Number(ep.deviceType);
      const kind = DEVICE_TYPES.plug.has(type) ? "plug" : DEVICE_TYPES.light.has(type) ? "light" : null;
      if (!kind) continue;
      const onOff = ep.maybeStateOf(OnOffClient)?.onOff;
      const level = ep.maybeStateOf(LevelControlClient)?.currentLevel;
      const power = ep.maybeStateOf(ElectricalPowerMeasurementClient)?.activePower;
      const bridged = ep.maybeStateOf(BridgedDeviceBasicInformationClient);
      endpoints.push({
        endpoint: Number(ep.getNumber()),
        kind,
        name: bridged?.nodeLabel || bridged?.productName || null,
        onOff: typeof onOff === "boolean" ? onOff : null,
        level: typeof level === "number" ? level : null,
        activePowerW: power === null || power === undefined ? null : Number(power) / 1000, // mW → W
      });
    }
    return {
      nodeId: String(node.nodeId),
      vendorName: info?.vendorName ?? "",
      productName: info?.productName ?? "",
      nodeLabel: info?.nodeLabel ?? "",
      online: node.isConnected,
      endpoints,
    };
  };

  const endpointOf = (nodeId: string, endpoint: number) => {
    const node = nodes.get(nodeId);
    const ep = node && flatten(node.getDevices()).find((e) => Number(e.getNumber()) === endpoint);
    if (!ep) throw new Error("Endpoint niet gevonden");
    return ep;
  };

  /** Wacht (max. 3 s) tot de subscriptie de nieuwe waarde meldt, zodat we de werkelijke status teruggeven. */
  const settle = async (check: () => boolean) => {
    for (let i = 0; i < 15 && !check(); i++) await new Promise((r) => setTimeout(r, 200));
  };

  return {
    async start(onChange) {
      changed = onChange;
      await controller.start();
      for (const id of controller.getCommissionedNodes()) {
        try {
          watch(await controller.getNode(id));
        } catch (err) {
          logger.warn("Matter-node kon niet geladen worden", { nodeId: String(id), error: String(err) });
        }
      }
      changed();
    },
    async stop() {
      await controller.close();
    },
    async commission(code) {
      const parsed = code.startsWith("MT:") ? QrPairingCodeCodec.decode(code)[0]! : ManualPairingCodeCodec.decode(code);
      const passcode = "passcode" in parsed ? parsed.passcode : 0;
      const identifierData =
        "discriminator" in parsed && typeof parsed.discriminator === "number"
          ? { longDiscriminator: parsed.discriminator }
          : { shortDiscriminator: (parsed as { shortDiscriminator?: number }).shortDiscriminator };
      const nodeId = await controller.commissionNode({
        commissioning: { regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor, regulatoryCountryCode: "XX" },
        discovery: { identifierData, discoveryCapabilities: { ble: false } },
        passcode,
      });
      watch(await controller.getNode(nodeId));
      return String(nodeId);
    },
    nodes: () => [...nodes.values()].map(describe),
    async setOnOff(nodeId, endpoint, on) {
      const ep = endpointOf(nodeId, endpoint);
      const cmds = ep.commandsOf(OnOffClient);
      await (on ? cmds.on() : cmds.off());
      await settle(() => ep.maybeStateOf(OnOffClient)?.onOff === on);
    },
    async setLevel(nodeId, endpoint, level) {
      const ep = endpointOf(nodeId, endpoint);
      await ep.commandsOf(LevelControlClient).moveToLevelWithOnOff({ level, transitionTime: null, optionsMask: {}, optionsOverride: {} });
      await settle(() => Math.abs((ep.maybeStateOf(LevelControlClient)?.currentLevel ?? -99) - level) <= 2);
    },
    async remove(nodeId) {
      const node = nodes.get(nodeId);
      // Verwijdert alleen de HomeOS-fabric van het apparaat; de koppeling met IKEA blijft bestaan.
      if (node) await node.decommission().catch(() => controller.removeNode(NodeId(BigInt(nodeId)), false));
      nodes.delete(nodeId);
      changed();
    },
  };
}
