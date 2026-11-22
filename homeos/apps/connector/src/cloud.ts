/**
 * Ingang voor de cloudmodus: de webapp (Vercel) start de connector per aanvraag in hetzelfde proces,
 * met opslag in Supabase via een geregistreerde StorageBackend.
 */
export { createConnector } from "./app";
export { registerStorage, unregisterStorage, memoryStorage, type StorageBackend } from "./fs-utils";
export type { ConnectorConfig } from "./config";
export type { PushSender } from "./push-service";
