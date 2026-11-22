"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { cn } from "@homeos/ui";
import { isActive, MOBILE_PRIMARY, NAV_ITEMS } from "./nav-items";

export function BottomNav() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  useEffect(() => {
    setMore(false);
  }, [pathname]);
  const primary = NAV_ITEMS.filter((i) => MOBILE_PRIMARY.includes(i.href));
  const moreActive = !primary.some((i) => isActive(pathname, i.href));

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMore(false)}>
          <div
            className="pb-safe absolute inset-x-0 bottom-0 animate-fade-up rounded-t-3xl border-t border-white/10 bg-navy-900 px-4 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-sm font-semibold">Alle onderdelen</p>
              <button onClick={() => setMore(false)} aria-label="Sluiten" className="text-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 pb-20">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-2 py-4 text-xs",
                    isActive(pathname, item.href) ? "text-accent" : "text-muted",
                  )}
                >
                  <item.icon className="size-5" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.06] bg-ink/85 backdrop-blur-xl lg:hidden" aria-label="Navigatie">
        <div className="mx-auto grid max-w-md grid-cols-5 px-2 pt-2">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={cn("flex flex-col items-center gap-1 py-1 text-[10px]", active ? "text-accent" : "text-muted")} aria-current={active ? "page" : undefined}>
                <item.icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
          <button onClick={() => setMore((m) => !m)} className={cn("flex flex-col items-center gap-1 py-1 text-[10px]", moreActive || more ? "text-accent" : "text-muted")}>
            <LayoutGrid className="size-5" />
            Meer
          </button>
        </div>
      </nav>
    </>
  );
}
