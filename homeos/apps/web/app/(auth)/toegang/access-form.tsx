"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Card, Input } from "@homeos/ui";

export function AccessForm({ next, configured }: { next: string; configured: boolean }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <Card className="space-y-2 p-6 text-sm">
        <h1 className="text-lg font-semibold">Toegang van buitenaf staat uit</h1>
        <p className="text-muted">
          HomeOS draait zonder accounts. Om het vanaf je telefoon te gebruiken stel je op de laptop eerst een toegangscode in (zie de handleiding
          &quot;Toegang vanaf je telefoon&quot;), of je gebruikt HomeOS met accounts.
        </p>
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Inloggen mislukt");
      }
      window.location.assign(next);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="size-5" /> Toegangscode
          </h1>
          <p className="mt-1 text-sm text-muted">Je opent HomeOS van buiten de laptop. Vul de toegangscode in die je op de laptop hebt ingesteld.</p>
        </div>
        <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" aria-label="Toegangscode" placeholder="Toegangscode" maxLength={200} autoFocus />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !code}>
          {busy ? "Controleren…" : "Openen"}
        </Button>
      </form>
    </Card>
  );
}
