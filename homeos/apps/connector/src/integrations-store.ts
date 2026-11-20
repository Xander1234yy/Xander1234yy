import path from "node:path";
import { z } from "zod";
import { readFileOrNull, writeFileAtomic } from "./fs-utils";

/** Niet-geheime integratieconfiguratie (bridge-adres, ID, certificaatvingerafdruk). Keys staan in de SecretStore. */
const HueBridgeSchema = z.object({
  bridgeId: z.string().regex(/^[0-9a-f]{16}$/),
  host: z.string(),
  name: z.string().max(80),
  fingerprint256: z.string().min(10),
  pairedAt: z.string(),
});
const Schema = z.object({ version: z.literal(1), hue: z.array(HueBridgeSchema) });
export type HueBridgeRecord = z.infer<typeof HueBridgeSchema>;
type State = z.infer<typeof Schema>;

export class IntegrationsStore {
  private constructor(
    private readonly file: string | null,
    public state: State,
  ) {}

  static async open(dataDir: string | null): Promise<IntegrationsStore> {
    const file = dataDir ? path.join(dataDir, "integrations.json") : null;
    let state: State = { version: 1, hue: [] };
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
