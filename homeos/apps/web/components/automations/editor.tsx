"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Card, Input } from "@homeos/ui";
import type { Device, Scene } from "@homeos/shared";
import type { Action, AutomationInput, Condition, Trigger } from "./types";

const sel = "h-10 w-full rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm text-fg";
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function DayPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAYS.map((d, i) => (
        <button
          type="button"
          key={d}
          onClick={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())}
          aria-pressed={value.includes(i)}
          className={`rounded-lg border px-2 py-1 text-xs ${value.includes(i) ? "border-accent bg-accent/15 text-fg" : "border-white/[0.08] text-muted"}`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function DeviceSelect({ devices, value, onChange, allowAny, filter }: { devices: Device[]; value: string; onChange(v: string): void; allowAny?: boolean; filter?: (d: Device) => boolean }) {
  return (
    <select className={sel} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Apparaat">
      <option value="">Kies een apparaat…</option>
      {allowAny && <option value="*">Willekeurig apparaat</option>}
      {devices.filter(filter ?? (() => true)).map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
          {d.demo ? " (DEMO)" : ""}
        </option>
      ))}
    </select>
  );
}

const SAFE = (d: Device) => !["doorbell", "bridge", "energy_meter", "solar_inverter"].includes(d.kind);

export function AutomationEditor({ initial, devices, scenes, onSave, onCancel, busy }: { initial: AutomationInput; devices: Device[]; scenes: Scene[]; onSave(a: AutomationInput): void; onCancel(): void; busy: boolean }) {
  const [a, setA] = useState<AutomationInput>(initial);
  const set = (p: Partial<AutomationInput>) => setA((cur) => ({ ...cur, ...p }));
  const t = a.trigger;

  const triggerFor = (type: Trigger["type"]): Trigger => {
    switch (type) {
      case "time":
        return { type, at: "20:00", days: [] };
      case "device_state":
        return { type, deviceId: "", property: "on", op: "eq", value: true };
      case "energy":
        return { type, metric: "productionW", op: "gt", value: 2500 };
      case "device_offline":
        return { type, deviceId: "*", forMinutes: 30 };
      default:
        return { type: "manual" };
    }
  };
  const newAction = (type: Action["type"]): Action => {
    switch (type) {
      case "scene":
        return { type, sceneId: scenes[0]?.id ?? "" };
      case "device_command":
        return { type, deviceId: "", command: { type: "set_power", on: true } };
      case "notify":
        return { type, category: "automation", title: "", message: "" };
      case "report":
        return { type, kind: "evening" };
      default:
        return { type: "delay", minutes: 5 };
    }
  };
  const newCondition = (type: Condition["type"]): Condition => {
    switch (type) {
      case "time_between":
        return { type, from: "18:00", to: "23:00" };
      case "weekday":
        return { type, days: [1, 2, 3, 4, 5] };
      case "device_online":
        return { type, deviceId: "" };
      case "energy":
        return { type, metric: "productionW", op: "gt", value: 1000 };
      default:
        return { type: "device_state", deviceId: "", property: "on", op: "eq", value: true };
    }
  };
  const updAction = (i: number, v: Action) => set({ actions: a.actions.map((x, j) => (j === i ? v : x)) });
  const updCond = (i: number, v: Condition) => set({ conditions: a.conditions.map((x, j) => (j === i ? v : x)) });

  return (
    <Card className="p-5" data-testid="automation-editor">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Automatisering</h2>
        <Button size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Sluiten">
          <X />
        </Button>
      </div>
      <form
        className="mt-4 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(a);
        }}
      >
        <label className="block text-xs text-muted">
          Naam
          <Input value={a.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className="mt-1" required aria-label="Naam automatisering" />
        </label>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Wanneer (trigger)</h3>
          <select className={sel} value={t.type} onChange={(e) => set({ trigger: triggerFor(e.target.value as Trigger["type"]) })} aria-label="Trigger">
            <option value="time">Op een tijdstip</option>
            <option value="device_state">Als een apparaat iets doet</option>
            <option value="energy">Bij een energie-drempel</option>
            <option value="device_offline">Als een apparaat offline is</option>
            <option value="manual">Alleen handmatig</option>
          </select>
          {t.type === "time" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="time" value={t.at} onChange={(e) => set({ trigger: { ...t, at: e.target.value } })} aria-label="Tijdstip" />
              <DayPicker value={t.days} onChange={(days) => set({ trigger: { ...t, days } })} />
              <p className="text-[11px] text-muted sm:col-span-2">Geen dagen gekozen = elke dag. Een gemist tijdstip (laptop uit) wordt niet alsnog uitgevoerd.</p>
            </div>
          )}
          {t.type === "device_state" && (
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <DeviceSelect devices={devices} value={t.deviceId} onChange={(deviceId) => set({ trigger: { ...t, deviceId } })} />
              </div>
              <select className={sel} value={t.property} onChange={(e) => set({ trigger: { ...t, property: e.target.value as typeof t.property, value: e.target.value === "on" ? true : 0, op: e.target.value === "on" ? "eq" : "gt" } })} aria-label="Eigenschap">
                <option value="on">aan/uit</option>
                <option value="powerW">vermogen (W)</option>
                <option value="productionW">opwek (W)</option>
                <option value="roomTempC">kamertemperatuur (°C)</option>
                <option value="brightness">helderheid (%)</option>
              </select>
              {t.property === "on" ? (
                <select className={sel} value={String(t.value)} onChange={(e) => set({ trigger: { ...t, op: "eq", value: e.target.value === "true" } })} aria-label="Waarde">
                  <option value="true">gaat aan</option>
                  <option value="false">gaat uit</option>
                </select>
              ) : (
                <div className="flex gap-1">
                  <select className={sel} value={t.op} onChange={(e) => set({ trigger: { ...t, op: e.target.value as "gt" | "lt" } })} aria-label="Vergelijking">
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                  </select>
                  <Input type="number" value={Number(t.value)} onChange={(e) => set({ trigger: { ...t, value: Number(e.target.value) } })} aria-label="Drempel" />
                </div>
              )}
            </div>
          )}
          {t.type === "energy" && (
            <div className="grid gap-2 sm:grid-cols-3">
              <select className={sel} value={t.metric} onChange={(e) => set({ trigger: { ...t, metric: e.target.value as typeof t.metric } })} aria-label="Meting">
                <option value="productionW">zonne-opwek</option>
                <option value="consumptionW">verbruik</option>
                <option value="gridImportW">netafname</option>
                <option value="gridExportW">teruglevering</option>
              </select>
              <select className={sel} value={t.op} onChange={(e) => set({ trigger: { ...t, op: e.target.value as "gt" | "lt" } })} aria-label="Vergelijking">
                <option value="gt">stijgt boven</option>
                <option value="lt">daalt onder</option>
              </select>
              <Input type="number" min={0} value={t.value} onChange={(e) => set({ trigger: { ...t, value: Number(e.target.value) } })} aria-label="Watt" />
            </div>
          )}
          {t.type === "device_offline" && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <DeviceSelect devices={devices} value={t.deviceId} onChange={(deviceId) => set({ trigger: { ...t, deviceId } })} allowAny />
              </div>
              <Input type="number" min={1} max={1440} value={t.forMinutes} onChange={(e) => set({ trigger: { ...t, forMinutes: Number(e.target.value) } })} aria-label="Minuten offline" />
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Alleen als (voorwaarden)</h3>
          {a.conditions.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                {c.type === "time_between" && (
                  <>
                    <span className="self-center text-xs text-muted">Tussen</span>
                    <Input type="time" value={c.from} onChange={(e) => updCond(i, { ...c, from: e.target.value })} aria-label="Van" />
                    <Input type="time" value={c.to} onChange={(e) => updCond(i, { ...c, to: e.target.value })} aria-label="Tot" />
                  </>
                )}
                {c.type === "weekday" && <DayPicker value={c.days} onChange={(days) => updCond(i, { ...c, days })} />}
                {c.type === "device_online" && (
                  <div className="sm:col-span-3">
                    <DeviceSelect devices={devices} value={c.deviceId} onChange={(deviceId) => updCond(i, { ...c, deviceId })} />
                  </div>
                )}
                {c.type === "energy" && (
                  <>
                    <select className={sel} value={c.metric} onChange={(e) => updCond(i, { ...c, metric: e.target.value as typeof c.metric })} aria-label="Meting">
                      <option value="productionW">zonne-opwek</option>
                      <option value="consumptionW">verbruik</option>
                    </select>
                    <select className={sel} value={c.op} onChange={(e) => updCond(i, { ...c, op: e.target.value as "gt" | "lt" })} aria-label="Vergelijking">
                      <option value="gt">&gt;</option>
                      <option value="lt">&lt;</option>
                    </select>
                    <Input type="number" value={c.value} onChange={(e) => updCond(i, { ...c, value: Number(e.target.value) })} aria-label="Watt" />
                  </>
                )}
                {c.type === "device_state" && (
                  <>
                    <DeviceSelect devices={devices} value={c.deviceId} onChange={(deviceId) => updCond(i, { ...c, deviceId })} />
                    <select className={sel} value={String(c.value)} onChange={(e) => updCond(i, { ...c, property: "on", op: "eq", value: e.target.value === "true" })} aria-label="Toestand">
                      <option value="true">staat aan</option>
                      <option value="false">staat uit</option>
                    </select>
                  </>
                )}
              </div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => set({ conditions: a.conditions.filter((_, j) => j !== i) })} aria-label="Voorwaarde verwijderen">
                <Trash2 />
              </Button>
            </div>
          ))}
          <select className={sel} value="" onChange={(e) => e.target.value && set({ conditions: [...a.conditions, newCondition(e.target.value as Condition["type"])] })} aria-label="Voorwaarde toevoegen">
            <option value="">+ Voorwaarde toevoegen…</option>
            <option value="time_between">Tijdvenster</option>
            <option value="weekday">Dagen van de week</option>
            <option value="device_online">Apparaat is online</option>
            <option value="device_state">Apparaat staat aan/uit</option>
            <option value="energy">Energie-drempel</option>
          </select>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Dan (acties)</h3>
          {a.actions.map((x, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                {x.type === "scene" && (
                  <select className={`${sel} sm:col-span-3`} value={x.sceneId} onChange={(e) => updAction(i, { ...x, sceneId: e.target.value })} aria-label="Scène">
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        Scène: {s.name}
                        {s.demo ? " (DEMO)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {x.type === "device_command" && (
                  <>
                    <div className="sm:col-span-2">
                      <DeviceSelect devices={devices} value={x.deviceId} onChange={(deviceId) => updAction(i, { ...x, deviceId })} filter={(d) => SAFE(d) && d.capabilities.includes("onoff")} />
                    </div>
                    <select className={sel} value={x.command.type === "set_power" && x.command.on ? "on" : "off"} onChange={(e) => updAction(i, { ...x, command: { type: "set_power", on: e.target.value === "on" } })} aria-label="Opdracht">
                      <option value="on">aanzetten</option>
                      <option value="off">uitzetten</option>
                    </select>
                  </>
                )}
                {x.type === "notify" && (
                  <>
                    <Input value={x.title} onChange={(e) => updAction(i, { ...x, title: e.target.value })} placeholder="Titel van de melding" maxLength={120} className="sm:col-span-2" aria-label="Titel melding" required />
                    <select className={sel} value={x.category} onChange={(e) => updAction(i, { ...x, category: e.target.value as typeof x.category })} aria-label="Categorie">
                      <option value="automation">Automatisering</option>
                      <option value="energy">Energie</option>
                      <option value="connection">Verbinding</option>
                      <option value="maintenance">Onderhoud</option>
                      <option value="security">Beveiliging</option>
                    </select>
                    <Input value={x.message} onChange={(e) => updAction(i, { ...x, message: e.target.value })} placeholder="Tekst ({device}, {lastSeen}, {productionW}, {time})" maxLength={1000} className="sm:col-span-3" aria-label="Tekst melding" />
                  </>
                )}
                {x.type === "report" && (
                  <select className={`${sel} sm:col-span-3`} value={x.kind} onChange={(e) => updAction(i, { ...x, kind: e.target.value as "evening" | "energy" })} aria-label="Rapport">
                    <option value="evening">Jarvis: avondoverzicht</option>
                    <option value="energy">Jarvis: energieoverzicht</option>
                  </select>
                )}
                {x.type === "delay" && (
                  <div className="flex items-center gap-2 sm:col-span-3">
                    <Input type="number" min={1} max={60} value={x.minutes} onChange={(e) => updAction(i, { ...x, minutes: Number(e.target.value) })} className="w-24" aria-label="Minuten wachten" />
                    <span className="text-xs text-muted">minuten wachten (max. 60)</span>
                  </div>
                )}
              </div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => set({ actions: a.actions.filter((_, j) => j !== i) })} aria-label="Actie verwijderen">
                <Trash2 />
              </Button>
            </div>
          ))}
          <select className={sel} value="" onChange={(e) => e.target.value && set({ actions: [...a.actions, newAction(e.target.value as Action["type"])] })} aria-label="Actie toevoegen">
            <option value="">+ Actie toevoegen…</option>
            {scenes.length > 0 && <option value="scene">Scène activeren</option>}
            <option value="device_command">Apparaat aan/uit</option>
            <option value="notify">Melding versturen</option>
            <option value="report">Jarvis laten rapporteren</option>
            <option value="delay">Wachten</option>
          </select>
          <p className="text-[11px] text-muted">Deurbel, energiemeters en bridges kunnen niet door automatiseringen bediend worden.</p>
        </section>

        <section className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Afkoeltijd (minuten tussen twee runs)
            <Input type="number" min={0} max={1440} value={a.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })} className="mt-1" />
          </label>
          <label className="text-xs text-muted">
            Maximaal aantal runs per dag
            <Input type="number" min={1} max={100} value={a.maxRunsPerDay} onChange={(e) => set({ maxRunsPerDay: Number(e.target.value) })} className="mt-1" />
          </label>
        </section>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !a.name.trim() || a.actions.length === 0}>
            <Plus /> Opslaan
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuleren
          </Button>
        </div>
      </form>
    </Card>
  );
}
