// One-time import of the mail engine's sent_log.txt into Supabase (table yc_sent_mail).
// Needs `npm run dev` running (it asks the app for each batch's founders to work out which company an address belongs to).
//   node --env-file=.env.local scripts/import-sent-log.mjs "Fall 2026" "Summer 2026" "Fall 2024"
// Batches you pass are matched address by address; anything else is stored without a batch.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_URL || "http://localhost:3000";
const LOG = process.env.SENT_LOG || "../EmailEngine/sent_log.txt";
const batches = process.argv.slice(2);
if (!batches.length) { console.error("Pass the batch names you mailed, e.g. \"Fall 2026\" \"Summer 2026\""); process.exit(1) }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const get = async params => {
  const r = await fetch(`${APP}/api/yc?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`${params.action} failed: HTTP ${r.status}`);
  return r.json();
};

// address -> { company, batch, founder, kind }; an address found on the site beats a guess
const owner = new Map();
const claim = (email, info) => {
  const k = email.toLowerCase(), have = owner.get(k);
  if (!have || (have.kind === "guess" && info.kind === "site")) owner.set(k, info);
};

const PARALLEL = 3;
for (const batch of batches) {
  const companies = await get({ action: "companies", batch });
  const chunks = [];
  for (let i = 0; i < companies.length; i += 10) chunks.push(companies.slice(i, i + 10));
  let done = 0;
  const work = async chunk => {
    let res;
    for (let attempt = 1; !res; attempt++) {
      try { res = await get({ action: "founders", slugs: chunk.map(c => c.slug).join(",") }) }
      catch (e) { if (attempt === 3) { console.warn(`  skipped ${chunk.length} companies: ${e.message}`); res = [] } }
    }
    for (const r of res) {
      const c = chunk.find(x => x.slug === r.slug);
      for (const f of r.founders ?? []) {
        for (const e of f.email_guesses ?? []) claim(e, { company: c.name, batch, founder: f.name, kind: "guess" });
        for (const e of [...(f.emails_found ?? []), ...(r.site_emails ?? [])]) claim(e, { company: c.name, batch, founder: f.name, kind: "site" });
      }
    }
    done += chunk.length;
    process.stdout.write(`\r${batch}: ${done}/${companies.length} companies   `);
  };
  const queue = [...chunks];
  await Promise.all(Array.from({ length: PARALLEL }, async () => { for (let c; (c = queue.shift());) await work(c) }));
  process.stdout.write("\n");
}

const lines = readFileSync(LOG, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
const rows = [], seen = new Set();
for (const line of lines) {
  const [addr, stamp] = line.split(/\s+/);
  const email = addr.toLowerCase();
  if (seen.has(email)) continue;
  seen.add(email);
  const t = Number(stamp);
  const info = owner.get(email) ?? {};
  rows.push({
    email, founder: info.founder ?? null, company: info.company ?? null, batch: info.batch ?? null, kind: info.kind ?? null,
    status: "sent", detail: "imported from sent_log.txt",
    ...(t > 1e9 ? { sent_at: new Date(t * 1000).toISOString() } : {}),
  });
}

// ignoreDuplicates: rows the app already saved are left alone
for (let i = 0; i < rows.length; i += 200) {
  const { error } = await sb.from("yc_sent_mail").upsert(rows.slice(i, i + 200), { onConflict: "email", ignoreDuplicates: true });
  if (error) { console.error(error.message); process.exit(1) }
}
const matched = rows.filter(r => r.batch).length;
console.log(`Imported ${rows.length} addresses; ${matched} matched to a company and batch, ${rows.length - matched} unmatched (stored without a batch).`);
