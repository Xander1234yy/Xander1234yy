import type { Metadata } from "next";
import type { ConnectorLinkRow, MemberRow } from "@homeos/database";
import { ConnectorLinkCard, HouseholdCard, MembersCard } from "@/components/settings/household-settings";
import { connectorIdentity } from "@/lib/server/authz";
import { getSession } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";
import { cloudRuntimeEnabled } from "@/lib/cloud/runtime";

export const metadata: Metadata = { title: "Instellingen" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getSession();
  if (s.mode === "local" || !s.household) return <SettingsClient />;
  if (cloudRuntimeEnabled()) {
    const supabase = await createSupabaseServer();
    const members = await supabase.rpc("household_member_list", { p_household: s.household.id });
    return (
      <SettingsClient
        cloudRuntime
        cloudSection={
          <>
            <MembersCard members={(members.data ?? []) as MemberRow[]} />
            <HouseholdCard />
          </>
        }
      />
    );
  }
  const supabase = await createSupabaseServer();
  const [members, link, identity] = await Promise.all([
    supabase.rpc("household_member_list", { p_household: s.household.id }),
    supabase.from("connector_status").select("household_id, connector_id, version, linked_at, last_seen_at").eq("household_id", s.household.id).maybeSingle(),
    connectorIdentity().catch(() => null),
  ]);
  return (
    <SettingsClient
      cloudSection={
        <>
          <MembersCard members={(members.data ?? []) as MemberRow[]} />
          <div className="flex flex-col gap-5 [&>*]:h-auto">
            <ConnectorLinkCard link={(link.data as ConnectorLinkRow | null) ?? null} currentConnectorId={identity?.connectorId ?? null} />
            <HouseholdCard />
          </div>
        </>
      }
    />
  );
}
