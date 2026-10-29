import type { SiteConfig } from "@unitravel/contracts"
import type { ContentFlags } from "@unitravel/i18n"

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4100"

/**
 * Server pages read the public site configuration the same way the menu does (GET /v1/site). Cached for 60 s like the
 * API. If the API cannot be reached, every flagged block stays hidden: a switched-off service is never advertised.
 */
export async function contentFlags(): Promise<ContentFlags> {
  try {
    const res = await fetch(`${API}/v1/site`, { next: { revalidate: 60 }, headers: { accept: "application/json" } })
    if (!res.ok) return {}
    const site = (await res.json()) as SiteConfig
    return { "services.visa.enabled": site.menu.visa === true, "services.insurance.enabled": site.menu.insurance === true, "payments.online.enabled": site.payments.online === true, "hotels.enabled": site.menu.hotels === true }
  } catch {
    return {}
  }
}
