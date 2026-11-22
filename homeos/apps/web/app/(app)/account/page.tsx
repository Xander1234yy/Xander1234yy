import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountForms } from "@/components/settings/account-forms";
import { PageHeader } from "@/components/section";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Mijn account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const s = await getSession();
  if (s.mode === "local" || !s.user) redirect("/instellingen");
  return (
    <div>
      <PageHeader title="Mijn account" description={s.user.email} />
      <AccountForms displayName={s.user.displayName} />
    </div>
  );
}
