"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Link2, Link2Off, Search } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, ApiError, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface PairedBridge {
  bridgeId: string;
  host: string;
  name: string;
  pairedAt: string;
  health: AdapterHealth | null;
}
interface Found {
  id: string;
  host: string;
  paired: boolean;
}

const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", not_configured: "neutral" } as const;

export function HueCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [paired, setPaired] = useState<PairedBridge[]>([]);
  const [found, setFound] = useState<Found[] | null>(null);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPaired((await api<{ hue: PairedBridge[] }>(connectorPath("v1/integrations"))).hue);
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const discover = async () => {
    setBusy("discover");
    try {
      const r = await api<{ bridges: Found[]; message: string | null }>(connectorPath("v1/integrations/hue/discover"), { method: "POST" });
      setFound(r.bridges);
      setHint(r.message ?? (r.bridges.length ? null : "Geen bridge gevonden. Vul het IP-adres handmatig in (Hue-app → Instellingen → Bridges → i)."));
    } finally {
      setBusy(null);
    }
  };

  const pair = async (ip: string) => {
    setBusy(ip);
    setHint(null);
    try {
      const r = await api<{ bridge: { name: string } }>(connectorPath("v1/integrations/hue/pair"), { method: "POST", body: JSON.stringify({ host: ip }) });
      toast.push({ title: `${r.bridge.name} gekoppeld`, description: "De lampen zijn toegevoegd aan HomeOS.", tone: "success" });
      setFound(null);
      setHost("");
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "LINK_BUTTON_NOT_PRESSED") setHint(`Druk op de ronde link-knop bovenop de bridge (${ip}) en klik binnen 30 seconden nogmaals op Koppelen.`);
      else toast.push({ title: "Koppelen mislukt", description: err.message, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const unpair = async (b: PairedBridge) => {
    if (!confirm(`${b.name} ontkoppelen? De lampen worden uit HomeOS verwijderd en de sleutel wordt gewist.`)) return;
    setBusy(b.bridgeId);
    try {
      await api(connectorPath(`v1/integrations/hue/${b.bridgeId}`), { method: "DELETE" });
      toast.push({ title: "Bridge ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard title="Philips Hue" description="Officiële Hue Bridge API · lokaal, zonder cloud" icon={Lightbulb} testId="hue-card">
      {paired.length === 0 && <p className="text-sm text-muted">Nog geen Hue Bridge gekoppeld.</p>}
      <ul className="space-y-2">
        {paired.map((b) => (
          <li key={b.bridgeId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{b.name}</p>
              <p className="truncate text-[11px] text-muted">
                {b.host} · gekoppeld {formatDateTime(b.pairedAt)} · {b.health?.message ?? "—"}
              </p>
            </div>
            <Badge tone={HEALTH_TONE[b.health?.status ?? "not_configured"]}>{b.health?.status ?? "onbekend"}</Badge>
            {manage && (
              <Button size="icon-sm" variant="ghost" disabled={!!busy} onClick={() => void unpair(b)} aria-label={`${b.name} ontkoppelen`}>
                <Link2Off />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <Button variant="secondary" size="sm" disabled={!live || !!busy} onClick={() => void discover()}>
            <Search /> {busy === "discover" ? "Zoeken…" : "Bridge zoeken"}
          </Button>
          {found?.filter((b) => !b.paired).map((b) => (
            <div key={b.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                Hue Bridge <span className="text-muted">{b.host}</span>
              </span>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void pair(b.host)}>
                <Link2 /> {busy === b.host ? "Koppelen…" : "Koppelen"}
              </Button>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (host.trim()) void pair(host.trim());
            }}
          >
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Of IP-adres, bijv. 192.168.1.20" inputMode="decimal" maxLength={15} aria-label="IP-adres van de bridge" disabled={!live} />
            <Button type="submit" disabled={!live || !host.trim() || !!busy}>
              Koppelen
            </Button>
          </form>
          {hint && <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent-soft">{hint}</p>}
          <p className="text-[11px] text-muted">
            De sleutel van de bridge wordt versleuteld op je laptop bewaard en verlaat je netwerk nooit. Op macOS vraagt het systeem mogelijk om toestemming voor “lokaal netwerk”: sta dit toe voor Terminal/Node.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
