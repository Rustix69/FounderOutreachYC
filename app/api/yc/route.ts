import { NextResponse } from "next/server";
import { BATCH_RE, MAX_SLUGS, SLUG_RE, batches, companies, founders } from "@/lib/yc";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200, cache = 0) =>
  NextResponse.json(body, { status, headers: cache ? { "Cache-Control": `public, s-maxage=${cache}, stale-while-revalidate=86400` } : {} });

// GET /api/yc?action=batches | companies&batch=Winter%202024 | founders&slugs=a,b (max 10)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    switch (q.get("action")) {
      case "batches":
        return json(await batches(), 200, 86400);
      case "companies": {
        const batch = q.get("batch") ?? "";
        if (!BATCH_RE.test(batch)) return json({ error: "Invalid batch" }, 400);
        return json(await companies(batch), 200, 3600);
      }
      case "founders": {
        const slugs = (q.get("slugs") ?? "").split(",").filter(Boolean);
        if (!slugs.length || slugs.length > MAX_SLUGS || !slugs.every(s => SLUG_RE.test(s)))
          return json({ error: `Pass 1-${MAX_SLUGS} valid slugs` }, 400);
        return json(await Promise.all(slugs.map(founders)), 200, 86400);
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error && e.message ? e.message : "Upstream error" }, 502);
  }
}
