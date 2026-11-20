import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <p className="mt-4 text-xl font-semibold tracking-tight">HomeOS</p>
          <p className="text-sm text-muted">Your home. One intelligent system.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
