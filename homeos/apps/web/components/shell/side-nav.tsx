"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@homeos/ui";
import { isActive, NAV_ITEMS } from "./nav-items";
import { Logo } from "./logo";

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.05] bg-navy-950/60 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex h-16 items-center gap-3 px-6">
        <Logo className="size-9" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">HomeOS</p>
          <p className="text-[10px] text-muted">Your home. One intelligent system.</p>
        </div>
      </Link>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Hoofdnavigatie">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                active ? "bg-gradient-to-r from-accent/20 to-accent/5 text-fg shadow-[inset_0_0_0_1px_rgba(79,140,255,0.25)]" : "text-muted hover:bg-white/[0.04] hover:text-fg",
              )}
            >
              <item.icon className={cn("size-[18px]", active ? "text-accent" : "text-muted group-hover:text-fg")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="px-6 py-5 text-[11px] text-muted/70">HomeOS 0.4 · Fase 4</p>
    </aside>
  );
}
