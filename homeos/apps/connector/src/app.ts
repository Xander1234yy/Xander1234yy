import { createDemoAdapters, type DeviceAdapter, type Logger } from "@homeos/integrations";
import type { DeviceEvent } from "@homeos/shared";
import { CONNECTOR_VERSION, type ConnectorConfig } from "./config";
import { ensureDir, joinPath, readFileOrNull, writeFileAtomic } from "./fs-utils";
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
import { createZonneplanService } from "./zonneplan-service";
import { createHueCloudService } from "./huecloud-service";
import { createPushService, type PushSender } from "./push-service";

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
  pushSender?: PushSender,
) {
  await ensureDir(config.dataDir);
  await ensureDir(joinPath(config.dataDir, "logs"));
  const identity = await loadOrCreateIdentity(config.dataDir);
  const adapters: DeviceAdapter[] = [...(config.demo ? createDemoAdapters() : []), ...extraAdapters];
  if (config.demo && config.production) logger.warn("DEMO-modus staat aan in productie. Alle apparaten zijn gesimuleerd.");
  const serverless = !!config.serverless;
  if (serverless && !config.masterSecret) throw new Error("Cloudmodus vereist HOMEOS_CONNECTOR_SECRET (sleutel voor de versleutelde opslag)");

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
    serverless,
    adapterCache: (adapterId) => {
      const file = joinPath(config.dataDir, "cache", `${adapterId.replace(/[^\w.-]/g, "_")}.json`);
      return {
        load: async () => {
          const raw = await readFileOrNull(file);
          try {
            return raw ? (JSON.parse(raw) as unknown) : null;
          } catch {
            return null;
          }
        },
        save: (v) => writeFileAtomic(file, JSON.stringify(v)),
      };
    },
  });

  const hue = createHueService({ registry, secrets, store: integrations, deps: hueDeps });
  // Lokale integraties (alleen bereikbaar in het eigen netwerk) bestaan niet in de cloudmodus.
  if (!serverless) adapters.push(...hue.adapters());
  const cloud = createCloudIntegrations({ registry, secrets, store: integrations, fetchImpl });
  adapters.push(...cloud.adapters());
  const matter = createMatterService({ registry, store: integrations, dataDir: config.dataDir, logger, factory: matterFactory });
  if (!serverless) adapters.push(...matter.adapters());
  const webos = createWebOsService({ registry, secrets, store: integrations, deps: webosDeps });
  if (!serverless) adapters.push(...webos.adapters());
  const cameras = createCameraService({ registry, secrets, store: integrations, deps: cameraDeps });
  if (!serverless) adapters.push(...cameras.adapters());
  const zonneplan = createZonneplanService({ registry, secrets, store: integrations, fetchImpl });
  adapters.push(...zonneplan.adapters());
  const huecloud = createHueCloudService({ registry, secrets, store: integrations, fetchImpl });
  adapters.push(...huecloud.adapters());

  const automations = await createAutomationService({ registry, dataDir: config.dataDir, logger, serverless });
  const push = createPushService({ secrets, logger, ...(pushSender ? { sender: pushSender } : {}) });
  // Iedere melding (na de categorie-instellingen) ook als pushmelding naar telefoons/tablets.
  automations.events.on("notification", (n) => void push.notify(n).catch((err) => logger.warn("Push mislukt", { error: String(err) })));

  const allowedHosts = ["localhost", "127.0.0.1", "::1", config.host.toLowerCase()];
  const api = createConnectorServer({
    registry,
    token: identity.apiToken,
    logger,
    version: CONNECTOR_VERSION,
    rateLimitPerMin: config.rateLimitPerMin,
    commandLimitPerMin: config.commandLimitPerMin,
    allowedHosts,
    cloudMode: serverless,
    hue,
    cloud,
    matter,
    webos,
    cameras,
    zonneplan,
    huecloud,
    push,
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
    push,
    /** Cloudmodus: alles wegschrijven vóór het einde van de aanvraag. */
    async flush() {
      await Promise.all([registry.flush(), automations.flush()]);
    },
    async stop() {
      automations.stop();
      cameras.stopAll();
      await api.close();
      await registry.stop();
    },
  };
}
