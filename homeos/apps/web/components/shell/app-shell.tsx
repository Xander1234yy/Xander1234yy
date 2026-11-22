import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { StatusBanner } from "./status-banner";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SideNav />
      <div className="lg:pl-64">
        <TopBar />
        <main className="mx-auto max-w-[1500px] px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-12">
          <StatusBanner />
          <div className="mt-5">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
