import { NextResponse } from "next/server";
import { TABLE, db, type SentRow } from "@/lib/db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ENGINE = process.env.ENGINE_URL || "http://localhost:6969";
const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

interface In { to: string; subject: string; body: string; html?: string; company?: string; batch?: string; founder?: string; kind?: string }
interface Out { success: boolean; message: string }

// Forwards a batch to the Rust EmailEngine, then records each result in Supabase. Refuses non-local callers, or anyone could send mail as you.
export async function POST(req: Request) {
  if (!isLocal(req.headers.get("host") ?? "") && process.env.ALLOW_REMOTE_SEND !== "1")
    return NextResponse.json({ error: "Sending is only allowed from localhost" }, { status: 403 });
  const input = await req.json().catch(() => null) as { messages?: In[] } | null;
  const messages = input?.messages;
  if (!Array.isArray(messages)) return NextResponse.json({ error: "Expected { messages: [...] }" }, { status: 400 });
  try {
    // The engine only gets what it needs to send; company/batch stay here for the history
    const outgoing = messages.map(({ to, subject, body, html }) => ({ to, subject, body, html }));
    const r = await fetch(`${ENGINE}/send-batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: outgoing }) });
    const text = await r.text();
    if (r.ok) await record(messages, text).catch(e => console.warn("Could not save to Supabase:", e.message));
    return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: `Mail engine not reachable at ${ENGINE}` }, { status: 502 });
  }
}

async function record(messages: In[], engineReply: string) {
  const sb = db(), results = (JSON.parse(engineReply) as { results?: Out[] }).results;
  if (!sb || !results) return;
  const sent: SentRow[] = [], failed: SentRow[] = [];
  messages.forEach((m, i) => {
    const res = results[i];
    if (!res || !m.to) return;
    const row: SentRow = { email: m.to.toLowerCase(), founder: m.founder, company: m.company, batch: m.batch, kind: m.kind };
    // "Already sent" is the engine's own log answering: keep the row, fill in company/batch, don't touch its status
    if (res.success) sent.push(res.message.startsWith("Already sent") ? row : { ...row, status: "sent", detail: null });
    else failed.push({ ...row, status: "failed", detail: res.message.slice(0, 300) });
  });
  if (sent.length) { const { error } = await sb.from(TABLE).upsert(sent, { onConflict: "email" }); if (error) throw error }
  // A failure must never overwrite an earlier successful send
  if (failed.length) { const { error } = await sb.from(TABLE).upsert(failed, { onConflict: "email", ignoreDuplicates: true }); if (error) throw error }
}
