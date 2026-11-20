import { describe, expect, it } from "vitest";
import { EventInputSchema, friendlyDbError, InviteSchema, maintenanceDue, TaskInputSchema } from "../src";

describe("invoervalidatie", () => {
  it("valideert taken en zet lege velden om naar null", () => {
    expect(TaskInputSchema.parse({ title: " Afwas ", dueDate: "", assignedTo: "" })).toMatchObject({ title: "Afwas", dueDate: null, assignedTo: null });
    expect(TaskInputSchema.safeParse({ title: "" }).success).toBe(false);
  });
  it("weigert afspraken die eindigen voor de start", () => {
    expect(EventInputSchema.safeParse({ title: "x", startsAt: "2026-01-02T10:00:00Z", endsAt: "2026-01-02T09:00:00Z" }).success).toBe(false);
  });
  it("weigert eigenaar-uitnodigingen", () => {
    expect(InviteSchema.safeParse({ email: "a@b.nl", role: "owner" }).success).toBe(false);
  });
});

describe("onderhoud", () => {
  it("bepaalt verlopen en binnenkort", () => {
    expect(maintenanceDue("2026-01-01", "2026-02-01")).toBe("overdue");
    expect(maintenanceDue("2026-02-10", "2026-02-01")).toBe("soon");
    expect(maintenanceDue("2026-06-10", "2026-02-01")).toBe("ok");
    expect(maintenanceDue(null, "2026-02-01")).toBe("none");
  });
});

describe("foutmeldingen", () => {
  it("toont eigen meldingen maar lekt geen interne details", () => {
    expect(friendlyDbError({ code: "P0002", message: "Er bestaat nog geen account met dit e-mailadres" })).toBe("Er bestaat nog geen account met dit e-mailadres");
    expect(friendlyDbError({ code: "42501", message: 'new row violates row-level security policy for table "rooms"' })).toBe("Je hebt geen toestemming voor deze actie.");
    expect(friendlyDbError({ code: "XX000", message: "internal" })).toBe("De actie is mislukt. Probeer het opnieuw.");
  });
});
