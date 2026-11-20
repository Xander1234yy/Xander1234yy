"use client";

import { useCallback, useEffect, useState } from "react";
import { Cctv, Trash2 } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface CameraRow {
  cameraId: string;
  host: string;
  name: string;
  model: string;
  addedAt: string;
  health: AdapterHealth | null;
}
const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", not_configured: "neutral" } as const;
const HEALTH_LABEL = { ok: "verbonden", degraded: "onbereikbaar", down: "fout", not_configured: "niet ingesteld" } as const;

/** Tapo-camera toevoegen via het officiële camera-account (ONVIF/RTSP), alleen camera's op netstroom. */
export function TapoCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [rows, setRows] = useState<CameraRow[]>([]);
  const [form, setForm] = useState({ host: "", username: "", password: "", name: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ tapo?: { cameras: CameraRow[] } }>(connectorPath("v1/integrations"));
      setRows(r.tapo?.cameras ?? []);
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const add = async () => {
    setBusy(true);
    try {
      const r = await api<{ camera: { name: string } }>(connectorPath("v1/integrations/tapo"), { method: "POST", body: JSON.stringify({ ...form, name: form.name || undefined }) });
      toast.push({ title: `${r.camera.name} toegevoegd`, description: "De camera staat nu bij Beveiliging.", tone: "success" });
      setForm({ host: "", username: "", password: "", name: "" });
      await load();
    } catch (e) {
      toast.push({ title: "Toevoegen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CameraRow) => {
    if (!confirm(`${c.name} verwijderen? Het camera-account wordt gewist uit HomeOS.`)) return;
    try {
      await api(connectorPath(`v1/integrations/tapo/${c.cameraId}`), { method: "DELETE" });
      toast.push({ title: "Camera verwijderd", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Verwijderen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <SectionCard title="Tapo-camera's" description="Officieel camera-account (ONVIF/RTSP) · lokaal, alleen op netstroom" icon={Cctv} testId="tapo-card">
      {rows.length === 0 && <p className="text-sm text-muted">Nog geen camera toegevoegd.</p>}
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.cameraId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{c.name}</p>
              <p className="truncate text-[11px] text-muted">
                {c.model} · {c.host} · toegevoegd {formatDateTime(c.addedAt)}
              </p>
              {c.health?.status === "down" && <p className="text-[11px] text-danger">{c.health.message}</p>}
            </div>
            <Badge tone={HEALTH_TONE[c.health?.status ?? "not_configured"]}>{HEALTH_LABEL[c.health?.status ?? "not_configured"]}</Badge>
            {manage && (
              <Button size="icon-sm" variant="ghost" onClick={() => void remove(c)} aria-label={`${c.name} verwijderen`}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>Tapo-app → camera → Instellingen → Geavanceerd → Camera-account: kies een gebruikersnaam en wachtwoord (niet je Tapo-wachtwoord).</li>
            <li>Zoek het IP-adres op: Tapo-app → camera → Instellingen → Apparaatinfo.</li>
            <li>Installeer ffmpeg op je Mac voor beeld: <code className="rounded bg-white/[0.06] px-1">brew install ffmpeg</code></li>
          </ol>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input value={form.host} onChange={set("host")} placeholder="IP-adres, bijv. 192.168.68.40" inputMode="decimal" maxLength={15} aria-label="IP-adres van de camera" disabled={!live} />
            <Input value={form.name} onChange={set("name")} placeholder="Naam (optioneel), bijv. Tuin" maxLength={80} aria-label="Naam van de camera" disabled={!live} />
            <Input value={form.username} onChange={set("username")} placeholder="Gebruikersnaam camera-account" maxLength={64} autoComplete="off" aria-label="Gebruikersnaam camera-account" disabled={!live} />
            <Input value={form.password} onChange={set("password")} type="password" placeholder="Wachtwoord camera-account" maxLength={128} autoComplete="new-password" aria-label="Wachtwoord camera-account" disabled={!live} />
            <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !form.host.trim() || !form.username.trim() || !form.password}>
              {busy ? "Verbinden…" : "Camera toevoegen"}
            </Button>
          </form>
          <p className="text-[11px] text-muted">
            Het camera-account wordt versleuteld op je laptop bewaard. Beelden gaan nooit via een cloud en worden niet opgeslagen. Camera&apos;s op batterij (en de deurbel op batterij) ondersteunen dit niet.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
