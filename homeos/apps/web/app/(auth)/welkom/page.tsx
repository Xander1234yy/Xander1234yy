import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { createHousehold, signOut } from "../actions";

export const metadata: Metadata = { title: "Welkom" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const s = await getSession();
  if (s.mode === "local") redirect("/");
  if (!s.user) redirect("/login");
  if (s.household) redirect("/");
  return (
    <>
      <AuthForm
        title={`Welkom${s.user.displayName ? `, ${s.user.displayName}` : ""}`}
        description="Maak je huishouden aan. Je wordt eigenaar en kunt daarna gezinsleden toevoegen. Word je liever toegevoegd aan een bestaand huishouden? Vraag de eigenaar je e-mailadres toe te voegen en log daarna opnieuw in."
        action={createHousehold}
        submit="Huishouden aanmaken"
        fields={[{ name: "name", label: "Naam van je huishouden", placeholder: "Bijv. Familie de Vries" }]}
      />
      <form action={signOut} className="mt-4 text-center">
        <button className="text-sm text-muted hover:text-fg">Uitloggen</button>
      </form>
    </>
  );
}
