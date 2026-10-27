import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { BATCH_RE } from "@/lib/yc";

export const dynamic = "force-dynamic";

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

// POST { batch, done } marks a batch as finished (or not). Local callers only.
export async function POST(req: Request) {
  if (!isLocal(req.headers.get("host") ?? "") && process.env.ALLOW_REMOTE_SEND !== "1")
    return NextResponse.json({ error: "Only available from localhost" }, { status: 403 });
  const { batch, done } = await req.json().catch(() => ({})) as { batch?: string; done?: boolean };
  if (!batch || !BATCH_RE.test(batch) || typeof done !== "boolean") return NextResponse.json({ error: "Expected { batch, done }" }, { status: 400 });
  const sb = db();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  const { error } = done
    ? await sb.from("yc_batch_done").upsert({ batch }, { onConflict: "batch" })
    : await sb.from("yc_batch_done").delete().eq("batch", batch);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
