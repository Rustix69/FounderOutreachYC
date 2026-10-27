// Server-only Supabase access for the sent-mail history. Uses the secret key, so never import this from a client component.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TABLE = "yc_sent_mail";

export interface SentRow {
  email: string;
  founder?: string | null;
  company?: string | null;
  batch?: string | null;
  kind?: string | null;
  status?: "sent" | "failed";
  detail?: string | null;
}

// Untyped on purpose: the table is created by hand in the Supabase SQL editor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = SupabaseClient<any, any, any>;
let client: Untyped | null = null;

export function db(): Untyped | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return (client ??= createClient(url, key, { auth: { persistSession: false } }) as Untyped);
}

// Supabase returns at most 1000 rows per request, so read the table page by page
export async function allRows<T = SentRow & { sent_at: string }>(columns: string, status?: string): Promise<T[]> {
  const sb = db();
  if (!sb) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY)");
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(TABLE).select(columns).order("email").range(from, from + 999);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) return out;
  }
}
