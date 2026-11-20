"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Home, LogOut, Settings, UserRound } from "lucide-react";
import { ROLE_LABEL } from "@homeos/shared";
import { signOut, switchHousehold } from "@/app/(auth)/actions";
import { useSession } from "@/components/session-context";

export function ProfileMenu() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (s.mode === "local") {
    return (
      <Link
        href="/instellingen"
        className="flex size-10 items-center justify-center rounded-full border border-white/[0.07] bg-gradient-to-br from-navy-700 to-navy-850 text-muted hover:text-fg"
        aria-label="Instellingen (lokale modus, zonder account)"
        title="Lokale modus: geen accounts geconfigureerd"
      >
        <UserRound className="size-4" />
      </Link>
    );
  }

  const initial = (s.user?.displayName || s.user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex size-10 items-center justify-center rounded-full border border-white/[0.07] bg-gradient-to-br from-accent/40 to-navy-800 text-sm font-semibold text-fg"
        aria-label="Profielmenu"
        aria-expanded={open}
        data-testid="profile-button"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-12 w-72 animate-fade-up overflow-hidden rounded-2xl border border-white/10 bg-navy-850/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <p className="truncate text-sm font-semibold">{s.user?.displayName}</p>
            <p className="truncate text-xs text-muted">{s.user?.email}</p>
          </div>
          <div className="border-b border-white/[0.06] p-2">
            <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wider text-muted">Huishouden</p>
            {s.households.map((h) => (
              <form key={h.id} action={switchHousehold.bind(null, h.id)}>
                <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-white/[0.05]">
                  <Home className="size-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span className="text-[10px] text-muted">{ROLE_LABEL[h.role]}</span>
                  {h.id === s.household?.id && <Check className="size-4 text-accent" />}
                </button>
              </form>
            ))}
          </div>
          <div className="p-2">
            <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.05]">
              <UserRound className="size-4 text-muted" /> Mijn account
            </Link>
            <Link href="/instellingen" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.05]">
              <Settings className="size-4 text-muted" /> Instellingen
            </Link>
            <form action={signOut}>
              <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-danger hover:bg-danger/10" data-testid="sign-out">
                <LogOut className="size-4" /> Uitloggen
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
