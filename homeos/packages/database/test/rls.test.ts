import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let t: Db;
let owner: string, member: string, guest: string, outsider: string;
let home: string, otherHome: string;

beforeAll(async () => {
  t = await createTestDb();
  owner = await t.createUser("eigenaar@example.test", "Eigenaar");
  member = await t.createUser("lid@example.test");
  guest = await t.createUser("gast@example.test");
  outsider = await t.createUser("buiten@example.test");
  home = (await t.as<{ id: string }>(owner, "select public.create_household('Ons huis') as id"))[0]!.id;
  otherHome = (await t.as<{ id: string }>(outsider, "select public.create_household('Ander huis') as id"))[0]!.id;
  await t.as(owner, "select public.add_household_member($1, 'lid@example.test', 'member')", [home]);
  await t.as(owner, "select public.add_household_member($1, 'GAST@example.test', 'guest')", [home]);
}, 60_000);

describe("schema", () => {
  it("bevat alle verplichte tabellen met RLS aan", async () => {
    const rows = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    const tables = new Map(rows.rows.map((r) => [r.relname, r.relrowsecurity]));
    const required = [
      "profiles", "households", "household_members", "rooms", "devices", "device_integrations", "device_states",
      "device_events", "energy_readings", "automations", "automation_runs", "notifications", "family_tasks",
      "shopping_items", "calendar_events", "maintenance_records", "ai_conversations", "ai_messages", "audit_logs",
      "connector_status",
    ];
    for (const name of required) {
      expect(tables.has(name), name).toBe(true);
      expect(tables.get(name), `RLS op ${name}`).toBe(true);
    }
    // Iedere tabel in public heeft RLS
    expect([...tables.values()].every(Boolean)).toBe(true);
  });

  it("maakt automatisch een profiel aan bij registratie", async () => {
    const p = await t.as<{ display_name: string }>(owner, "select display_name from public.profiles where id = $1", [owner]);
    expect(p[0]?.display_name).toBe("Eigenaar");
    const p2 = await t.as<{ display_name: string }>(member, "select display_name from public.profiles where id = $1", [member]);
    expect(p2[0]?.display_name).toBe("lid");
  });

  it("weigert geheimen in integratieconfiguratie", async () => {
    await expect(
      t.as(owner, "insert into public.device_integrations (household_id, integration_type, display_name, config) values ($1, 'philips_hue', 'Hue', '{\"token\":\"x\"}')", [home]),
    ).rejects.toThrow(/no_secrets/);
    await t.as(owner, "insert into public.device_integrations (household_id, integration_type, display_name, config) values ($1, 'philips_hue', 'Hue', '{\"bridge_id\":\"abc\"}')", [home]);
  });
});

describe("huishoudens", () => {
  it("maakt standaardkamers en een eigenaar aan", async () => {
    const rooms = await t.as<{ slug: string }>(owner, "select slug from public.rooms where household_id = $1 order by sort_order", [home]);
    expect(rooms.map((r) => r.slug)).toEqual(["woonkamer", "keuken", "slaapkamer", "badkamer", "overig"]);
    const role = await t.as<{ r: string }>(owner, "select public.household_role($1) as r", [home]);
    expect(role[0]?.r).toBe("owner");
  });

  it("anonieme gebruikers zien niets", async () => {
    await expect(t.as(null, "select * from public.households")).rejects.toThrow(/permission denied/);
    await expect(t.as(null, "select public.create_household('x')")).rejects.toThrow(/permission denied/);
  });

  it("buitenstaanders zien andermans huishouden niet", async () => {
    const seen = await t.as<{ id: string }>(outsider, "select id from public.households");
    expect(seen.map((h) => h.id)).toEqual([otherHome]);
    expect(await t.as(outsider, "select * from public.rooms where household_id = $1", [home])).toEqual([]);
    expect(await t.as(outsider, "select * from public.household_member_list($1)", [home])).toEqual([]);
  });

  it("buitenstaanders kunnen niet schrijven in een ander huishouden", async () => {
    await expect(t.as(outsider, "insert into public.rooms (household_id, slug, name) values ($1, 'hack', 'Hack')", [home])).rejects.toThrow(/row-level security/);
    await expect(t.as(outsider, "insert into public.shopping_items (household_id, name) values ($1, 'x')", [home])).rejects.toThrow(/row-level security/);
    const upd = await t.as(outsider, "update public.households set name = 'Gehackt' where id = $1 returning id", [home]);
    expect(upd).toEqual([]);
  });

  it("leden zien elkaars profiel, buitenstaanders niet", async () => {
    expect((await t.as(member, "select id from public.profiles where id = $1", [owner])).length).toBe(1);
    expect((await t.as(outsider, "select id from public.profiles where id = $1", [owner])).length).toBe(0);
  });

  it("kan je eigen profiel wijzigen, niet dat van een ander", async () => {
    await t.as(member, "update public.profiles set display_name = 'Sam' where id = $1", [member]);
    const r = await t.as(member, "update public.profiles set display_name = 'X' where id = $1 returning id", [owner]);
    expect(r).toEqual([]);
  });
});

