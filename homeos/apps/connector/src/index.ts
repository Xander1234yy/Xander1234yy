#!/usr/bin/env -S npx tsx
import path from "node:path";
import { loadConfig, CONNECTOR_VERSION } from "./config";
import { createConnector } from "./app";
import { createLogger } from "./logger";

const config = loadConfig();
const logger = createLogger(config.dataDir);

if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
  logger.warn(`Connector luistert op ${config.host}. Zorg dat deze poort NIET via je router open staat naar internet.`);
}

const connector = await createConnector(config, logger);
const addr = await connector.start();
logger.info(`HomeOS Device Connector ${CONNECTOR_VERSION} draait op http://${addr.address}:${addr.port}`, {
  connectorId: connector.identity.connectorId,
  demo: config.demo,
  tokenFile: path.join(config.dataDir, "api-token"),
});
if (config.demo) logger.info("DEMO-modus: alle apparaten zijn gesimuleerd en als DEMO gemarkeerd.");

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info(`Afsluiten (${signal})…`);
  await connector.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
