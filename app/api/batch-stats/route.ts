import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { BATCH_RE } from "@/lib/yc";

export const dynamic = "force-dynamic";

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

// POST { batch, total, mailable } stores how many companies in a batch have an email to send to. Local callers only.
export async function POST(req: Request) {
  if (!isLocal(req.headers.get("host") ?? "") && process.env.ALLOW_REMOTE_SEND !== "1")
    return NextResponse.json({ error: "Only available from localhost" }, { status: 403 });
  const { batch, total, mailable } = await req.json().catch(() => ({})) as { batch?: string; total?: number; mailable?: number };
  if (!batch || !BATCH_RE.test(batch) || !Number.isInteger(total) || !Number.isInteger(mailable) || mailable! < 0 || mailable! > total!)
    return NextResponse.json({ error: "Expected { batch, total, mailable }" }, { status: 400 });
  const sb = db();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  const { error } = await sb.from("yc_batch_stats").upsert({ batch, total, mailable, scanned_at: new Date().toISOString() }, { onConflict: "batch" });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
