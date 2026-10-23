import { type NextRequest, NextResponse } from "next/server"

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4100"

/** SMS short links: carry no personal data, grant no access; the target opens after sign-in (ch. 17.4). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const r = await fetch(`${API}/v1/s/${encodeURIComponent(code)}`)
  const locale = req.cookies.get("ut_locale")?.value === "fa" ? "fa" : "en"
  if (!r.ok) return NextResponse.redirect(new URL(`/${locale}`, req.url))
  const { target } = (await r.json()) as { target: string }
  return NextResponse.redirect(new URL(`/${locale}${target}`, req.url))
}
