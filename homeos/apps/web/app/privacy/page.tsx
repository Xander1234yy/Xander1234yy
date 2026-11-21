import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · HomeOS" };

/** Openbare privacyverklaring (o.a. nodig voor het Google OAuth-toestemmingsscherm). Geen gegevens, geen tracking. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 text-sm leading-relaxed text-muted">
      <h1 className="text-2xl font-semibold text-fg">Privacy</h1>
      <p>
        HomeOS is een privé smart-home-app voor één huishouden. Er is geen openbare dienst, geen advertentie en geen
        tracking.
      </p>
      <h2 className="pt-2 text-base font-medium text-fg">Welke gegevens</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Je account (e-mailadres) en de leden van je huishouden, opgeslagen in de eigen database van het huishouden.</li>
        <li>
          Toegangssleutels van gekoppelde diensten (zoals Google, Philips Hue, Daikin, Smart Life). Deze worden versleuteld
          (AES-256-GCM) bewaard en alleen server-side gebruikt om je eigen apparaten te bedienen.
        </li>
        <li>Een logboek van opdrachten aan apparaten (wie, wat, wanneer), alleen zichtbaar voor beheerders van het huishouden.</li>
      </ul>
      <h2 className="pt-2 text-base font-medium text-fg">Google</h2>
      <p>
        Met je toestemming gebruikt HomeOS de Google Assistant API alleen om de opdrachten te sturen die jij in HomeOS
        geeft (bijvoorbeeld &quot;zet GRILLPLATS aan&quot;). HomeOS leest geen andere Google-gegevens, deelt niets met derden en
        verkoopt niets. Je kunt de toegang altijd intrekken in HomeOS (Instellingen → Google Home → ontkoppelen) of op
        myaccount.google.com/permissions.
      </p>
      <h2 className="pt-2 text-base font-medium text-fg">Verwijderen</h2>
      <p>Ontkoppelen wist de opgeslagen sleutels direct. Neem voor vragen contact op met de beheerder van je huishouden.</p>
    </main>
  );
}
