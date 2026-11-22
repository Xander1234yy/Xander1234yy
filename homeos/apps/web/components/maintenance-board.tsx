"use client";

import { useState } from "react";
import { AlertTriangle, CalendarClock, Pencil, Plus, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import { Badge, Button, Card, Input, cn } from "@homeos/ui";
import { MAINTENANCE_CATEGORIES, maintenanceDue, type MaintenanceRow } from "@homeos/database";
import { deleteMaintenance, saveMaintenance } from "@/lib/actions/maintenance";
import { useCan } from "@/components/session-context";
import { EmptyState } from "@/components/section";
import { useServerAction } from "@/components/family/use-action";

const CAT_LABEL: Record<string, string> = { apparaat: "Apparaat", installatie: "Installatie", verwarming: "Verwarming", veiligheid: "Veiligheid", tuin: "Tuin", overig: "Overig" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");

type Form = { itemName: string; category: string; brand: string; model: string; purchaseDate: string; warrantyUntil: string; lastServiceAt: string; nextServiceAt: string; notes: string };
const empty: Form = { itemName: "", category: "overig", brand: "", model: "", purchaseDate: "", warrantyUntil: "", lastServiceAt: "", nextServiceAt: "", notes: "" };
const toForm = (r: MaintenanceRow): Form => ({
  itemName: r.item_name,
  category: r.category,
  brand: r.brand,
  model: r.model,
  purchaseDate: r.purchase_date ?? "",
  warrantyUntil: r.warranty_until ?? "",
  lastServiceAt: r.last_service_at ?? "",
  nextServiceAt: r.next_service_at ?? "",
  notes: r.notes,
});

export function MaintenanceBoard({ records }: { records: MaintenanceRow[] }) {
  const write = useCan("family_write");
  const { pending, run } = useServerAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const today = new Date().toISOString().slice(0, 10);
  const due = records.filter((r) => ["overdue", "soon"].includes(maintenanceDue(r.next_service_at, today)));
  const warrantySoon = records.filter((r) => r.warranty_until && r.warranty_until >= today && maintenanceDue(r.warranty_until, today, 60) === "soon");

  const field = (k: keyof Form, label: string, type = "text") => (
    <label className="text-xs text-muted">
      {label}
      <Input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1" required={k === "itemName"} />
    </label>
  );

  return (
    <div className="space-y-5">
      {(due.length > 0 || warrantySoon.length > 0) && (
        <Card className="border-warning/30 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning" /> Herinneringen
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {due.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.item_name}</span>{" "}
                <span className="text-muted">
                  — onderhoud {maintenanceDue(r.next_service_at, today) === "overdue" ? "verlopen sinds" : "gepland op"} {fmt(r.next_service_at)}
                </span>
              </li>
            ))}
            {warrantySoon.map((r) => (
              <li key={`w${r.id}`}>
                <span className="font-medium">{r.item_name}</span> <span className="text-muted">— garantie loopt af op {fmt(r.warranty_until)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {write && editing === null && (
        <Button variant="primary" onClick={() => (setForm(empty), setEditing("new"))}>
          <Plus /> Item toevoegen
        </Button>
      )}

      {editing !== null && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{editing === "new" ? "Nieuw item" : "Item bewerken"}</h2>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Sluiten">
              <X />
            </Button>
          </div>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => saveMaintenance(editing === "new" ? null : editing, form), "Opgeslagen")) setEditing(null);
            }}
          >
            {field("itemName", "Naam")}
            <label className="text-xs text-muted">
              Categorie
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm text-fg">
                {MAINTENANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CAT_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            {field("brand", "Merk")}
            {field("model", "Model")}
            {field("purchaseDate", "Aankoopdatum", "date")}
            {field("warrantyUntil", "Garantie tot", "date")}
            {field("lastServiceAt", "Laatste onderhoud", "date")}
            {field("nextServiceAt", "Volgend onderhoud", "date")}
            <label className="text-xs text-muted sm:col-span-2 lg:col-span-4">
              Notities
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} rows={2} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-fg" />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" variant="primary" disabled={pending || !form.itemName.trim()}>
                Opslaan
              </Button>
            </div>
          </form>
        </Card>
      )}

      {records.length === 0 ? (
        <EmptyState icon={Wrench} title="Nog geen items">
          Registreer bijvoorbeeld de cv-ketel, rookmelders of wasmachine, met garantie en onderhoudsdata.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {records.map((r) => {
            const status = maintenanceDue(r.next_service_at, today);
            const warrantyActive = r.warranty_until && r.warranty_until >= today;
            return (
              <Card key={r.id} className={cn("p-5", status === "overdue" && "border-danger/30")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{r.item_name}</h3>
                    <p className="truncate text-xs text-muted">{[CAT_LABEL[r.category], r.brand, r.model].filter(Boolean).join(" · ")}</p>
                  </div>
                  {write && (
                    <>
                      <Button size="icon-sm" variant="ghost" aria-label="Bewerken" onClick={() => (setForm(toForm(r)), setEditing(r.id))}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Verwijderen" onClick={() => confirm(`${r.item_name} verwijderen?`) && void run(() => deleteMaintenance(r.id))}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-muted" />
                    <dt className="text-muted">Volgend onderhoud</dt>
                    <dd className="ml-auto">{fmt(r.next_service_at)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-muted" />
                    <dt className="text-muted">Garantie</dt>
                    <dd className="ml-auto">{r.warranty_until ? `${warrantyActive ? "tot" : "verlopen"} ${fmt(r.warranty_until)}` : "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  {status === "overdue" && <Badge tone="danger">Onderhoud verlopen</Badge>}
                  {status === "soon" && <Badge tone="warning">Binnenkort onderhoud</Badge>}
                </div>
                {r.notes && <p className="mt-3 text-xs text-muted">{r.notes}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
