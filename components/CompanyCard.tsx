"use client";
import type { Company, Template } from "@/lib/types";
import { best, contacts, fill } from "@/lib/outreach";

const safeUrl = (s?: string) => (/^https?:\/\//i.test(s || "") ? s : undefined);

function Ext({ href, children }: { href?: string; children: React.ReactNode }) {
  const u = safeUrl(href);
  return u ? <> · <a className="lnk" href={u} target="_blank" rel="noopener">{children}</a></> : null;
}

interface Props {
  c: Company;
  tpl: Template;
  open: boolean;
  sent: boolean;
  onOpen: (open: boolean) => void;
  onSent: (sent: boolean) => void;
}

export default function CompanyCard({ c, tpl, open, sent, onOpen, onSent }: Props) {
  const fs = contacts(c), f = fs[0];
  const b = f ? best(f) : { kind: c.founders ? "none" : "", label: c.error ? "error" : c.founders ? "no email" : "loading…" };
  // Drafts are only built for open cards
  const subject = open ? fill(tpl.subject, c, tpl) : "", body = open ? fill(tpl.body, c, tpl) : "";
  const to = f ? best(f).email : "";
  const copy = (e: React.MouseEvent<HTMLButtonElement>, text: string) => {
    const btn = e.currentTarget, old = btn.textContent;
    navigator.clipboard.writeText(text).then(() => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = old), 1200) });
  };

  return (
    <details open={open} className={sent ? "sent" : ""}
      onToggle={e => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onOpen(o) }}>
      <summary>
        <span className="name">{c.name}</span>
        <span className={`badge ${b.kind || "none"}`}>{b.label}</span>
        <span className="meta">
          {f?.name || ""}<br />{c.batch}
          {!!c.job_count && <><br /><span className="roles">{c.job_count} {c.job_count === 1 ? "open role" : "open roles"}</span></>}
        </span>
      </summary>
      {open && (
        <div className="body">
          <p className="one">
            {c.one_liner}<Ext href={c.website}>website</Ext>
            {" · "}<a className="lnk" href={`https://www.ycombinator.com/companies/${c.slug}`} target="_blank" rel="noopener">YC</a>
            <Ext href={f?.linkedin}>LinkedIn</Ext><Ext href={f?.twitter}>X</Ext>
          </p>
          {c.error && <p className="status err">{c.error}</p>}
          {c.job_count != null && (
            <div className="r"><b>Jobs</b>
              {c.job_count === 0 ? "No open roles on YC" : <>
                {c.job_count} open on YC
                {(c.jobs || []).map((j, i) => <span key={i}> · {safeUrl(j.url)
                  ? <a className="lnk" href={safeUrl(j.url)} target="_blank" rel="noopener">{j.title}</a> : j.title}</span>)}
              </>}
            </div>
          )}
          {fs.map((o, i) => {
            const e = best(o);
            return (
              <div className="r" key={i}><b>{o === f ? "To" : "Also"}</b>
                {o.name}{o.title ? ` (${o.title})` : ""} · {e.email || "no email"} <span className={`badge ${e.kind}`}>{e.label}</span>
              </div>
            );
          })}
          <div className="r"><b>Subject</b><span>{subject}</span></div>
          <pre>{body}</pre>
          <div className="acts">
            <button className="primary" type="button" onClick={e => copy(e, body)}>Copy body</button>
            <button type="button" onClick={e => copy(e, to)}>Copy email</button>
            <button type="button" onClick={e => copy(e, subject)}>Copy subject</button>
            <a className="btn" href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in mail app</a>
            <label className="chk"><input type="checkbox" checked={sent} onChange={e => onSent(e.target.checked)} /> sent</label>
          </div>
        </div>
      )}
    </details>
  );
}
