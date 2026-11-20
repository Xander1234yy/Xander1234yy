import path from "node:path";
import { createDemoAdapters, type DeviceAdapter, type Logger } from "@homeos/integrations";
import type { DeviceEvent } from "@homeos/shared";
import { CONNECTOR_VERSION, type ConnectorConfig } from "./config";
import { ensureDir } from "./fs-utils";
import { loadOrCreateIdentity } from "./identity";
import { Journal } from "./journal";
import { DeviceRegistry, type AuditEntry } from "./registry";
import { SecretStore } from "./secret-store";
import { createConnectorServer } from "./server";
import { StateStore } from "./state-store";
import { IntegrationsStore } from "./integrations-store";
import { createHueService, realHueDeps, type HueDeps } from "./hue-service";
import { createCloudIntegrations } from "./cloud-service";
import { createMatterService, lazyMatterJsBackend, type MatterBackendFactory } from "./matter-service";
import { createAutomationService } from "./automation-service";
import { createWebOsService, realWebOsDeps, type WebOsDeps } from "./webos-service";
import { createCameraService, type CameraDeps } from "./camera-service";

/** Bouwt de volledige connector op. Gescheiden van index.ts zodat tests hem kunnen starten. */
export async function createConnector(
  config: ConnectorConfig,
  logger: Logger,
  extraAdapters: DeviceAdapter[] = [],
  hueDeps: HueDeps = realHueDeps,
  fetchImpl: typeof fetch = fetch,
  matterFactory: MatterBackendFactory = lazyMatterJsBackend,
  webosDeps: WebOsDeps = realWebOsDeps,
  cameraDeps: CameraDeps = {},
) {
  await ensureDir(config.dataDir);
  await ensureDir(path.join(config.dataDir, "logs"));
  const identity = await loadOrCreateIdentity(config.dataDir);
  const adapters: DeviceAdapter[] = [...(config.demo ? createDemoAdapters() : []), ...extraAdapters];
  if (config.demo && config.production) logger.warn("DEMO-modus staat aan in productie. Alle apparaten zijn gesimuleerd.");

  const secrets = new SecretStore(config.dataDir, config.masterSecret);
  const integrations = await IntegrationsStore.open(config.dataDir);
  const registry = new DeviceRegistry({
    connectorId: identity.connectorId,
    version: CONNECTOR_VERSION,
    demoMode: config.demo,
    adapters,
    store: await StateStore.open(config.dataDir),
    secrets,
    audit: await Journal.open<AuditEntry>(config.dataDir, "audit"),
    events: await Journal.open<DeviceEvent>(config.dataDir, "events", 300),
    logger,
    pollIntervalMs: config.pollIntervalMs,
  });

  const hue = createHueService({ registry, secrets, store: integrations, deps: hueDeps });
  adapters.push(...hue.adapters());
  const cloud = createCloudIntegrations({ registry, secrets, store: integrations, fetchImpl });
  adapters.push(...cloud.adapters());
  const matter = createMatterService({ registry, store: integrations, dataDir: config.dataDir, logger, factory: matterFactory });
  adapters.push(...matter.adapters());
  const webos = createWebOsService({ registry, secrets, store: integrations, deps: webosDeps });
  adapters.push(...webos.adapters());
  const cameras = createCameraService({ registry, secrets, store: integrations, deps: cameraDeps });
  adapters.push(...cameras.adapters());

  const automations = await createAutomationService({ registry, dataDir: config.dataDir, logger });

  const allowedHosts = ["localhost", "127.0.0.1", "::1", config.host.toLowerCase()];
  const api = createConnectorServer({
    registry,
    token: identity.apiToken,
    logger,
    version: CONNECTOR_VERSION,
    rateLimitPerMin: config.rateLimitPerMin,
    commandLimitPerMin: config.commandLimitPerMin,
    allowedHosts,
    hue,
    cloud,
    matter,
    webos,
    cameras,
    automations,
  });

  return {
    identity,
    registry,
    api,
    async start() {
      await registry.start();
      return api.listen(config.port, config.host);
    },
    automations,
    async stop() {
      automations.stop();
      cameras.stopAll();
      await api.close();
      await registry.stop();
    },
  };
}
