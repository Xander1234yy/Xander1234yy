import type { DeviceAdapter } from "../adapter";
import { DemoDoorbellAdapter } from "./doorbell";
import { DemoEnergyAdapter } from "./energy";
import { DemoLightsAdapter } from "./lights";
import { DemoMediaAdapter } from "./apple-tv";
import { DemoPlugAdapter } from "./plugs";

export { DemoAdapterBase } from "./base";
export { DemoLightsAdapter, DemoPlugAdapter, DemoMediaAdapter, DemoEnergyAdapter, DemoDoorbellAdapter };
export { DemoEnergyModel, demoSolarW, demoConsumptionW } from "./energy";

/** Volledig DEMO-huis. Alleen gebruiken in ontwikkeling / demo-omgeving. */
export function createDemoAdapters(): DeviceAdapter[] {
  return [new DemoLightsAdapter(), new DemoPlugAdapter(), new DemoMediaAdapter(), new DemoEnergyAdapter(), new DemoDoorbellAdapter()];
}
