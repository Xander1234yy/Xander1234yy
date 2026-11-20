"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Check, ListTodo, Pin, Plus, ShoppingCart, StickyNote, Trash2 } from "lucide-react";
import { Button, Card, Input, cn } from "@homeos/ui";
import type { CalendarEventRow, FamilyTaskRow, MemberRow, NoteRow, ShoppingItemRow } from "@homeos/database";
import { addEvent, addShoppingItem, addTask, clearCheckedShopping, deleteFamilyItem, saveNote, setShoppingChecked, setTaskDone } from "@/lib/actions/family";
import { useCan } from "@/components/session-context";
import { EmptyState } from "@/components/section";
import { useServerAction } from "./use-action";

type Tab = "agenda" | "taken" | "boodschappen" | "notities";
const TABS: { id: Tab; label: string; icon: typeof ListTodo }[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "taken", label: "Taken", icon: ListTodo },
  { id: "boodschappen", label: "Boodschappen", icon: ShoppingCart },
  { id: "notities", label: "Notities", icon: StickyNote },
];

const select = "h-10 rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm text-fg";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Vandaag";
  if (d.toDateString() === tomorrow.toDateString()) return "Morgen";
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

export function FamilyBoard(props: { tasks: FamilyTaskRow[]; shopping: ShoppingItemRow[]; events: CalendarEventRow[]; notes: NoteRow[]; members: MemberRow[] }) {
  const [tab, setTab] = useState<Tab>("agenda");
  const counts: Record<Tab, number> = {
    agenda: props.events.length,
    taken: props.tasks.filter((t) => !t.completed_at).length,
    boodschappen: props.shopping.filter((s) => !s.checked).length,
    notities: props.notes.length,
  };
  return (
    <div>
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm transition", tab === t.id ? "bg-accent text-white" : "text-muted hover:text-fg")}
          >
            <t.icon className="size-4" /> {t.label}
            <span className={cn("rounded-full px-1.5 text-[10px]", tab === t.id ? "bg-white/20" : "bg-white/[0.06]")}>{counts[t.id]}</span>
          </button>
        ))}
      </div>
      {tab === "agenda" && <Agenda events={props.events} />}
      {tab === "taken" && <Tasks tasks={props.tasks} members={props.members} />}
      {tab === "boodschappen" && <Shopping items={props.shopping} />}
      {tab === "notities" && <Notes notes={props.notes} />}
    </div>
  );
}

