import type { Metadata } from "next";
import { AuthForm, AuthLink } from "@/components/auth-form";
import { signIn } from "../actions";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; fout?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      {sp.fout === "link" && <p className="mb-4 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">De link is ongeldig of verlopen. Probeer het opnieuw.</p>}
      <AuthForm
        title="Inloggen"
        description="Welkom terug."
        action={signIn}
        hidden={{ next: safeNext(sp.next) }}
        submit="Inloggen"
        fields={[
          { name: "email", label: "E-mailadres", type: "email", autoComplete: "email" },
          { name: "password", label: "Wachtwoord", type: "password", autoComplete: "current-password" },
        ]}
        footer={
          <>
            <p>
              Nog geen account? <AuthLink href="/registreren">Registreren</AuthLink>
            </p>
            <p>
              <AuthLink href="/wachtwoord-vergeten">Wachtwoord vergeten?</AuthLink>
            </p>
          </>
        }
      />
    </>
  );
}
