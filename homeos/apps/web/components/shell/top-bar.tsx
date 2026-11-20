"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { useHome } from "@/lib/home-context";
import { formatDateTime, longDate } from "@/lib/format";
import { ConnectionPill } from "./connection-pill";
import { Logo } from "./logo";
import { ProfileMenu } from "./profile-menu";
import { useSession } from "@/components/session-context";

const CATEGORY: Record<string, string> = { connection: "Verbinding", energy: "Energie", maintenance: "Onderhoud", automation: "Automatisering", security: "Beveiliging", system: "Systeem" };

function useToday() {
  const [d, setD] = useState<string | null>(null);
  useEffect(() => {
    setD(longDate());
    const t = setInterval(() => setD(longDate()), 60_000);
    return () => clearInterval(t);
  }, []);
  return d;
}

export function TopBar() {
  const today = useToday();
  const session = useSession();
  const { notifications, markNotificationsRead } = useHome();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    // composedPath() bevat het pad op het moment van klikken, ook als het aangeklikte icoon intussen opnieuw gerenderd is.
    const close = (e: MouseEvent) => ref.current && !e.composedPath().includes(ref.current) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-white/[0.05] bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 lg:hidden" aria-label="HomeOS home">
          <Logo className="size-8" />
          <span className="text-[15px] font-semibold tracking-tight">HomeOS</span>
        </Link>
        <p className="hidden text-sm capitalize text-muted lg:block" suppressHydrationWarning>
          {today}
          {session.household && <span className="normal-case"> · {session.household.name}</span>}
        </p>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ConnectionPill />
          <div className="relative" ref={ref}>
            <button
              onClick={() => {
                setOpen((o) => !o);
                if (!open && unread) void markNotificationsRead();
              }}
              className="relative flex size-10 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.03] text-muted transition hover:text-fg"
              aria-label={`Meldingen${unread ? ` (${unread} nieuw)` : ""}`}
            >
              {unread ? <BellRing className="size-4 text-fg" /> : <Bell className="size-4" />}
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {open && (
              <div className="absolute right-0 top-12 w-[min(22rem,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-white/10 bg-navy-850/95 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <p className="text-sm font-semibold">Meldingen</p>
                  <Link href="/instellingen" className="text-[11px] text-accent hover:underline" onClick={() => setOpen(false)}>
                    Voorkeuren
                  </Link>
                </div>
                <ul className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Geen meldingen</li>}
                  {notifications.slice(0, 25).map((n) => (
                    <li key={n.id} className="border-b border-white/[0.04] px-4 py-3 last:border-0" data-testid="notification">
                      <p className="text-sm text-fg">{n.title}</p>
                      {n.body && <p className="mt-0.5 text-xs text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[11px] text-muted/80">
                        {CATEGORY[n.category]} · {formatDateTime(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
