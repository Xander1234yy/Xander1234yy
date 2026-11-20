import { z } from "zod";
import { readFileOrNull, writeFileAtomic, joinPath } from "./fs-utils";

/** Niet-geheime integratieconfiguratie (bridge-adres, ID, certificaatvingerafdruk). Keys staan in de SecretStore. */
const HueBridgeSchema = z.object({
  bridgeId: z.string().regex(/^[0-9a-f]{16}$/),
  host: z.string(),
  name: z.string().max(80),
  fingerprint256: z.string().min(10),
  pairedAt: z.string(),
});
const SolarEdgeSchema = z.object({
  siteId: z.string().regex(/^\d{1,12}$/),
  name: z.string().max(120),
  timeZone: z.string().max(64),
  peakPowerKw: z.number().nullable(),
  addedAt: z.string(),
});
const DaikinSchema = z.object({ clientId: z.string().max(200), redirectUri: z.string().max(500), connectedAt: z.string() });
const TuyaSchema = z.object({ region: z.enum(["eu", "eu-west", "us", "us-east", "cn", "in"]), accessId: z.string().max(64), uid: z.string().max(64), addedAt: z.string() });
const WebOsTvSchema = z.object({
  tvId: z.string().regex(/^[0-9a-f]{16}$/),
  host: z.string().max(64),
  name: z.string().max(80),
  model: z.string().max(80),
  scheme: z.enum(["wss", "ws"]),
  fingerprint256: z.string().max(200).nullable(),
  mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/).nullable(),
  pairedAt: z.string(),
});
const TapoCameraSchema = z.object({
  cameraId: z.string().regex(/^[0-9a-f]{16}$/),
  host: z.string().max(64),
  name: z.string().max(80),
  model: z.string().max(80),
  addedAt: z.string(),
});
const Schema = z.object({
  version: z.literal(1),
  hue: z.array(HueBridgeSchema),
  solaredge: z.array(SolarEdgeSchema).default([]),
  daikin: DaikinSchema.nullable().default(null),
  tuya: TuyaSchema.nullable().default(null),
  matter: z.object({ enabledAt: z.string() }).nullable().default(null),
  webos: z.array(WebOsTvSchema).default([]),
  tapo: z.array(TapoCameraSchema).default([]),
  zonneplan: z.object({ connectionUuid: z.string().regex(/^[0-9a-f-]{36}$/i), label: z.string().max(80), addedAt: z.string() }).nullable().default(null),
});
export type TapoCameraRecord = z.infer<typeof TapoCameraSchema>;
export type WebOsTvRecord = z.infer<typeof WebOsTvSchema>;
export type SolarEdgeRecord = z.infer<typeof SolarEdgeSchema>;
export type HueBridgeRecord = z.infer<typeof HueBridgeSchema>;
type State = z.infer<typeof Schema>;

export class IntegrationsStore {
  private constructor(
    private readonly file: string | null,
    public state: State,
  ) {}

  static async open(dataDir: string | null): Promise<IntegrationsStore> {
    const file = dataDir ? joinPath(dataDir, "integrations.json") : null;
    let state: State = { version: 1, hue: [], solaredge: [], daikin: null, tuya: null, matter: null, webos: [], tapo: [], zonneplan: null };
    const raw = file ? await readFileOrNull(file) : null;
    if (raw) {
      const p = Schema.safeParse(JSON.parse(raw));
      if (p.success) state = p.data;
    }
    return new IntegrationsStore(file, state);
  }

  async save(): Promise<void> {
    if (this.file) await writeFileAtomic(this.file, JSON.stringify(this.state, null, 2));
  }
}
