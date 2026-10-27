"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BatchInfo, Company, FounderResult, Template } from "@/lib/types";
import {
  DEFAULTS, KEY, PAGE, SEND_CAP, SEND_CHUNK, TKEY, api, best, contacts, fill, needsFetch, store, toHtml,
} from "@/lib/outreach";
import CompanyCard from "./CompanyCard";

interface Msg { text: string; err?: boolean }
interface Queued { c: Company; founder: string; email: string; kind: string; subject: string; body: string }
interface BatchStat { batch: string; emails: number; companies: number }
interface SendResult { success: boolean; message: string }

const DETAILS = ["my_name", "portfolio", "github", "resume"] as const;
const placeholders = ["first_name", "company", "one_liner", "batch", "my_name", "portfolio", "github", "resume"];

export default function OutreachApp() {
  const [tpl, setTpl] = useState<Template>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());       // companies
  const [sentMail, setSentMail] = useState<Set<string>>(new Set()); // individual addresses already emailed
  const [ledger, setLedger] = useState<Set<string>>(new Set());   // addresses in the mail engine's sent log
  const [ledgerErr, setLedgerErr] = useState(false);
  const [stats, setStats] = useState<BatchStat[] | null>(null);
  const [doneBatches, setDoneBatches] = useState<Set<string>>(new Set());
  const [mailable, setMailable] = useState<Record<string, number>>({});   // companies per batch that have an email   // per-batch history from Supabase
  const [statsErr, setStatsErr] = useState("");
  const sentRef = useRef(sent), sentMailRef = useRef(sentMail);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [batch, setBatch] = useState("");
  const [all, setAll] = useState<Company[]>([]);
  const allRef = useRef<Company[]>([]);
  const batchRef = useRef("");
  const [loadMsg, setLoadMsg] = useState<Msg>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(""), [st, setSt] = useState(""), [hideSent, setHideSent] = useState(false), [hiring, setHiring] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sendMsg, setSendMsg] = useState<Msg>({ text: "" });
  const [sending, setSending] = useState(false);
  const stopSend = useRef(false);
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Load everything saved in this browser
  useEffect(() => {
    const old = store.get<Partial<Template>>(KEY, {});
    const oldDetails = Object.fromEntries(DETAILS.map(k => [k, old[k]]).filter(([, v]) => v));
    setTpl({ ...DEFAULTS, ...oldDetails, ...store.get<Partial<Template>>(TKEY, {}) });
    sentRef.current = new Set(store.get<string[]>(KEY + "-sent", []));
    sentMailRef.current = new Set(store.get<string[]>(KEY + "-sentmail", []));
    setSent(sentRef.current); setSentMail(sentMailRef.current);
    setHydrated(true);
    refreshStats();
    api<{ addresses: string[] }>({}, "/api/sent")
      .then(r => setLedger(new Set(r.addresses)))
      .catch(() => setLedgerErr(true));
    const last = store.get<string>(KEY + "-last", "");
    api<BatchInfo[]>({ action: "batches" }).then(bs => {
      const list = bs.filter(b => b.batch !== "Unspecified");
      setBatches(list);
      setBatch(list.some(b => b.batch === last) ? last : list[0]?.batch ?? "");
    }).catch(e => setLoadMsg({ text: e.message, err: true }));
  }, []);
  useEffect(() => { if (hydrated) store.set(TKEY, tpl) }, [tpl, hydrated]);

  function refreshStats() {
    api<{ rows: BatchStat[]; done: string[]; mailable?: Record<string, number> }>({}, "/api/stats").then(r => { setStats(r.rows); setDoneBatches(new Set(r.done)); setMailable(r.mailable ?? {}); setStatsErr("") }).catch(e => setStatsErr(e.message));
  }

  // Once every company in a batch is loaded, remember how many have an email so the "Sent by batch" bar counts against those
  function saveMailable(name: string, list: Company[], failed: number) {
    if (!name || !list.length || failed || list.some(needsFetch)) return;
    const n = new Set(list.filter(c => contacts(c).some(f => best(f).email)).map(c => c.name)).size;   // by name, like the history
    if (mailable[name] === n) return;
    fetch("/api/batch-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: name, total: list.length, mailable: n }) })
      .then(r => r.ok && setMailable(m => ({ ...m, [name]: n })))
      .catch(() => {});
  }

  async function markDone(name: string, on: boolean) {
    const r = await fetch("/api/batch-done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: name, done: on }) });
    if (!r.ok) return setStatsErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    setDoneBatches(prev => { const n = new Set(prev); on ? n.add(name) : n.delete(name); return n });
  }

  const setCompanies = (list: Company[]) => { allRef.current = list; setAll(list); };
  const patchCompanies = (fn: (c: Company) => Company) => setCompanies(allRef.current.map(fn));
  const persist = () => store.set(`${KEY}-batch-${batchRef.current}`, allRef.current);

  const data = useMemo(() => all.filter(c => c.founders || c.error), [all]);
  const left = useMemo(() => all.filter(needsFetch).length, [all]);

  // Addresses already emailed (this browser, the engine's log, the Supabase history); a company is sent once all its founders with an email are in it
  const done = useMemo(() => new Set([...sentMail, ...ledger]), [sentMail, ledger]);
  const isSent = (c: Company) => {
    if (sent.has(c.name)) return true;
    const addrs = contacts(c).map(f => best(f).email.toLowerCase()).filter(Boolean);
    return addrs.length > 0 && addrs.every(a => done.has(a));
  };

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.filter(c => {
      const fs = contacts(c), f = fs[0];
      const kind = f ? best(f).kind : c.founders ? "none" : "";
      const key = (c.name + " " + fs.map(o => o.name).join(" ")).toLowerCase();
      return (!ql || key.includes(ql)) && (!st || kind === st) && !(hideSent && isSent(c)) && (!hiring || (c.job_count ?? 0) > 0);
    });
  }, [data, q, st, hideSent, hiring, sent, done]);

  // Every founder with an email at each company shown, skipping addresses already emailed
  const queue = useMemo<Queued[]>(() => {
    const seen = new Set([...sentMail, ...ledger]), out: Queued[] = [];
    for (const c of shown) {
      if (isSent(c)) continue;
      for (const f of contacts(c)) {
        const b = best(f), key = b.email.toLowerCase();
        if (!b.email || seen.has(key)) continue;
        seen.add(key);
        out.push({ c, founder: f.name, email: b.email, kind: b.kind, subject: fill(tpl.subject, c, tpl, f), body: fill(tpl.body, c, tpl, f) });
      }
    }
    return out.slice(0, SEND_CAP);
  }, [shown, sent, done, tpl]);

  // Per batch, from the Supabase history: companies mailed (at least one founder) out of the whole batch
  const rows = useMemo(() => {
    const by = new Map((stats ?? []).map(r => [r.batch, r]));
    const list = batches.map(b => ({ batch: b.batch, total: mailable[b.batch] ?? b.count, scanned: b.batch in mailable, all: b.count, companies: by.get(b.batch)?.companies ?? 0, emails: by.get(b.batch)?.emails ?? 0 }));
    return list.sort((a, b) => (b.emails > 0 ? 1 : 0) - (a.emails > 0 ? 1 : 0));   // batches you have mailed first, YC order kept
  }, [batches, stats, mailable]);

  async function loadBatch(name = batch) {
    if (!name) return;
    batchRef.current = name; store.set(KEY + "-last", name);
    setBusy(true); setOpen(new Set());
    let list = store.get<Company[] | null>(`${KEY}-batch-${name}`, null) || [];
    try {
      if (!list.length) {
        setLoadMsg({ text: "Loading companies…" });
        list = (await api<Company[]>({ action: "companies", batch: name })).sort((a, b) => b.launched_at - a.launched_at);
        store.set(`${KEY}-batch-${name}`, list);
      }
    } catch (e) {
      setBusy(false);
      return setLoadMsg({ text: `Couldn't load this batch: ${(e as Error).message}`, err: true });
    }
    setCompanies(list);
    // Fetch on open only for an empty batch, or to fill job counts missing from an older cache
    const stale = list.some(c => c.founders && c.job_count == null && !c.error);
    if (!list.some(c => c.founders || c.error) || stale) return loadMore();
    progress(); setBusy(false);
  }

  function progress() {
    const d = allRef.current.filter(c => c.founders || c.error), failed = d.filter(c => c.error).length;
    saveMailable(batchRef.current, allRef.current, failed);
    const hiringN = d.filter(c => (c.job_count ?? 0) > 0).length;
    setLoadMsg({ text: `${d.length} of ${allRef.current.length} companies loaded${failed ? `, ${failed} couldn't be loaded` : ""}. ${hiringN} with open roles on YC.`, err: failed > 0 });
  }

  // Founders come from each company's YC page, so load PAGE at a time: 10 per request, 2 requests at once
  async function loadMore() {
    const next = allRef.current.filter(needsFetch).slice(0, PAGE);
    if (!next.length) return progress();
    setBusy(true);
    const chunks: Company[][] = [];
    for (let i = 0; i < next.length; i += 10) chunks.push(next.slice(i, i + 10));
    setLoadMsg({ text: `Loading founders and open roles for ${next.length} companies…` });
    await Promise.all(chunks.map(async chunk => {
      let patch = new Map<string, Partial<Company>>();
      try {
        const res = await api<FounderResult[]>({ action: "founders", slugs: chunk.map(c => c.slug).join(",") });
        res.forEach(r => patch.set(r.slug, r));
      } catch (e) { chunk.forEach(c => patch.set(c.slug, { error: `Couldn't load founders: ${(e as Error).message}` })) }
      patchCompanies(c => patch.has(c.slug) ? { ...c, ...patch.get(c.slug) } : c);
    }));
    persist(); progress(); setBusy(false);
  }

  function setCompanySent(c: Company, on: boolean) {
    on ? sentRef.current.add(c.name) : sentRef.current.delete(c.name);
    setSent(new Set(sentRef.current)); store.set(KEY + "-sent", [...sentRef.current]);
  }

  // Remember the address; the company counts as sent once every founder with an email has been emailed
  function markEmailed(o: Queued) {
    sentMailRef.current.add(o.email.toLowerCase());
    setSentMail(new Set(sentMailRef.current)); store.set(KEY + "-sentmail", [...sentMailRef.current]);
    if (contacts(o.c).some(f => { const e = best(f).email; return e && !sentMailRef.current.has(e.toLowerCase()) })) return;
    setCompanySent(o.c, true);
  }

  async function sendAll() {
    if (sending) { stopSend.current = true; return setSendMsg({ text: "Stopping after this batch…" }) }
    const drafts = queue;
    if (!drafts.length) return setSendMsg({ text: "Nothing to send: no unsent companies with an email in the current view.", err: true });
    if (!tpl.my_name.trim()) return setSendMsg({ text: "Fill in your name in step 1 first.", err: true });
    const bad = drafts.find(d => /\[[^\]\n]{8,}\]/.test(d.body) || /\{\w+\}/.test(d.subject + d.body));
    if (bad) return setSendMsg({ text: `The template still has a placeholder like [..] or {..} (see ${bad.c.name}). Fix it first.`, err: true });
    const guesses = drafts.filter(d => d.kind === "guess").length, companies = new Set(drafts.map(d => d.c)).size;
    if (!confirm(`Send ${drafts.length} emails to ${companies} companies (every founder with an address) from your mail engine?\n${guesses} of them go to guessed addresses and may bounce.\nThis can't be undone.`)) return;
    setSending(true); stopSend.current = false;
    let ok = 0, failed = 0, skipped = 0;
    try {
      for (let i = 0; i < drafts.length && !stopSend.current; i += SEND_CHUNK) {
        const chunk = drafts.slice(i, i + SEND_CHUNK);
        setSendMsg({ text: `Sending ${i + 1}–${i + chunk.length} of ${drafts.length}… (${ok} sent, ${failed} failed)` });
        const r = await fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chunk.map(d => ({ to: d.email, subject: d.subject, body: d.body, html: toHtml(d.body),
            company: d.c.name, batch: d.c.batch || batchRef.current, founder: d.founder, kind: d.kind })) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.results) throw new Error(j.error || `mail engine returned HTTP ${r.status}`);
        (j.results as SendResult[]).forEach((res, k) => {
          if (!res.success) { failed++; return console.warn("send failed", chunk[k].email, res.message) }
          res.message.startsWith("Already sent") ? skipped++ : ok++;
          markEmailed(chunk[k]);
        });
      }
      refreshStats();
      setSendMsg({ text: `${stopSend.current ? "Stopped" : "Done"}: ${ok} sent, ${skipped} skipped (already sent), ${failed} failed${failed ? " (see browser console)" : ""}.`, err: failed > 0 });
    } catch (e) {
      setSendMsg({ text: `Stopped: ${(e as Error).message}. ${ok} sent so far.`, err: true });
    } finally {
      setSending(false);
    }
  }

  const field = (k: keyof Template) => ({
    value: tpl[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTpl(t => ({ ...t, [k]: e.target.value })),
  });
  const insert = (name: string) => {
    const el = lastField.current ?? document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if (!el) return;
    const k = el.name as "subject" | "body", s = el.selectionStart ?? el.value.length, tag = `{${name}}`;
    setTpl(t => ({ ...t, [k]: t[k].slice(0, s) + tag + t[k].slice(el.selectionEnd ?? s) }));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + tag.length });
  };
  const track = { onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { lastField.current = e.target } };
  const allOpen = shown.length > 0 && shown.every(c => open.has(c.slug));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(shown.map(c => c.slug)));

  const hiringCount = data.filter(c => (c.job_count ?? 0) > 0).length;
  const pct = all.length ? Math.round((data.length / all.length) * 100) : 0;

  return (
    <main>
      <header className="head">
        <h1>YC Founder Outreach</h1>
        <p className="sub">Pick a YC batch, find founder emails, and send a personalised cold email to each one from a single template. Everything you type stays in your browser; mail goes out through your own mail engine.</p>
      </header>

      <div className="top">
        <section className="panel tpl">
          <h2>Email template</h2>
          <p className="hint">Every founder gets their own copy with the placeholders filled in.</p>
          <label className="f">Subject<input name="subject" {...field("subject")} {...track} /></label>
          <label className="f grow">Body<textarea name="body" {...field("body")} {...track} /></label>
          <p className="ph">Insert: {placeholders.map(p => <code key={p} onClick={() => insert(p)}>{`{${p}}`}</code>)}
            &nbsp;<button type="button" className="sm" onClick={() => setTpl(t => ({ ...t, subject: DEFAULTS.subject, body: DEFAULTS.body }))}>Reset template</button></p>
        </section>

        <div className="side">
          <section className="panel">
            <h2>Your details</h2>
            <p className="hint">Used for the signature and links in every email.</p>
            <div className="grid">
              <label className="f">Your name<input placeholder="Jane Doe" autoComplete="name" {...field("my_name")} /></label>
              <label className="f">Portfolio / website<input placeholder="https://..." {...field("portfolio")} /></label>
              <label className="f">GitHub<input placeholder="https://github.com/..." {...field("github")} /></label>
              <label className="f">Resume link<input placeholder="https://..." {...field("resume")} /></label>
            </div>
          </section>

          <section className="panel grow">
            <h2>YC batch</h2>
            <p className="hint">Founders and open roles load 20 companies at a time.</p>
            <div className="row2">
              <select aria-label="YC batch" value={batch} onChange={e => setBatch(e.target.value)}>
                {!batches.length && <option value="">Loading batches…</option>}
                {batches.map(b => <option key={b.batch} value={b.batch}>{b.batch} ({b.count} {b.count === 1 ? "company" : "companies"})</option>)}
              </select>
              <button className="primary" type="button" disabled={busy || !batch} onClick={() => loadBatch()}>Load companies</button>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            <p className={`status${loadMsg.err ? " err" : ""}`}>{loadMsg.text || (all.length ? "" : "Pick a batch and load it to see its founders.")}</p>
          </section>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span>Loaded</span><b>{data.length}<small> / {all.length}</small></b></div>
        <div className="stat"><span>Hiring on YC</span><b>{hiringCount}</b></div>
        <div className="stat"><span>Ready to send</span><b>{queue.length}</b></div>
        <div className="stat"><span>Companies sent</span><b>{data.filter(isSent).length}</b></div>
      </div>

      <section className="panel byb">
        <h2>Sent by batch</h2>
        <p className="hint">
          Companies where at least one founder has been emailed, out of the whole batch. Mark a batch done once you have finished it and its bar fills. Kept in Supabase, so it is the same in any browser.
          {statsErr && ` Couldn't read the history: ${statsErr}`}
          {ledgerErr && " Couldn't read the sent list, so Send all may not skip people you already mailed."}
        </p>
        {stats ? (
          <div className="wrap"><table>
            <thead><tr><th>Batch</th><th>Progress</th><th className="num">Companies mailed</th><th className="num">Emails sent</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const fin = doneBatches.has(r.batch), p = fin ? 100 : r.total ? Math.min(100, Math.round((r.companies / r.total) * 100)) : 0;
                return (
                  <tr key={r.batch} className={`${r.batch === batch ? "cur" : ""}${r.emails || doneBatches.has(r.batch) ? "" : " off"}`}>
                    <td>{r.total ? <button type="button" className="link" onClick={() => setBatch(r.batch)}>{r.batch}</button> : r.batch}</td>
                    <td><div className="progress" role="progressbar" aria-label={`${r.batch} sent`} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${p}%` }} /></div></td>
                    <td className="num">{fin ? <><b className="badge">Done</b> <small>{r.companies} of {r.total} {r.scanned ? "with an email" : "companies"} mailed</small></> : <>{r.companies}{r.total ? ` / ${r.total}` : ""} {r.total > 0 && <small>({p}%)</small>}{r.total > 0 && !r.scanned && <small title="Load this whole batch once to count only companies that have an email"> · not scanned</small>}</>}</td>
                    <td className="num">{r.emails}</td>
                    <td className="num">{r.total > 0 && <button type="button" className="sm" onClick={() => markDone(r.batch, !fin)}>{fin ? "Undo" : "Mark done"}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <p className="status">{statsErr ? "" : "Loading history…"}</p>}
      </section>

      <div className="bar">
        <input id="q" placeholder="Search company or founder" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Email type" value={st} onChange={e => setSt(e.target.value)}>
          <option value="">All emails</option><option value="site">Found on site</option><option value="guess">Guess</option><option value="none">No email</option>
        </select>
        <label className="chk switch"><input type="checkbox" role="switch" checked={hideSent} onChange={e => setHideSent(e.target.checked)} /> hide sent</label>
        <label className="chk switch"><input type="checkbox" role="switch" checked={hiring} onChange={e => setHiring(e.target.checked)} /> hiring</label>
        <button id="all" type="button" onClick={toggleAll}>{allOpen ? "Collapse all" : "Expand all"}</button>
        <button id="send" className="primary" type="button" disabled={!sending && !queue.length} onClick={sendAll}>
          {sending ? "Stop" : queue.length ? `Send all (${queue.length})` : "Send all"}
        </button>
      </div>
      <p className={`status${sendMsg.err ? " err" : ""}`}>{sendMsg.text}</p>
      <p className="count">{data.length ? `${shown.length} of ${data.length} companies shown` : ""}</p>

      <div className="list">
        {shown.map(c => (
          <CompanyCard key={c.slug} c={c} tpl={tpl} open={open.has(c.slug)} sent={isSent(c)}
            onOpen={o => setOpen(prev => { const n = new Set(prev); o ? n.add(c.slug) : n.delete(c.slug); return n })}
            onSent={on => setCompanySent(c, on)} />
        ))}
      </div>
      {left > 0 && (
        <p style={{ textAlign: "center" }}>
          <button className="primary" type="button" disabled={busy} onClick={loadMore}>Load {Math.min(PAGE, left)} more ({left} left)</button>
        </p>
      )}
      <footer>Open source. Company and founder data comes from YC&apos;s public directory. Please write to people one at a time and respect &quot;no&quot;.</footer>
    </main>
  );
}
