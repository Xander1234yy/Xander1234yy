"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Card, Input } from "@homeos/ui";
import type { FormState } from "@/app/(auth)/actions";

interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
}

export function AuthForm({
  title,
  description,
  action,
  fields,
  submit,
  hidden,
  footer,
}: {
  title: string;
  description?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <form action={formAction} className="mt-6 space-y-4">
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="mb-1.5 block text-muted">{f.label}</span>
            <Input name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} placeholder={f.placeholder} minLength={f.minLength} required />
          </label>
        ))}
        {state?.error && (
          <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state?.message && (
          <p role="status" className="rounded-xl bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Even geduld…" : submit}
        </Button>
      </form>
      {footer && <div className="mt-6 space-y-2 text-center text-sm text-muted">{footer}</div>}
    </Card>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline">
      {children}
    </Link>
  );
}