describe("rollen", () => {
  it("alleen beheerders mogen kamers wijzigen", async () => {
    await expect(t.as(member, "insert into public.rooms (household_id, slug, name) values ($1, 'zolder', 'Zolder')", [home])).rejects.toThrow(/row-level security/);
    await t.as(owner, "insert into public.rooms (household_id, slug, name) values ($1, 'zolder', 'Zolder')", [home]);
    const rooms = await t.as(member, "select id from public.rooms where household_id = $1", [home]);
    expect(rooms.length).toBe(6);
  });

  it("leden mogen familiegegevens schrijven, gasten alleen lezen", async () => {
    await t.as(member, "insert into public.shopping_items (household_id, name) values ($1, 'Melk')", [home]);
    await expect(t.as(guest, "insert into public.shopping_items (household_id, name) values ($1, 'Snoep')", [home])).rejects.toThrow(/row-level security/);
    const items = await t.as<{ name: string; created_by: string }>(guest, "select name, created_by from public.shopping_items where household_id = $1", [home]);
    expect(items).toEqual([{ name: "Melk", created_by: member }]);
  });

  it("created_by kan niet vervalst worden", async () => {
    await expect(
      t.as(member, "insert into public.family_tasks (household_id, title, created_by) values ($1, 'Afwas', $2)", [home, owner]),
    ).rejects.toThrow(/row-level security/);
  });

  it("taken alleen toewijzen aan leden van het huishouden", async () => {
    await t.as(member, "insert into public.family_tasks (household_id, title, assigned_to) values ($1, 'Vuilnis', $2)", [home, guest]);
    await expect(t.as(member, "insert into public.family_tasks (household_id, title, assigned_to) values ($1, 'Fout', $2)", [home, outsider])).rejects.toThrow(/lid van het huishouden/);
  });

  it("leden kunnen geen leden toevoegen; alleen de eigenaar kan beheerders maken", async () => {
    await expect(t.as(member, "select public.add_household_member($1, 'buiten@example.test', 'member')", [home])).rejects.toThrow(/Geen toestemming/);
    await expect(t.as(member, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'owner')", [home, member])).rejects.toThrow(/row-level security/);
    await expect(t.as(member, "update public.household_members set role = 'owner' where user_id = $1 returning user_id", [member])).resolves.toEqual([]);
  });

  it("laatste eigenaar kan niet weg; rollen wijzigen werkt", async () => {
    await expect(t.as(owner, "select public.remove_household_member($1, $2)", [home, owner])).rejects.toThrow(/laatste eigenaar/);
    await expect(t.as(owner, "select public.set_household_member_role($1, $2, 'member')", [home, owner])).rejects.toThrow(/minimaal één eigenaar/);
    await t.as(owner, "select public.set_household_member_role($1, $2, 'admin')", [home, member]);
    const list = await t.as<{ role: string; email: string }>(guest, "select role, email from public.household_member_list($1)", [home]);
    expect(list.map((m) => m.role)).toEqual(["owner", "admin", "guest"]);
    await expect(t.as(member, "select public.remove_household_member($1, $2)", [home, owner])).rejects.toThrow(/eigenaar/);
    await t.as(owner, "select public.set_household_member_role($1, $2, 'member')", [home, member]);
  });

  it("onbekend e-mailadres geeft een duidelijke fout", async () => {
    await expect(t.as(owner, "select public.add_household_member($1, 'bestaat@niet.test')", [home])).rejects.toThrow(/nog geen account/);
  });
});

describe("audit en privacy", () => {
  it("auditlog is alleen-toevoegen en alleen leesbaar voor beheerders", async () => {
    await t.as(member, "insert into public.audit_logs (household_id, action, ok) values ($1, 'device.command', true)", [home]);
    await expect(t.as(member, "insert into public.audit_logs (household_id, user_id, action, ok) values ($1, $2, 'vals', true)", [home, owner])).rejects.toThrow(/row-level security/);
    expect(await t.as(member, "select id from public.audit_logs where household_id = $1", [home])).toEqual([]);
    const ownerView = await t.as(owner, "select id from public.audit_logs where household_id = $1", [home]);
    expect(ownerView.length).toBeGreaterThan(1);
    await expect(t.as(owner, "delete from public.audit_logs where household_id = $1", [home])).rejects.toThrow(/permission denied/);
  });

  it("Jarvis-gesprekken zijn privé", async () => {
    const c = await t.as<{ id: string }>(member, "insert into public.ai_conversations (household_id, title) values ($1, 'Test') returning id", [home]);
    await t.as(member, "insert into public.ai_messages (conversation_id, household_id, role, content) values ($1, $2, 'user', 'hoi')", [c[0]!.id, home]);
    expect(await t.as(owner, "select id from public.ai_messages")).toEqual([]);
    expect((await t.as(member, "select id from public.ai_messages")).length).toBe(1);
    // Een ander lid kan niets in dit gesprek schrijven, het gesprek niet wissen en geen gesprek op naam van een ander aanmaken.
    await expect(t.as(owner, "insert into public.ai_messages (conversation_id, household_id, role, content) values ($1, $2, 'assistant', 'nep')", [c[0]!.id, home])).rejects.toThrow(/row-level security/);
    expect(await t.as(owner, "delete from public.ai_conversations where id = $1 returning id", [c[0]!.id])).toEqual([]);
    await expect(t.as(owner, "insert into public.ai_conversations (household_id, user_id, title) values ($1, $2, 'x')", [home, member])).rejects.toThrow(/row-level security/);
  });

  it("persoonlijke meldingen zijn alleen zichtbaar voor de ontvanger", async () => {
    await t.as(owner, "insert into public.notifications (household_id, user_id, category, title) values ($1, $2, 'system', 'Alleen voor lid')", [home, member]);
    await t.as(owner, "insert into public.notifications (household_id, category, title) values ($1, 'energy', 'Voor iedereen')", [home]);
    expect((await t.as(member, "select title from public.notifications where household_id = $1", [home])).length).toBe(2);
    expect((await t.as(guest, "select title from public.notifications where household_id = $1", [home])).length).toBe(1);
  });

  it("een connector hoort bij één huishouden", async () => {
    const cid = "5f2ec56c-c319-4167-b8d4-f5c866c539c3";
    await t.as(owner, "insert into public.connector_status (household_id, connector_id, linked_by) values ($1, $2, $3)", [home, cid, owner]);
    await expect(t.as(outsider, "insert into public.connector_status (household_id, connector_id) values ($1, $2)", [otherHome, cid])).rejects.toThrow(/unique|duplicate/);
  });
});

describe("migratie 2: klimaat", () => {
  it("accepteert airco-apparaten en weigert onbekende typen", async () => {
    await t.as(owner, "insert into public.devices (household_id, external_id, name, kind, refresh_interval_ms) values ($1, 'daikin-onecta:u1', 'Airco', 'climate', 600000)", [home]);
    await expect(t.as(owner, "insert into public.devices (household_id, external_id, name, kind) values ($1, 'x', 'X', 'raket')", [home])).rejects.toThrow(/kind_check/);
  });
});
