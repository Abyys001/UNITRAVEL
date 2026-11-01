import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@unitravel/ui", "@unitravel/contracts", "@unitravel/domain"],
  output: "standalone",
  // Browsers ask for /favicon.ico on their own; the only icon is app/icon.svg.
  async rewrites() { return [{ source: "/favicon.ico", destination: "/icon.svg" }] },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }, {
      // A new worker must reach installed apps on their next launch.
      source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }],
    }]
  },
}
export default config
