import type { MetadataRoute } from "next"

const SITE = process.env.PUBLIC_WEB_URL ?? "http://localhost:4000"
const PRIVATE = ["account", "inbox", "billing", "requests", "sign-in", "services", "shipments", "itinerary", "request", "pay"]

export const dynamic = "force-dynamic"
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", ...["en", "fa"].flatMap((l) => PRIVATE.map((p) => `/${l}/${p}`))] }], sitemap: `${SITE}/sitemap.xml` }
}
