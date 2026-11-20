"use client";

import { useState } from "react";
import { Check, DoorOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, Card, Input } from "@homeos/ui";
import type { Room } from "@homeos/shared";
import { PageHeader, EmptyState } from "@/components/section";
import { DeviceCard } from "@/components/devices/device-card";
import { enc } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";

function RoomHeader({ room, count, on }: { room: Room; count: number; on: number }) {
  const { mutate } = useHome();
  const live = useLive();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  return (
    <div className="mb-3 flex items-center gap-3">
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate(`v1/rooms/${enc(room.id)}`, "PATCH", { name }, "Kamer hernoemd")) setEditing(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Kamernaam" />
          <Button size="icon" type="submit" variant="primary" aria-label="Opslaan">
            <Check />
          </Button>
          <Button size="icon" type="button" variant="ghost" onClick={() => setEditing(false)} aria-label="Annuleren">
            <X />
          </Button>
        </form>
      ) : (
        <>
          <div className="flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{room.name}</h2>
            <p className="text-xs text-muted">
              {count} {count === 1 ? "apparaat" : "apparaten"} · {on} {on === 1 ? "lamp" : "lampen"} aan
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" disabled={!live} onClick={() => setEditing(true)} aria-label={`${room.name} hernoemen`}>
            <Pencil />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!live}
            onClick={() => confirm(`Kamer "${room.name}" verwijderen? Apparaten blijven bestaan zonder kamer.`) && void mutate(`v1/rooms/${enc(room.id)}`, "DELETE", undefined, "Kamer verwijderd")}
            aria-label={`${room.name} verwijderen`}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );
}

export default function RoomsPage() {
  const { snapshot, mutate } = useHome();
  const live = useLive();
  const [newRoom, setNewRoom] = useState("");
  const rooms = snapshot?.rooms ?? [];
  const devices = snapshot?.devices ?? [];
  const unassigned = devices.filter((d) => !d.roomId || !rooms.some((r) => r.id === d.roomId));

  return (
    <div>
      <PageHeader title="Kamers" description="Indeling van je huis. Kamers zijn volledig configureerbaar." />
      <Card className="mb-6 p-4">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newRoom.trim() && (await mutate("v1/rooms", "POST", { name: newRoom.trim() }, "Kamer toegevoegd"))) setNewRoom("");
          }}
        >
          <Input value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="Nieuwe kamer, bijv. Zolder of Kinderkamer" maxLength={60} disabled={!live} aria-label="Nieuwe kamer" />
          <Button type="submit" variant="primary" disabled={!live || !newRoom.trim()}>
            <Plus /> Toevoegen
          </Button>
        </form>
      </Card>

      {rooms.length === 0 && <EmptyState icon={DoorOpen} title="Nog geen kamers" />}
      <div className="space-y-10">
        {rooms.map((room) => {
          const inRoom = devices.filter((d) => d.roomId === room.id);
          const on = inRoom.filter((d) => d.kind === "light" && d.state.on && d.status === "ONLINE").length;
          return (
            <section key={room.id} data-testid="room-section">
              <RoomHeader room={room} count={inRoom.length} on={on} />
              {inRoom.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted">Nog geen apparaten. Verplaats een apparaat via “Beheer” op de apparaatkaart.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {inRoom.map((d) => (
                    <DeviceCard key={d.id} device={d} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {unassigned.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Zonder kamer</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {unassigned.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
