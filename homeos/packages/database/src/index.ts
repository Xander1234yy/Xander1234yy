import { z } from "zod";

/** Rijtypen (komen overeen met supabase/migrations). */
export type HouseholdRole = "owner" | "admin" | "member" | "guest";

export interface HouseholdRow {
  id: string;
  name: string;
  timezone: string;
}
export interface MemberRow {
  user_id: string;
  role: HouseholdRole;
  display_name: string;
  email: string;
  joined_at: string;
}
export interface RoomRow {
  id: string;
  household_id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
}
export interface FamilyTaskRow {
  id: string;
  title: string;
  notes: string;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}
export interface ShoppingItemRow {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
  created_at: string;
}
export interface CalendarEventRow {
  id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}
export interface NoteRow {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updated_at: string;
}
export interface MaintenanceRow {
  id: string;
  item_name: string;
  category: MaintenanceCategory;
  brand: string;
  model: string;
  purchase_date: string | null;
  warranty_until: string | null;
  last_service_at: string | null;
  next_service_at: string | null;
  notes: string;
}
export interface ConnectorLinkRow {
  household_id: string;
  connector_id: string;
  version: string | null;
  linked_at: string;
  last_seen_at: string | null;
}

// ─────────────── invoervalidatie (server actions) ───────────────

const id = z.uuid();
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .or(z.literal("").transform(() => null));

export const HouseholdNameSchema = z.string().trim().min(1, "Naam is verplicht").max(80);
export const DisplayNameSchema = z.string().trim().min(1, "Naam is verplicht").max(80);
export const InviteSchema = z.object({
  email: z.email("Ongeldig e-mailadres").max(254),
  role: z.enum(["admin", "member", "guest"]),
});
export const RoleChangeSchema = z.object({ userId: id, role: z.enum(["owner", "admin", "member", "guest"]) });

export const RoomCreateSchema = z.object({ name: z.string().trim().min(1, "Naam is verplicht").max(60), icon: z.string().max(40).optional() });
export const RoomUpdateSchema = z.object({ id, name: z.string().trim().min(1).max(60) });

export const TaskInputSchema = z.object({
  title: z.string().trim().min(1, "Titel is verplicht").max(200),
  notes: z.string().max(2000).default(""),
  assignedTo: id.nullable().or(z.literal("").transform(() => null)).default(null),
  dueDate: optDate.default(null),
});
export const ShoppingInputSchema = z.object({
  name: z.string().trim().min(1, "Naam is verplicht").max(120),
  quantity: z.string().trim().max(40).default(""),
});
export const EventInputSchema = z
  .object({
    title: z.string().trim().min(1, "Titel is verplicht").max(200),
    description: z.string().max(2000).default(""),
    location: z.string().trim().max(200).default(""),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    allDay: z.boolean().default(false),
  })
  .refine((e) => !e.endsAt || e.endsAt >= e.startsAt, { message: "Eindtijd ligt voor de starttijd", path: ["endsAt"] });
export const NoteInputSchema = z.object({
  title: z.string().trim().max(120).default(""),
  body: z.string().max(5000).default(""),
  pinned: z.boolean().default(false),
});

export const MAINTENANCE_CATEGORIES = ["apparaat", "installatie", "verwarming", "veiligheid", "tuin", "overig"] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];
export const MaintenanceInputSchema = z.object({
  itemName: z.string().trim().min(1, "Naam is verplicht").max(120),
  category: z.enum(MAINTENANCE_CATEGORIES).default("overig"),
  brand: z.string().trim().max(80).default(""),
  model: z.string().trim().max(120).default(""),
  purchaseDate: optDate.default(null),
  warrantyUntil: optDate.default(null),
  lastServiceAt: optDate.default(null),
  nextServiceAt: optDate.default(null),
  notes: z.string().max(2000).default(""),
});

/** Status van een onderhoudsitem t.o.v. vandaag (YYYY-MM-DD). */
export function maintenanceDue(next: string | null, today: string, soonDays = 30): "overdue" | "soon" | "ok" | "none" {
  if (!next) return "none";
  if (next < today) return "overdue";
  const diff = (Date.parse(next) - Date.parse(today)) / 86_400_000;
  return diff <= soonDays ? "soon" : "ok";
}

/** Nederlandse foutmelding voor Postgres/PostgREST-fouten, zonder interne details te lekken. */
export function friendlyDbError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return "Onbekende fout";
  const msg = err.message ?? "";
  if (err.code === "P0001" || err.code === "P0002" || err.code === "42501" || err.code === "22023" || err.code === "23514") {
    // Eigen (Nederlandstalige) meldingen uit de database-functies.
    if (/^[A-Z][^\n]{3,160}$/.test(msg) && !/violates|relation|column|syntax/i.test(msg)) return msg;
  }
  if (err.code === "42501" || /row-level security/i.test(msg)) return "Je hebt geen toestemming voor deze actie.";
  if (err.code === "23505") return "Dit bestaat al.";
  if (err.code === "23514") return "Ongeldige invoer.";
  return "De actie is mislukt. Probeer het opnieuw.";
}
