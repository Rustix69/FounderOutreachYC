// Server-side YC data: batches, companies and founders. No API key; the Algolia search key is read from ycombinator.com.
// Founder names only live on each company's ycombinator.com page, which browsers can't fetch cross-origin.
import { lookup } from "node:dns/promises";
import type { BatchInfo, Company, FounderResult, Job } from "./types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.|@2x|u00|domain\.com|email\.com/i;
export const SLUG_RE = /^[a-z0-9-]{1,100}$/;
export const BATCH_RE = /^(Winter|Spring|Summer|Fall) \d{4}$|^[WSFX]\d{2}$|^IK12$|^Unspecified$/;
export const MAX_SLUGS = 10;
const SEASON: Record<string, number> = { Winter: 1, Spring: 2, Summer: 3, Fall: 4 };
const SITE_DEADLINE = 4000; // ms per company before giving up on its website

let algoliaKey: { app: string; key: string } | null = null; // cached per warm instance

// One attempt with a short timeout: a web request can't wait around
async function get(url: string, opts: { timeout?: number; body?: string; headers?: Record<string, string> } = {}) {
  try {
    const r = await fetch(url, {
      method: opts.body ? "POST" : "GET",
      body: opts.body,
      headers: { "User-Agent": UA, ...opts.headers },
      signal: AbortSignal.timeout(opts.timeout ?? 8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.text()).slice(0, 2_000_000);
  } catch {
    return null;
  }
}

function htmlUnescape(s: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

const unquote = (s: string) => s.replace(/(?:%[0-9a-f]{2})+/gi, m => { try { return decodeURIComponent(m) } catch { return m } });

async function algolia(params: Record<string, string | number>) {
  if (!algoliaKey) {
    const m = (await get("https://www.ycombinator.com/companies"))?.match(/window\.AlgoliaOpts = \{"app":"(\w+)","key":"([^"]+)"/);
    if (!m) throw new Error("Could not read YC's company search");
    algoliaKey = { app: m[1], key: m[2] };
  }
  const { app, key } = algoliaKey;
  const body = JSON.stringify({ params: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() });
  for (const host of [`${app}-dsn.algolia.net`, `${app}-1.algolianet.com`, `${app}-2.algolianet.com`]) { // Algolia's fallback hosts
    const res = await get(`https://${host}/1/indexes/YCCompany_production/query`, {
      body, headers: { "X-Algolia-Application-Id": app, "X-Algolia-API-Key": key, "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (res !== null) return JSON.parse(res);
  }
  algoliaKey = null; // key may have rotated
  throw new Error("YC company search failed");
}

function batchKey(b: string): [number, number] {
  const p = b.split(" ");
  return p.length === 2 && /^\d+$/.test(p[1]) ? [+p[1], SEASON[p[0]] ?? 0] : [0, 0];
}

export async function batches(): Promise<BatchInfo[]> {
  const res = await algolia({ hitsPerPage: 0, facets: JSON.stringify(["batch"]), maxValuesPerFacet: 1000 });
  return Object.entries(res.facets.batch as Record<string, number>)
    .map(([batch, count]) => ({ batch, count }))
    .sort((a, b) => { const x = batchKey(a.batch), y = batchKey(b.batch); return y[0] - x[0] || y[1] - x[1] });
}

export async function companies(batch: string): Promise<Company[]> {
  const hits: any[] = [];
  for (let page = 0; ; page++) {
    const res = await algolia({ hitsPerPage: 1000, page, facetFilters: JSON.stringify([[`batch:${batch}`]]) });
    hits.push(...res.hits);
    if (page + 1 >= res.nbPages) break;
  }
  return hits.map(h => ({
    name: h.name, slug: h.slug, batch: h.batch, website: h.website || "", one_liner: h.one_liner || "",
    industry: h.subindustry || "", team_size: h.team_size, launched_at: h.launched_at || 0,
  }));
}

function domainOf(website: string) {
  try {
    return new URL(website.includes("//") ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const asciiName = (s: string) =>
  s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);

async function siteEmails(website: string, domain: string) {
  const found = new Set<string>();
  // 2 pages, so a whole request fits in a function timeout
  const pages = await Promise.all(["", "/contact"].map(path => get(website.replace(/\/+$/, "") + path, { timeout: 3000 })));
  for (const body of pages) {
    for (let e of unquote(htmlUnescape(body ?? "")).match(EMAIL_RE) ?? []) {
      e = e.toLowerCase().replace(/^\.+|\.+$/g, "");
      const host = e.split("@")[1];
      if (!BAD_EMAIL.test(e) && (host === domain || host.endsWith("." + domain))) found.add(e);
    }
  }
  return [...found].sort();
}

function guesses(fullName: string, domain: string) {
  const parts = asciiName(fullName);
  if (!parts.length || !domain) return [];
  const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : "";
  return [`${first}@${domain}`, ...(last ? [`${first}.${last}@${domain}`, `${first[0]}${last}@${domain}`, `${first}${last}@${domain}`] : [])];
}

const resolves = (domain: string) => lookup(domain).then(() => true, () => false);

function openJobs(props: any): Job[] {
  // jobPostings is on the same company page as the founders, next to props.company
  return (props.jobPostings || [])
    .filter((j: any) => j && typeof j === "object" && !j.isIncomplete)
    .map((j: any) => {
      const path: string = j.url || "";
      return { title: j.title || "Open role", url: path.startsWith("/") ? "https://www.ycombinator.com" + path : path };
    });
}

export async function founders(slug: string): Promise<FounderResult> {
  const page = await get(`https://www.ycombinator.com/companies/${slug}`);
  const m = page?.match(/data-page="([^"]*)"/);
  let props: any;
  try { props = JSON.parse(htmlUnescape(m![1])).props } catch { return { slug, error: "Couldn't load this company's YC page" } }
  const c = props.company;
  const jobs = openJobs(props);
  const website: string = c.website || ""; // always from YC, never from the client
  const domain = domainOf(website);
  // a slow site is skipped; the pattern guesses still cover it
  const emails = domain
    ? await Promise.race([siteEmails(website, domain), new Promise<string[]>(r => setTimeout(() => r([]), SITE_DEADLINE))])
    : [];
  const dns = domain ? await resolves(domain) : false;
  return {
    slug, website, domain, linkedin: c.linkedin_url || "", twitter: c.twitter_url || "", site_emails: emails,
    job_count: jobs.length, jobs,
    founders: (c.founders || []).map((f: any) => {
      const name: string = f.full_name || "";
      const first = asciiName(name)[0] ?? "";
      return {
        name, title: f.title || "", linkedin: f.linkedin_url || "", twitter: f.twitter_url || "",
        emails_found: emails.filter(e => first && e.split("@")[0].startsWith(first)),
        email_guesses: dns ? guesses(name, domain) : [],
      };
    }),
  };
}
