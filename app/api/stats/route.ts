import { NextResponse } from "next/server";
import { allRows, db } from "@/lib/db";

export const dynamic = "force-dynamic";

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

// Per batch: emails and companies mailed (from the Supabase history) and which batches you marked finished. Local callers only.
export async function GET(req: Request) {
  if (!isLocal(req.headers.get("host") ?? "") && process.env.ALLOW_REMOTE_SEND !== "1")
    return NextResponse.json({ error: "Only available from localhost" }, { status: 403 });
  try {
    const rows = await allRows<{ batch: string | null; company: string | null }>("batch,company", "sent");
    const by = new Map<string, { emails: number; companies: Set<string> }>();
    for (const r of rows) {
      const k = r.batch || "";
      const e = by.get(k) ?? by.set(k, { emails: 0, companies: new Set() }).get(k)!;
      e.emails++;
      if (r.company) e.companies.add(r.company);
    }
    // The done list and mailable counts are optional: until their tables exist the table just has no badges and counts against the whole batch
    const { data } = await db()!.from("yc_batch_done").select("batch");
    const scans = await db()!.from("yc_batch_stats").select("batch,mailable");
    return NextResponse.json({
      rows: [...by].map(([batch, v]) => ({ batch, emails: v.emails, companies: v.companies.size })),
      done: (data ?? []).map((d: { batch: string }) => d.batch),
      mailable: Object.fromEntries((scans.data ?? []).map((d: { batch: string; mailable: number }) => [d.batch, d.mailable])),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
