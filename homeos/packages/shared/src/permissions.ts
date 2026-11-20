import { z } from "zod";

export const HOUSEHOLD_ROLES = ["owner", "admin", "member", "guest"] as const;
export const HouseholdRoleSchema = z.enum(HOUSEHOLD_ROLES);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  member: "Lid",
  guest: "Gast",
};

export type Permission =
  | "view" // dashboard en status bekijken
  | "control" // apparaten bedienen, scènes, noodstop
  | "family_write" // agenda, taken, boodschappen, notities, onderhoud
  | "manage_devices" // apparaten toevoegen/verwijderen/hernoemen/verplaatsen, connector koppelen
  | "manage_rooms"
  | "view_audit"
  | "manage_members"
  | "manage_household";

const RANK: Record<HouseholdRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

const MIN_ROLE: Record<Permission, HouseholdRole> = {
  view: "guest",
  control: "member",
  family_write: "member",
  manage_devices: "admin",
  manage_rooms: "admin",
  view_audit: "admin",
  manage_members: "admin",
  manage_household: "admin",
};

/** Moet overeenkomen met de RLS-policies in supabase/migrations. */
export function can(role: HouseholdRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[permission]];
}

/** Welke permissie is nodig voor een connector-endpoint (pad zonder leidende slash). */
export function permissionForConnectorRoute(method: string, path: string): Permission | null {
  const m = method.toUpperCase();
  if (m === "GET") {
    if (/^v1\/audit$/.test(path)) return "view_audit";
    if (/^v1\/(snapshot|devices\/available|energy\/(summary|history)|events)$/.test(path)) return "view";
    return null;
  }
  if (/^v1\/devices\/[^/]+\/commands$/.test(path)) return "control";
  if (/^v1\/scenes\/[^/]+\/activate$/.test(path)) return "control";
  if (/^v1\/emergency-stop$/.test(path)) return "control";
  if (/^v1\/(sync|devices\/[^/]+\/sync)$/.test(path)) return "control";
  if (/^v1\/(discover|devices\/[^/]+\/add|devices\/[^/]+)$/.test(path)) return "manage_devices";
  if (/^v1\/rooms(\/[^/]+)?$/.test(path)) return "manage_rooms";
  return null;
}

export function roomSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "kamer"
  );
}
