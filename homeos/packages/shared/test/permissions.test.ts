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
    expect(permissionForConnectorRoute("GET", "v1/automations")).toBe("view");
    expect(permissionForConnectorRoute("POST", "v1/automations")).toBe("manage_automations");
    expect(permissionForConnectorRoute("POST", "v1/automations/abc/run")).toBe("control");
    expect(permissionForConnectorRoute("DELETE", "v1/automations/abc")).toBe("manage_automations");
    expect(permissionForConnectorRoute("POST", "v1/notifications/read")).toBe("view");
    expect(permissionForConnectorRoute("PUT", "v1/notifications/preferences")).toBe("manage_household");
    expect(can("member", "manage_automations")).toBe(false);
    expect(permissionForConnectorRoute("GET", "v1/integrations")).toBe("view");
    expect(permissionForConnectorRoute("POST", "v1/integrations/hue/pair")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/hue/001788fffe123456")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/integrations/solaredge")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/integrations/daikin/complete")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/daikin")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/integrations/tuya")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/integrations/matter/commission")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/matter/nodes/1000")).toBe("manage_devices");
  });

  it("maakt veilige kamer-slugs", () => {
    expect(roomSlug("Kinderkamer Émma")).toBe("kinderkamer-emma");
    expect(roomSlug("!!!")).toBe("kamer");
  });

  it("camerabeelden alleen voor leden en hoger; camera's toevoegen alleen voor beheerders", () => {
    expect(can("guest", "view_cameras")).toBe(false);
    expect(can("member", "view_cameras")).toBe(true);
    expect(permissionForConnectorRoute("GET", "v1/cameras/tapo-abcdef%3Acamera/stream")).toBe("view_cameras");
    expect(permissionForConnectorRoute("GET", "v1/cameras")).toBe("view_cameras");
    expect(permissionForConnectorRoute("POST", "v1/cameras/x/stream")).toBeNull();
    expect(permissionForConnectorRoute("POST", "v1/integrations/tapo")).toBe("manage_devices");
    expect(permissionForConnectorRoute("GET", "v1/integrations/tapo")).toBeNull();
    expect(permissionForConnectorRoute("POST", "v1/integrations/webos/pair")).toBe("manage_devices");
    expect(permissionForConnectorRoute("POST", "v1/integrations/googlehome/start")).toBe("manage_devices");
    expect(permissionForConnectorRoute("PUT", "v1/integrations/googlehome/devices")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/googlehome")).toBe("manage_devices");
    expect(permissionForConnectorRoute("GET", "v1/integrations/googlehome/devices")).toBeNull();
    expect(permissionForConnectorRoute("PUT", "v1/integrations/googlehome")).toBeNull();
    expect(permissionForConnectorRoute("POST", "v1/integrations/icloud")).toBe("manage_devices");
    expect(permissionForConnectorRoute("PUT", "v1/integrations/icloud/calendars")).toBe("manage_devices");
    expect(permissionForConnectorRoute("GET", "v1/integrations/icloud")).toBeNull();
    expect(permissionForConnectorRoute("GET", "v1/calendar/events")).toBe("view");
    expect(permissionForConnectorRoute("POST", "v1/calendar/events")).toBeNull();
    expect(permissionForConnectorRoute("PUT", "v1/integrations/shortcuts")).toBe("manage_devices");
    expect(permissionForConnectorRoute("DELETE", "v1/integrations/shortcuts")).toBeNull();
  });
});

