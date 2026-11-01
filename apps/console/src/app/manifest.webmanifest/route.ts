import type { NextRequest } from "next/server"

const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
]
const shortcut = (name: string, url: string) => ({ name, url, icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] })

const SURFACE = {
  admin: { name: "Uni Travel Admin", short_name: "UT Admin", shortcuts: [shortcut("Queues", "/queues"), shortcut("Customers", "/customers"), shortcut("Invoices", "/invoices")] },
  dev: { name: "Uni Travel Developer", short_name: "UT Dev", shortcuts: [shortcut("Health", "/health"), shortcut("Audit log", "/audit"), shortcut("Users", "/users")] },
}

/** Each console host installs as its own app (ADR-0022), so the manifest depends on the host; the proxy has already refused any other host. */
export function GET(req: NextRequest) {
  const name = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase()
  const dev = new URL(process.env.PUBLIC_CONSOLE_DEV_URL ?? "http://dev.localhost:4200").hostname
  const surface = name === dev ? SURFACE.dev : SURFACE.admin
  return Response.json({
    ...surface, id: "/", start_url: "/", scope: "/", display: "standalone", display_override: ["window-controls-overlay", "standalone"],
    background_color: "#061f4c", theme_color: "#061f4c", dir: "auto", lang: "en-GB", icons: ICONS,
  }, { headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" } })
}

export const dynamic = "force-dynamic"