function Agenda({ events }: { events: CalendarEventRow[] }) {
  const write = useCan("family_write");
  const { pending, run } = useServerAction();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, CalendarEventRow[]>();
    for (const e of events) {
      const k = new Date(e.starts_at).toDateString();
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.values()];
  }, [events]);

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {write && (
        <Card className="p-5 lg:col-span-4">
          <h2 className="font-semibold">Afspraak toevoegen</h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const allDay = !time;
              const startsAt = new Date(`${date}T${time || "00:00"}`).toISOString();
              if (await run(() => addEvent({ title, location, startsAt, allDay }), "Afspraak toegevoegd")) {
                setTitle("");
                setTime("");
                setLocation("");
              }
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wat?" required maxLength={200} aria-label="Titel" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Datum" />
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Tijd (leeg = hele dag)" />
            </div>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Locatie (optioneel)" maxLength={200} aria-label="Locatie" />
            <Button type="submit" variant="primary" className="w-full" disabled={pending || !title.trim()}>
              <Plus /> Toevoegen
            </Button>
          </form>
        </Card>
      )}
      <div className={cn("space-y-5", write ? "lg:col-span-8" : "lg:col-span-12")}>
        {groups.length === 0 && <EmptyState icon={CalendarDays} title="Geen komende afspraken" />}
        {groups.map((g) => (
          <section key={g[0]!.id}>
            <h3 className="mb-2 text-sm font-semibold capitalize text-muted">{dayLabel(g[0]!.starts_at)}</h3>
            <ul className="space-y-2">
              {g.map((e) => (
                <li key={e.id}>
                  <Card className="flex items-center gap-4 p-4">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-sm font-semibold tabular">{e.all_day ? "Hele dag" : new Date(e.starts_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <div className="min-w-0 flex-1 border-l border-white/[0.06] pl-4">
                      <p className="truncate text-sm font-medium">{e.title}</p>
                      {e.location && <p className="truncate text-xs text-muted">{e.location}</p>}
                    </div>
                    {write && (
                      <Button size="icon-sm" variant="ghost" aria-label={`${e.title} verwijderen`} onClick={() => void run(() => deleteFamilyItem("event", e.id))}>
                        <Trash2 />
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tasks({ tasks, members }: { tasks: FamilyTaskRow[]; members: MemberRow[] }) {
  const write = useCan("family_write");
  const { pending, run } = useServerAction();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.display_name;
  const open = tasks.filter((t) => !t.completed_at);
  const done = tasks.filter((t) => t.completed_at).slice(0, 15);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      {write && (
        <Card className="p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => addTask({ title, assignedTo: assignee, dueDate: due }))) {
                setTitle("");
                setDue("");
              }
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nieuwe taak" required maxLength={200} aria-label="Nieuwe taak" />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={select} aria-label="Toewijzen aan">
              <option value="">Niemand</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.email}
                </option>
              ))}
            </select>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="sm:w-40" aria-label="Deadline" />
            <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
              <Plus /> Toevoegen
            </Button>
          </form>
        </Card>
      )}
      {open.length === 0 && <EmptyState icon={ListTodo} title="Geen openstaande taken" />}
      <ul className="space-y-2">
        {[...open, ...done].map((t) => (
          <li key={t.id}>
            <Card className={cn("flex items-center gap-3 p-4", t.completed_at && "opacity-50")}>
              <button
                disabled={!write || pending}
                onClick={() => void run(() => setTaskDone(t.id, !t.completed_at))}
                className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition", t.completed_at ? "border-success bg-success text-ink" : "border-white/20 hover:border-accent")}
                aria-label={t.completed_at ? `${t.title} heropenen` : `${t.title} afvinken`}
              >
                {t.completed_at && <Check className="size-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm", t.completed_at && "line-through")}>{t.title}</p>
                <p className="text-xs text-muted">
                  {[name(t.assigned_to), t.due_date && `${t.due_date < today && !t.completed_at ? "te laat · " : ""}${new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`].filter(Boolean).join(" · ") || " "}
                </p>
              </div>
              {write && (
                <Button size="icon-sm" variant="ghost" aria-label={`${t.title} verwijderen`} onClick={() => void run(() => deleteFamilyItem("task", t.id))}>
                  <Trash2 />
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shopping({ items }: { items: ShoppingItemRow[] }) {
  const write = useCan("family_write");
  const { pending, run } = useServerAction();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const checked = items.filter((i) => i.checked).length;
  return (
    <Card className="p-5">
      {write && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => addShoppingItem({ name, quantity: qty }))) {
              setName("");
              setQty("");
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wat moet er gehaald worden?" required maxLength={120} aria-label="Product" />
          <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Aantal" maxLength={40} className="w-28" aria-label="Aantal" />
          <Button type="submit" variant="primary" size="icon" disabled={pending || !name.trim()} aria-label="Toevoegen">
            <Plus />
          </Button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">De boodschappenlijst is leeg.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/[0.05]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5">
              <button
                disabled={!write || pending}
                onClick={() => void run(() => setShoppingChecked(i.id, !i.checked))}
                className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition", i.checked ? "border-accent bg-accent text-white" : "border-white/20 hover:border-accent")}
                aria-label={i.checked ? `${i.name} terugzetten` : `${i.name} afvinken`}
              >
                {i.checked && <Check className="size-3.5" />}
              </button>
              <span className={cn("flex-1 text-sm", i.checked && "text-muted line-through")}>{i.name}</span>
              {i.quantity && <span className="text-xs text-muted">{i.quantity}</span>}
            </li>
          ))}
        </ul>
      )}
      {write && checked > 0 && (
        <Button variant="ghost" size="sm" className="mt-3" disabled={pending} onClick={() => void run(() => clearCheckedShopping(), "Afgevinkte items verwijderd")}>
          <Trash2 /> {checked} afgevinkte {checked === 1 ? "item" : "items"} verwijderen
        </Button>
      )}
    </Card>
  );
}

function Notes({ notes }: { notes: NoteRow[] }) {
  const write = useCan("family_write");
  const { pending, run } = useServerAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {write && (
        <Card className="p-4">
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => saveNote(null, { title, body }))) {
                setTitle("");
                setBody("");
              }
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" maxLength={120} aria-label="Titel" />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Schrijf een notitie voor het gezin…"
              maxLength={5000}
              rows={4}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-fg outline-none placeholder:text-muted/70 focus:border-accent/60"
              aria-label="Notitie"
            />
            <Button type="submit" variant="primary" size="sm" disabled={pending || (!title.trim() && !body.trim())}>
              <Plus /> Notitie opslaan
            </Button>
          </form>
        </Card>
      )}
      {notes.map((n) => (
        <Card key={n.id} className="flex flex-col p-4">
          <div className="flex items-start gap-2">
            <h3 className="flex-1 text-sm font-semibold">{n.title || "Notitie"}</h3>
            {write && (
              <>
                <Button size="icon-sm" variant="ghost" className={n.pinned ? "text-accent" : ""} aria-label={n.pinned ? "Losmaken" : "Vastpinnen"} onClick={() => void run(() => saveNote(n.id, { title: n.title, body: n.body, pinned: !n.pinned }))}>
                  <Pin />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Verwijderen" onClick={() => void run(() => deleteFamilyItem("note", n.id))}>
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 flex-1 whitespace-pre-wrap text-sm text-muted">{n.body}</p>
          <p className="mt-3 text-[11px] text-muted/70">Bijgewerkt {new Date(n.updated_at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
        </Card>
      ))}
    </div>
  );
}
