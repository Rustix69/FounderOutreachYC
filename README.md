# Founder Outreach

Pick any Y Combinator batch, get every company's founders and their likely email addresses, and write a personalised
cold email to each one from a single template. Then **Send all** through the Rust `EmailEngine` next door.

Next.js (App Router, TypeScript). Finding founders needs no API key and no account. A free [Supabase](https://supabase.com)
project is optional and keeps the history of who you emailed (see below).

```
npm install
npm run dev     # http://localhost:3000
```

Sending needs the [EmailEngine](https://github.com/Rustix69/EmailEngine) running on port 6969 (`cargo run` in that repo).
Copy `.env.example` to `.env.local` to point at a different engine or add Supabase.

## Sent history (Supabase, optional)

The **Sent by batch** panel shows, per batch, how many companies you have emailed out of the companies that have an
email address, with a progress bar. It reads a small Supabase database, so it is the same in every browser and survives
clearing your browser data.

1. Create a free project at supabase.com and run `supabase.sql` in its SQL editor (three small tables, all locked down:
   only the server's secret key can read or write them).
2. Put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the `sb_secret_...` key) in `.env.local`. The key stays on the server.
3. After each send, `/api/send` saves one row per email (address, founder, company, batch). Send all skips anyone already
   in the history or in the engine's sent log.
4. Use **Mark done** on a batch you have finished. A batch's bar counts against the companies that have an email; load a
   whole batch once (or run `scripts/scan-batches.mjs`) so the app knows how many that is.

Already emailed people before using this? `scripts/import-sent-log.mjs` imports the engine's `sent_log.txt` and works out
each address's company and batch (see the comments at the top of the script).

## What it does

1. **Pick a batch** (Summer 2005 through the latest) from YC's public directory.
2. **Founders load 20 companies at a time**; click **Load more** for the next 20. For each company the server reads its
   ycombinator.com page for the founders' names, titles, LinkedIn and X, and for the roles that company has open on YC.
   Loaded companies are kept in your browser, so reopening a batch is instant. Check **hiring** to hide companies with no
   open roles.
3. **Emails are filled in** for each founder:

   | Label | Source | Reliability |
   |---|---|---|
   | `on site` | Email published on the company's homepage or `/contact` page | Real address, may be generic |
   | `guess` | `first@domain`, then `first.last@`, `flast@`, `firstlast@` | First guess right ~80% of the time |

4. **Write once, send many.** Fill in your name and links, edit the subject and body, and every draft updates live. Copy
   a draft, open it in your mail app, or **Send all**: up to 100 emails (every founder with an address at each company in
   the current view), 10 per request, as HTML. The engine records every address it emails and never emails one twice.

Your details, template, "sent" marks and loaded batches are stored in your browser (`localStorage`).

## Layout

| Path | Role |
|---|---|
| `app/page.tsx`, `app/layout.tsx`, `app/globals.css` | The page shell and styles. |
| `components/OutreachApp.tsx` | State and logic: batches, loading, filters, template, Send all. |
| `components/CompanyCard.tsx` | One company: founders, jobs, draft, copy / mail / sent controls. |
| `lib/yc.ts` | Server only: YC search (Algolia), founder pages, site emails, guesses. |
| `lib/outreach.ts` | Template filling, email ranking, plain text to HTML, localStorage helpers. |
| `app/api/yc/route.ts` | `GET /api/yc?action=batches \| companies&batch=... \| founders&slugs=a,b` (max 10 slugs). |
| `app/api/send/route.ts` | Forwards a batch to the EmailEngine (`ENGINE_URL`, default `http://localhost:6969`) and records each result in Supabase. Localhost only. |
| `app/api/sent`, `stats`, `batch-done`, `batch-stats` | Sent addresses, per-batch counts, and the done / mailable markers behind the **Sent by batch** panel. Localhost only. |
| `lib/db.ts` | Server only: the Supabase client (secret key). |
| `supabase.sql`, `scripts/` | Table definitions, and one-off import / scan scripts. |

## Notes

- Everything from YC is untrusted text. React escapes it, and only `http(s)` links are rendered as links.
- `/api/yc` only takes a batch name or slugs. Websites always come from YC's data, never from the request, so it can't be
  used to fetch arbitrary URLs. Keep it that way.
- `/api/send` refuses requests that don't come from localhost, so a deployed copy can't send mail as you. Set
  `ALLOW_REMOTE_SEND=1` only if you really want that.
- Be decent: write to people one at a time, keep it short, and take "no" for an answer.
