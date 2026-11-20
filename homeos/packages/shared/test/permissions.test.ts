import { describe, expect, it } from "vitest";
import { can, permissionForConnectorRoute, roomSlug } from "../src";

describe("rollen en rechten", () => {
  it("volgt de rangorde owner > admin > member > guest", () => {
    expect(can("guest", "view")).toBe(true);
    expect(can("guest", "control")).toBe(false);
    expect(can("member", "control")).toBe(true);
    expect(can("member", "manage_devices")).toBe(false);
    expect(can("admin", "manage_members")).toBe(true);
    expect(can("owner", "manage_household")).toBe(true);
    expect(can(null, "view")).toBe(false);
  });

  it("koppelt connector-endpoints aan rechten", () => {
    expect(permissionForConnectorRoute("GET", "v1/snapshot")).toBe("view");
    expect(permissionForConnectorRoute("GET", "v1/audit")).toBe("view_audit");
    expect(permissionForConnectorRoute("POST", "v1/devices/a%3Ab/commands")).toBe("control");
    expect(permissionForConnectorRoute("POST", "v1/emergency-stop")).toBe("control");
    expect(permissionForConnectorRoute("DELETE", "v1/devices/a%3Ab")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/rooms")).toBe("manage_rooms");
    expect(permissionForConnectorRoute("POST", "v1/onbekend")).toBeNull();
    expect(permissionForConnectorRoute("GET", "v1/integrations")).toBe("view");
    expect(permissionForConnectorRoute("POST", "v1/integrations/hue/pair")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/hue/001788fffe123456")).toBe("manage_devices");
  });

  it("maakt veilige kamer-slugs", () => {
    expect(roomSlug("Kinderkamer Émma")).toBe("kinderkamer-emma");
    expect(roomSlug("!!!")).toBe("kamer");
  });
});
