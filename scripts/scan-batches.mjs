// Counts, for each batch, how many companies have an email address to send to, and saves it to Supabase (table yc_batch_stats).
// The "Sent by batch" bar then counts against those companies instead of the whole batch.
// Needs `npm run dev` running. Reads only YC data; sends nothing.
//   node --env-file=.env.local scripts/scan-batches.mjs "Fall 2026" "Summer 2026" ...
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_URL || "http://localhost:3000";
const batches = process.argv.slice(2);
if (!batches.length) { console.error("Pass the batch names to scan, e.g. \"Fall 2026\" \"Summer 2026\""); process.exit(1) }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const get = async params => {
  const r = await fetch(`${APP}/api/yc?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`${params.action} failed: HTTP ${r.status}`);
  return r.json();
};

const PARALLEL = 3;
for (const batch of batches) {
  const companies = await get({ action: "companies", batch });
  const chunks = [];
  for (let i = 0; i < companies.length; i += 10) chunks.push(companies.slice(i, i + 10));
  let done = 0, failed = 0;
  const names = new Set();   // the history counts companies by name, so two companies sharing a name count once
  const work = async chunk => {
    let res;
    for (let attempt = 1; !res; attempt++) {
      try { res = await get({ action: "founders", slugs: chunk.map(c => c.slug).join(",") }) }
      catch (e) { if (attempt === 3) { res = []; failed += chunk.length } }
    }
    for (const r of res) {
      if (r.error) failed++;
      else if ((r.founders ?? []).some(f => (f.emails_found?.length || f.email_guesses?.length))) names.add(companies.find(c => c.slug === r.slug).name);
    }
    done += chunk.length;
    process.stdout.write(`\r${batch}: ${done}/${companies.length} companies   `);
  };
  const queue = [...chunks];
  await Promise.all(Array.from({ length: PARALLEL }, async () => { for (let c; (c = queue.shift());) await work(c) }));
  if (failed) { console.log(`\n  ${failed} companies could not be loaded, so ${batch} was not saved. Run it again.`); continue }
  const { error } = await sb.from("yc_batch_stats").upsert({ batch, total: companies.length, mailable: names.size, scanned_at: new Date().toISOString() }, { onConflict: "batch" });
  if (error) { console.error("\n" + error.message); process.exit(1) }
  console.log(`\n  ${names.size} of ${companies.length} companies have an email`);
}
