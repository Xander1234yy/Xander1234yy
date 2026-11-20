import type { Metadata } from "next";
import { AuthForm, AuthLink } from "@/components/auth-form";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Wachtwoord vergeten" };

export default function ResetPage() {
  return (
    <AuthForm
      title="Wachtwoord vergeten"
      description="We sturen je een link om een nieuw wachtwoord in te stellen."
      action={requestPasswordReset}
      submit="Herstellink versturen"
      fields={[{ name: "email", label: "E-mailadres", type: "email", autoComplete: "email" }]}
      footer={<AuthLink href="/login">Terug naar inloggen</AuthLink>}
    />
  );
}
