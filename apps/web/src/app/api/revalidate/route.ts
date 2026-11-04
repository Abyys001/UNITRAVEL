import { timingSafeEqual } from "node:crypto"

import { revalidateTag } from "next/cache"
import { type NextRequest, NextResponse } from "next/server"

import { z } from "zod"

// ADR-0034: the API calls this after a catalog slot is refreshed. Not a user endpoint: no secret configured means it does not exist.
const Body = z.object({ tags: z.array(z.string().max(80).regex(/^[a-z]+(:[A-Za-z0-9-]+)?$/)).min(1).max(20) })

function secretMatches(given: string | null, expected: string) {
  const a = Buffer.from(given ?? "")
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const secret = process.env.WEB_REVALIDATE_SECRET
  if (!secret) return new NextResponse(null, { status: 404 })
  if (!secretMatches(req.headers.get("x-revalidate-secret"), secret)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const tags = [...new Set(parsed.data.tags)]
  // { expire: 0 } drops the entry now: a refreshed slot must not keep serving the old list for another revalidation cycle.
  for (const tag of tags) revalidateTag(tag, { expire: 0 })
  return NextResponse.json({ revalidated: tags.length })
}
