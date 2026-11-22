import type { Metadata } from "next";
import { accessCode } from "@/lib/server/local-access";
import { AccessForm } from "./access-form";

export const metadata: Metadata = { title: "Toegangscode" };
export const dynamic = "force-dynamic";

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <AccessForm next={safeNext} configured={!!accessCode()} />;
}
