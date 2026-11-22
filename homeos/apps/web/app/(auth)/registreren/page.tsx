import type { Metadata } from "next";
import { AuthForm, AuthLink } from "@/components/auth-form";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Registreren" };

export default function SignUpPage() {
  return (
    <AuthForm
      title="Account aanmaken"
      description="Daarna maak je je huishouden aan of word je toegevoegd door een gezinslid."
      action={signUp}
      submit="Account aanmaken"
      fields={[
        { name: "displayName", label: "Je naam", autoComplete: "name" },
        { name: "email", label: "E-mailadres", type: "email", autoComplete: "email" },
        { name: "password", label: "Wachtwoord (minimaal 10 tekens)", type: "password", autoComplete: "new-password", minLength: 10 },
      ]}
      footer={
        <p>
          Al een account? <AuthLink href="/login">Inloggen</AuthLink>
        </p>
      }
    />
  );
}
