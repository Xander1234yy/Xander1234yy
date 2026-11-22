import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/components/session-context";
import { HomeProvider } from "@/lib/home-context";
import { getSession, toClientSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.mode === "cloud") {
    if (!session.user) redirect("/login");
    if (!session.household) redirect("/welkom");
  }
  return (
    <SessionProvider session={toClientSession(session)}>
      <HomeProvider>
        <AppShell>{children}</AppShell>
      </HomeProvider>
    </SessionProvider>
  );
}
