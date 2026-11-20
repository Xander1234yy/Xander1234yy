"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type Permission } from "@homeos/shared";
import type { ClientSession } from "@/lib/session";

const Ctx = createContext<ClientSession>({ mode: "local", user: null, household: null, households: [] });

export function SessionProvider({ session, children }: { session: ClientSession; children: ReactNode }) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession(): ClientSession {
  return useContext(Ctx);
}

/** In lokale modus (geen accounts, alleen 127.0.0.1) is alles toegestaan; in cloudmodus beslist de rol. */
export function useCan(permission: Permission): boolean {
  const s = useSession();
  return s.mode === "local" ? true : can(s.household?.role, permission);
}
