import type { Company, Founder, Template } from "./types";

export const DEFAULTS: Template = {
  my_name: "", portfolio: "", github: "", resume: "",
  subject: "Founding engineer interest: {company}",
  body: `Hey {first_name},

saw {company} ({one_liner}) and it's the kind of problem I'd like to work on.

I'm Anirban, a Codeforces Candidate Master (max 2056) and a final-year student at Jadavpur University. I'm the founder of Juris IQ (open source legal infra), where we're building Nyayflow, an AI legal workspace for Indian lawyers with citation-backed research over 75+ years of judgments.

I've been a founding engineer at three startups:
- Alchemyst AI: shipped 150+ REST APIs, built the RAG pipelines and context graph (500+ enterprise users) and the AI memory layer so agents keep context across sessions, plus the Voice AI agent with its own memory system.
- Modus AI (fintech): handled their integrations and built the reconciliation engine and fraud system for Fraud Co-Pilot, which helped land a major bank client.
- Quant Insider (current): building Sarvaex, a prediction market with low-latency trading infra in Rust.

I also build in Rust, Go and TypeScript, and I have 20+ merged PRs across CCExtractor, CoW Protocol and OHC Network. My HireSignal resume analyzer has 135K+ users.

Would love to help out at {company} if you're hiring (intern or full-time). Happy to do a small trial task.

Best regards,
{my_name}
Portfolio: {portfolio}
GitHub: {github}
Resume: {resume}`,
};

export const PAGE = 20;            // companies loaded per click
export const SEND_CAP = 100;       // emails per "Send all"
export const SEND_CHUNK = 10;      // emails per request to the engine
// Same keys as the old single-file app, so your saved details, sent marks and cached batches carry over
export const KEY = "yc-outreach-v2";   // sent marks and cached batches
export const TKEY = "yc-outreach-v3";  // your details and template

export const store = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d } catch { return d } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
};

export type Kind = "site" | "guess" | "none";
export interface Best { email: string; kind: Kind; label: string }

// Best email for a founder: on the company site > pattern guess
export function best(f: Founder): Best {
  if (f.emails_found?.length) return { email: f.emails_found[0], kind: "site", label: "on site" };
  if (f.email_guesses?.length) return { email: f.email_guesses[0], kind: "guess", label: "guess" };
  return { email: "", kind: "none", label: "no email" };
}
const RANK: Record<Kind, number> = { site: 0, guess: 1, none: 2 };

// Primary contact first: best email, then CEO
export function contacts(c: Company): Founder[] {
  return [...(c.founders || [])].sort((a, b) =>
    (RANK[best(a).kind] - RANK[best(b).kind]) || (Number(!/ceo/i.test(a.title)) - Number(!/ceo/i.test(b.title))));
}

export function fill(text: string, c: Company, tpl: Template, founder?: Founder) {
  const f = founder || contacts(c)[0] || { name: "" };
  const vars: Record<string, string> = {
    first_name: f.name.split(" ")[0] || "there", company: c.name,
    one_liner: (c.one_liner || "what you're building").replace(/[^\p{L}\p{N})\]]+$/u, "").toLowerCase(),
    batch: c.batch ?? "", my_name: tpl.my_name, portfolio: tpl.portfolio, github: tpl.github, resume: tpl.resume,
  };
  const out = text.replace(/\{(\w+)\}/g, (m, k: string) => k in vars ? vars[k] : m);
  return out.split("\n").filter(l => !/^\s*[\w ]+:\s*$/.test(l)).join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Plain template text -> clean HTML: paragraphs, "- " bullets as a list, links clickable
export function toHtml(text: string) {
  const link = (t: string) => esc(t).replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)]/g, u => `<a href="${u}">${u}</a>`);
  let html = "", lines: string[] = [], items: string[] = [];
  const flushLines = (tight?: boolean) => { if (lines.length) { html += `<p style="margin:0 0 ${tight ? 6 : 14}px">${lines.join("<br>")}</p>`; lines = [] } };
  const flushItems = () => { if (items.length) { html += `<ul style="margin:0 0 14px;padding-left:20px">${items.join("")}</ul>`; items = [] } };
  for (const line of text.trim().split("\n")) {
    const m = line.match(/^\s*[-•]\s+(.+)$/);
    if (!line.trim()) { flushLines(); flushItems() }
    else if (m) { flushLines(true); items.push(`<li style="margin:0 0 4px">${link(m[1])}</li>`) }
    else { flushItems(); lines.push(link(line)) }
  }
  flushLines(); flushItems();
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${html}</div>`;
}

export const needsFetch = (c: Company) => !c.error && (!c.founders || c.job_count == null);

export async function api<T>(params: Record<string, string>, path = "/api/yc"): Promise<T> {
  const r = await fetch(path + (Object.keys(params).length ? "?" + new URLSearchParams(params) : ""));
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
