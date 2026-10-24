import "./globals.css"

import type { Metadata } from "next"
import { headers } from "next/headers"

import { ToastHost } from "@/components/bento"
import { PREFS_BOOT_SCRIPT } from "@/lib/prefs-boot"
import { Providers } from "@/lib/session"

import { jetbrains, montserrat, vazirmatn } from "./fonts"

export const metadata: Metadata = { title: { default: "Uni Travel console", template: "%s · Uni Travel console" }, robots: { index: false, follow: false } }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const nonce = h.get("x-nonce") ?? undefined
  const surface = h.get("x-surface") ?? "admin"
  return (
    <html suppressHydrationWarning lang="en" dir="ltr" data-surface={surface} className={`${montserrat.variable} ${vazirmatn.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh" nonce={nonce}>
        {/* Applies theme, density and language before first paint; the nonce satisfies the console CSP. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
        <Providers>
          {children}
          <ToastHost />
        </Providers>
      </body>
    </html>
  )
}
