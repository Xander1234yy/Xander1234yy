"use client";

import { useState } from "react";
import { Home, Link2, Link2Off, LogOut, Trash2, UserPlus, Users } from "lucide-react";
import { Badge, Button, Input } from "@homeos/ui";
import { ROLE_LABEL, type HouseholdRole } from "@homeos/shared";
import type { ConnectorLinkRow, MemberRow } from "@homeos/database";
import { SectionCard } from "@/components/section";
import { useCan, useSession } from "@/components/session-context";
import { useServerAction } from "@/components/family/use-action";
import { addMember, changeMemberRole, leaveHousehold, linkConnector, removeMember, renameHousehold, unlinkConnector } from "@/lib/actions/household";
import { formatDateTime } from "@/lib/format";

const select = "h-9 rounded-xl border border-white/[0.08] bg-navy-850 px-2 text-xs text-fg";

export function MembersCard({ members }: { members: MemberRow[] }) {
  const s = useSession();
  const manage = useCan("manage_members");
  const isOwner = s.household?.role === "owner";
  const { pending, run } = useServerAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest" | "admin">("member");

  return (
    <SectionCard title="Gebruikers" description={`${members.length} ${members.length === 1 ? "lid" : "leden"} in ${s.household?.name}`} icon={Users} testId="members-card">
      <ul className="space-y-2">
        {members.map((m) => {
          const self = m.user_id === s.user?.id;
          const editable = manage && !self && (isOwner || (m.role !== "owner" && m.role !== "admin"));
          return (
            <li key={m.user_id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold">{(m.display_name || m.email).charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {m.display_name || m.email} {self && <span className="text-xs text-muted">(jij)</span>}
                </p>
                <p className="truncate text-[11px] text-muted">{m.email}</p>
              </div>
              {editable ? (
                <>
                  <select
                    value={m.role}
                    disabled={pending}
                    onChange={(e) => void run(() => changeMemberRole({ userId: m.user_id, role: e.target.value }), "Rol gewijzigd")}
                    className={select}
                    aria-label={`Rol van ${m.display_name || m.email}`}
                  >
                    {(isOwner ? (["owner", "admin", "member", "guest"] as HouseholdRole[]) : (["member", "guest"] as HouseholdRole[])).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <Button size="icon-sm" variant="ghost" disabled={pending} aria-label="Verwijderen uit huishouden" onClick={() => confirm(`${m.display_name || m.email} verwijderen uit het huishouden?`) && void run(() => removeMember(m.user_id), "Lid verwijderd")}>
                    <Trash2 />
                  </Button>
                </>
              ) : (
                <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
              )}
            </li>
          );
        })}
      </ul>
      {manage && (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => addMember({ email, role }), "Lid toegevoegd")) setEmail("");
          }}
        >
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mailadres van een bestaand account" required aria-label="E-mailadres" />
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="h-10 rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm" aria-label="Rol">
            <option value="member">Lid</option>
            <option value="guest">Gast</option>
            {isOwner && <option value="admin">Beheerder</option>}
          </select>
          <Button type="submit" variant="primary" disabled={pending || !email}>
            <UserPlus /> Toevoegen
          </Button>
        </form>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Rollen: <strong>eigenaar</strong> alles · <strong>beheerder</strong> apparaten, kamers en leden · <strong>lid</strong> bedienen en familiegegevens · <strong>gast</strong> alleen bekijken. Een nieuw gezinslid maakt eerst zelf een account aan.
      </p>
    </SectionCard>
  );
}

export function HouseholdCard() {
  const s = useSession();
  const manage = useCan("manage_household");
  const { pending, run } = useServerAction();
  const [name, setName] = useState(s.household?.name ?? "");
  return (
    <SectionCard title="Huishouden" icon={Home}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => renameHousehold(name), "Naam gewijzigd");
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!manage} aria-label="Naam huishouden" />
        {manage && (
          <Button type="submit" disabled={pending || !name.trim() || name === s.household?.name}>
            Opslaan
          </Button>
        )}
      </form>
      <p className="mt-2 text-xs text-muted">Jouw rol: {s.household ? ROLE_LABEL[s.household.role] : "—"}</p>
      <Button variant="ghost" size="sm" className="mt-3 text-danger" disabled={pending} onClick={() => confirm("Weet je zeker dat je dit huishouden wilt verlaten?") && void run(() => leaveHousehold())}>
        <LogOut /> Huishouden verlaten
      </Button>
    </SectionCard>
  );
}

export function ConnectorLinkCard({ link, currentConnectorId }: { link: ConnectorLinkRow | null; currentConnectorId: string | null }) {
  const manage = useCan("manage_devices");
  const { pending, run } = useServerAction();
  const matches = link && currentConnectorId && link.connector_id === currentConnectorId;
  return (
    <SectionCard title="Connectorkoppeling" description="Welke Device Connector bij dit huishouden hoort" icon={Link2} testId="connector-link">
      {link ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Gekoppeld</dt>
          <dd className="truncate font-mono text-xs">{link.connector_id}</dd>
          <dt className="text-muted">Sinds</dt>
          <dd>{formatDateTime(link.linked_at)}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{matches ? <Badge tone="success">Bereikbaar</Badge> : currentConnectorId ? <Badge tone="danger">Andere connector bereikbaar</Badge> : <Badge tone="neutral">Niet bereikbaar</Badge>}</dd>
        </dl>
      ) : (
        <p className="text-sm text-muted">
          Er is nog geen connector gekoppeld. Zolang dat zo is, kan niemand in dit huishouden apparaten zien of bedienen.
          {currentConnectorId ? " Er is een connector bereikbaar die je nu kunt koppelen." : " Start eerst de Device Connector op je laptop."}
        </p>
      )}
      {manage && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!matches && currentConnectorId && (
            <Button variant="primary" disabled={pending} onClick={() => void run(() => linkConnector(), "Connector gekoppeld")} data-testid="link-connector">
              <Link2 /> {link ? "Deze connector koppelen" : "Connector koppelen"}
            </Button>
          )}
          {link && (
            <Button variant="ghost" disabled={pending} onClick={() => confirm("Koppeling verwijderen? Daarna kan niemand de apparaten meer bedienen tot je opnieuw koppelt.") && void run(() => unlinkConnector(), "Koppeling verwijderd")}>
              <Link2Off /> Ontkoppelen
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
