"use client";

import { useState } from "react";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useServerAction } from "@/components/family/use-action";
import { updateDisplayName, updatePassword } from "@/lib/actions/household";
import { signOut } from "@/app/(auth)/actions";

export function AccountForms({ displayName }: { displayName: string }) {
  const { pending, run } = useServerAction();
  const [name, setName] = useState(displayName);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SectionCard title="Profiel" icon={UserRound}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => updateDisplayName(name), "Naam opgeslagen");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Weergavenaam" />
          <Button type="submit" disabled={pending || !name.trim() || name === displayName}>
            Opslaan
          </Button>
        </form>
      </SectionCard>
      <SectionCard title="Wachtwoord" icon={KeyRound}>
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => (pw === pw2 ? updatePassword(pw) : Promise.resolve({ ok: false as const, error: "De wachtwoorden zijn niet gelijk" })), "Wachtwoord gewijzigd")) {
              setPw("");
              setPw2("");
            }
          }}
        >
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nieuw wachtwoord (minimaal 10 tekens)" autoComplete="new-password" minLength={10} aria-label="Nieuw wachtwoord" />
          <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Herhaal nieuw wachtwoord" autoComplete="new-password" aria-label="Herhaal wachtwoord" />
          <Button type="submit" disabled={pending || pw.length < 10}>
            Wachtwoord wijzigen
          </Button>
        </form>
      </SectionCard>
      <form action={signOut}>
        <Button variant="danger">
          <LogOut /> Uitloggen
        </Button>
      </form>
    </div>
  );
}
