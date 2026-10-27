import { NextResponse } from "next/server";
import { allRows } from "@/lib/db";

export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL || "http://localhost:6969";
const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

// Addresses already emailed: the mail engine's sent log plus the Supabase history (read-only). Local callers only.
export async function GET(req: Request) {
  if (!isLocal(req.headers.get("host") ?? "") && process.env.ALLOW_REMOTE_SEND !== "1")
    return NextResponse.json({ error: "Only available from localhost" }, { status: 403 });
  const addresses = new Set<string>();
  const [engine, history] = await Promise.allSettled([
    fetch(`${ENGINE}/sent`, { cache: "no-store" }).then(r => r.json() as Promise<{ addresses: string[] }>),
    allRows<{ email: string }>("email", "sent"),
  ]);
  if (engine.status === "fulfilled") engine.value.addresses.forEach(a => addresses.add(a));
  if (history.status === "fulfilled") history.value.forEach(r => addresses.add(r.email));
  if (engine.status === "rejected" && history.status === "rejected")
    return NextResponse.json({ error: "Neither the mail engine nor Supabase is reachable" }, { status: 502 });
  return NextResponse.json({ addresses: [...addresses], engine: engine.status === "fulfilled", db: history.status === "fulfilled" });
}
