"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Badge, Button, Card, Input, cn } from "@homeos/ui";
import { effectiveStatus, type Device } from "@homeos/shared";
import { PageHeader, EmptyState } from "@/components/section";
import { DeviceCard } from "@/components/devices/device-card";
import { DeviceIcon, KIND_LABEL } from "@/components/devices/device-icon";
import { api, connectorPath, enc } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { Cpu } from "lucide-react";

type Filter = "all" | "online" | "problem";
interface Available {
  id: string;
  name: string;
  brand: string;
  model: string;
  kind: Device["kind"];
  suggestedRoomId: string | null;
  demo: boolean;
}

export default function DevicesPage() {
  const { snapshot, syncAll, pending, mutate } = useHome();
  const live = useLive();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [available, setAvailable] = useState<Available[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const devices = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (snapshot?.devices ?? [])
      .filter((d) => !term || `${d.name} ${d.brand} ${d.model}`.toLowerCase().includes(term))
      .filter((d) => {
        const s = effectiveStatus(d, live);
        return filter === "all" || (filter === "online" ? s === "ONLINE" : s !== "ONLINE");
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }, [snapshot, q, filter, live]);

  const scan = async () => {
    setScanning(true);
    try {
      const r = await api<{ devices: Available[] }>(connectorPath("v1/discover"), { method: "POST" });
      setAvailable(r.devices);
    } catch {
      setAvailable([]);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Apparaten"
        description="Alle gekoppelde apparaten, hun status en bediening."
        actions={
          <>
            <Button variant="secondary" onClick={() => void scan()} disabled={!live || scanning}>
              <Plus /> {scanning ? "Zoeken…" : "Apparaten zoeken"}
            </Button>
            <Button variant="secondary" onClick={() => void syncAll()} disabled={!live || pending.has("sync")}>
              <RefreshCw className={pending.has("sync") ? "animate-spin" : ""} /> Synchroniseren
            </Button>
          </>
        }
      />

      {available && (
        <Card className="mb-5 p-5">
          <h2 className="text-sm font-semibold">Gevonden, nog niet toegevoegd</h2>
          {available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Geen nieuwe apparaten gevonden. Echte integraties (Philips Hue e.a.) worden vanaf fase 3 toegevoegd.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {available.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                  <DeviceIcon kind={d.kind} className="size-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {d.name} {d.demo && <Badge tone="demo">Demo</Badge>}
                    </p>
                    <p className="text-[11px] text-muted">
                      {KIND_LABEL[d.kind]} · {d.brand} {d.model}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (await mutate(`v1/devices/${enc(d.id)}/add`, "POST", { roomId: d.suggestedRoomId }, `${d.name} toegevoegd`)) {
                        setAvailable((cur) => cur?.filter((x) => x.id !== d.id) ?? null);
                      }
                    }}
                  >
                    Toevoegen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op naam, merk of model" className="pl-9" aria-label="Zoeken" />
        </div>
        <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1" role="tablist">
          {(
            [
              ["all", "Alle"],
              ["online", "Online"],
              ["problem", "Problemen"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={cn("rounded-lg px-3 py-1.5 text-xs transition", filter === k ? "bg-accent text-white" : "text-muted hover:text-fg")}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {devices.length === 0 ? (
        <EmptyState icon={Cpu} title={snapshot ? "Geen apparaten gevonden" : "Nog geen gegevens"}>
          {snapshot ? "Pas je zoekopdracht of filter aan, of zoek naar nieuwe apparaten." : "Wachten op de connector…"}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      )}
    </div>
  );
}
