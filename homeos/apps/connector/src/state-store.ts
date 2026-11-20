import { z } from "zod";
import { RoomSchema, type Room } from "@homeos/shared";
import { readFileOrNull, writeFileAtomic, joinPath } from "./fs-utils";

const PersistedSchema = z.object({
  version: z.literal(1),
  rooms: z.array(RoomSchema),
  devices: z.record(
    z.string(),
    z.object({ name: z.string().optional(), roomId: z.string().nullable().optional(), addedAt: z.string() }),
  ),
  emergencyStop: z.boolean(),
  demoSeeded: z.boolean(),
});
export type PersistedState = z.infer<typeof PersistedSchema>;

export const DEFAULT_ROOMS: Room[] = [
  { id: "woonkamer", name: "Woonkamer", icon: "sofa", order: 0 },
  { id: "keuken", name: "Keuken", icon: "chef-hat", order: 1 },
  { id: "slaapkamer", name: "Slaapkamer", icon: "bed", order: 2 },
  { id: "badkamer", name: "Badkamer", icon: "bath", order: 3 },
  { id: "overig", name: "Overige ruimtes", icon: "door-open", order: 4 },
];

function initial(): PersistedState {
  return { version: 1, rooms: structuredClone(DEFAULT_ROOMS), devices: {}, emergencyStop: false, demoSeeded: false };
}

/** Lokale registry-configuratie (namen, kamers, toegevoegde apparaten). Wordt in fase 2 met Supabase gesynchroniseerd. */
export class StateStore {
  private constructor(
    private readonly file: string | null,
    public state: PersistedState,
  ) {}

  static async open(dataDir: string | null): Promise<StateStore> {
    const file = dataDir ? joinPath(dataDir, "registry.json") : null;
    let state = initial();
    if (file) {
      const raw = await readFileOrNull(file);
      if (raw) {
        const parsed = PersistedSchema.safeParse(JSON.parse(raw));
        if (parsed.success) state = parsed.data;
      }
    }
    return new StateStore(file, state);
  }

  private pending: Promise<void> = Promise.resolve();

  save(): Promise<void> {
    if (!this.file) return Promise.resolve();
    const file = this.file;
    const data = JSON.stringify(this.state, null, 2);
    this.pending = this.pending.then(() => writeFileAtomic(file, data)).catch(() => undefined);
    return this.pending;
  }
}
