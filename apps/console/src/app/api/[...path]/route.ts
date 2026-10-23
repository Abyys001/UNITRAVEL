import type { NextRequest } from "next/server"

/**
 * Same-origin API proxy (ch. 29.2): /api/* on each console host is forwarded to the API with the incoming Host as
 * x-forwarded-host, which is what the API's Developer Panel host check reads (auth.guard.ts). Cookies stay host-only.
 */
const API = process.env.API_INTERNAL_URL ?? "http://localhost:4100"
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"])

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const url = `${API}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`
  const headers = new Headers()
  req.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase())) headers.set(k, v) })
  headers.set("x-forwarded-host", req.headers.get("host") ?? "")
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""))
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (ip) headers.set("x-forwarded-for", ip)
  const res = await fetch(url, {
    method: req.method, headers, redirect: "manual",
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    signal: req.signal,
  })
  const out = new Headers()
  res.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie" && k.toLowerCase() !== "content-encoding") out.set(k, v) })
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c)
  return new Response(res.body, { status: res.status, headers: out })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
export const dynamic = "force-dynamic"
