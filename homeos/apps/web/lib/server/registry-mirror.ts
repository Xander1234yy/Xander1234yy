import "server-only";
import type { DeviceEvent, Snapshot } from "@homeos/shared";
import { createSupabaseServer } from "@/lib/supabase/server";

const lastMirror = new Map<string, number>();
const MIN_INTERVAL_MS = 30_000;

/**
 * Spiegelt de apparaatregistry van de connector naar Supabase (devices, device_states, connector_status),
 * zodat het huishouden een centrale, historische registry heeft. Gebeurt met de sessie van een beheerder
 * (RLS: alleen beheerders mogen apparaten schrijven). Fase 7 vervangt dit door een directe, uitgaande
 * connector→cloud-koppeling.
 */
export async function mirrorSnapshot(householdId: string, snapshot: Snapshot, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastMirror.get(householdId) ?? 0) < MIN_INTERVAL_MS) return;
  lastMirror.set(householdId, now);
  try {
    const supabase = await createSupabaseServer();
    const { data: rooms } = await supabase.from("rooms").select("id, slug").eq("household_id", householdId);
    const roomId = new Map((rooms ?? []).map((r) => [r.slug as string, r.id as string]));

    const rows = snapshot.devices.map((d) => ({
      household_id: householdId,
      external_id: d.id,
      name: d.name,
      brand: d.brand,
      model: d.model,
      kind: d.kind,
      room_id: d.roomId ? (roomId.get(d.roomId) ?? null) : null,
      capabilities: d.capabilities,
      status: d.status,
      last_seen: d.lastSeen,
      last_error: d.error,
      demo: d.demo,
      refresh_interval_ms: d.refreshIntervalMs ?? null,
    }));
    if (rows.length) {
      const { data: saved, error } = await supabase.from("devices").upsert(rows, { onConflict: "household_id,external_id" }).select("id, external_id");
      if (error) throw error;
      const idByExternal = new Map((saved ?? []).map((r) => [r.external_id as string, r.id as string]));
      const states = snapshot.devices
        .filter((d) => idByExternal.has(d.id))
        .map((d) => ({ device_id: idByExternal.get(d.id)!, household_id: householdId, state: d.state, state_updated_at: d.stateUpdatedAt }));
      if (states.length) await supabase.from("device_states").upsert(states, { onConflict: "device_id" });
      const keep = rows.map((r) => `"${r.external_id.replace(/"/g, "")}"`).join(",");
      await supabase.from("devices").delete().eq("household_id", householdId).not("external_id", "in", `(${keep})`);
    } else {
      await supabase.from("devices").delete().eq("household_id", householdId);
    }

    await supabase
      .from("connector_status")
      .update({
        online: true,
        last_seen_at: new Date().toISOString(),
        version: snapshot.connector.version,
        demo_mode: snapshot.connector.demoMode,
        emergency_stop: snapshot.connector.emergencyStop,
      })
      .eq("household_id", householdId)
      .eq("connector_id", snapshot.connector.connectorId);
  } catch {
    // Spiegelen is best-effort; de connector blijft de bron voor live status.
    lastMirror.delete(householdId);
  }
}

/** Legt een apparaatgebeurtenis (bijv. deurbel) vast in de geschiedenis van het huishouden. */
export async function mirrorEvent(householdId: string, event: DeviceEvent): Promise<void> {
  try {
    const supabase = await createSupabaseServer();
    const { data: device } = await supabase.from("devices").select("id").eq("household_id", householdId).eq("external_id", event.deviceId).maybeSingle();
    await supabase.from("device_events").insert({
      household_id: householdId,
      device_id: (device?.id as string | undefined) ?? null,
      type: event.type,
      message: event.message.slice(0, 500),
      occurred_at: event.at,
      demo: event.demo,
    });
  } catch {
    /* best-effort */
  }
}
